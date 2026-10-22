import { getConfig } from "@/lib/config";
import { getBaseUrl } from "@/lib/http";
import { connectMcp, McpAuthError } from "@/lib/mcp";
import { discoverOAuth, exchangeCode } from "@/lib/oauth";
import { isOAuthStateFresh, OAuthError, safeEqual } from "@/lib/oauth-core";
import { isGarminTokenExpired } from "@/lib/session";
import {
  getSessionStore,
  SessionConfigError,
  type SessionStore,
} from "@/lib/session-store";
import { filterAllowlistedTools, MAX_EXPOSED_TOOLS } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorRedirect(request: Request, reason: string): Response {
  const url = new URL("/", getBaseUrl(request));
  url.searchParams.set("garmin", "error");
  url.searchParams.set("reason", reason);
  return Response.redirect(url, 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  let store: SessionStore;
  try {
    store = await getSessionStore();
  } catch (error) {
    if (error instanceof SessionConfigError) return errorRedirect(request, "setup_required");
    return errorRedirect(request, "connect_failed");
  }

  const data = await store.read();
  const handshake = data.oauth;
  const previousGarmin = data.garmin;

  // Always burn the one-time handshake, even on failure, to prevent replay.
  // An existing working connection is kept until the new one is verified.
  if (handshake) {
    await store
      .write(previousGarmin ? { garmin: previousGarmin } : {})
      .catch(() => {});
  }

  if (providerError) {
    return errorRedirect(
      request,
      providerError === "access_denied" ? "access_denied" : "provider_error",
    );
  }
  if (!code || !state) return errorRedirect(request, "missing_code");
  if (!handshake) return errorRedirect(request, "missing_handshake");
  if (!safeEqual(handshake.state, state)) return errorRedirect(request, "state_mismatch");
  if (!isOAuthStateFresh(handshake.createdAt)) return errorRedirect(request, "state_expired");

  try {
    const config = getConfig();
    const discovery = await discoverOAuth(handshake.mcpUrl || config.mcpUrl);
    const tokens = await exchangeCode({
      metadata: discovery.authServer,
      code,
      redirectUri: handshake.redirectUri,
      clientId: handshake.clientId,
      clientSecret: handshake.clientSecret,
      codeVerifier: handshake.codeVerifier,
    });

    // Verify the authorization by actually discovering tools with it. A token
    // that cannot list tools is not a working Garmin connection.
    const client = await connectMcp(handshake.mcpUrl || config.mcpUrl, tokens.accessToken);
    let toolCount = 0;
    try {
      const discovered = await client.listTools();
      toolCount = filterAllowlistedTools(discovered).length;
    } finally {
      await client.close().catch(() => {});
    }

    if (toolCount === 0) return errorRedirect(request, "no_read_only_tools");

    const tokenExpiresAt =
      tokens.expiresIn !== null ? Date.now() + tokens.expiresIn * 1000 : null;
    if (tokenExpiresAt !== null && isGarminTokenExpired({ tokenExpiresAt })) {
      return errorRedirect(request, "expired_token");
    }

    await store.write({
      garmin: {
        accessToken: tokens.accessToken,
        tokenExpiresAt,
        connectedAt: Date.now(),
        mcpUrl: handshake.mcpUrl || config.mcpUrl,
        toolCount: Math.min(toolCount, MAX_EXPOSED_TOOLS),
      },
    });

    const success = new URL("/", getBaseUrl(request));
    success.searchParams.set("garmin", "connected");
    return Response.redirect(success, 302);
  } catch (error) {
    if (error instanceof OAuthError) {
      const reason =
        error.code === "registration_unsupported" || error.code === "discovery_failed"
          ? "provider_configuration"
          : "token_exchange_failed";
      return errorRedirect(request, reason);
    }
    if (error instanceof McpAuthError) return errorRedirect(request, "mcp_rejected_token");
    return errorRedirect(request, "connect_failed");
  }
}
