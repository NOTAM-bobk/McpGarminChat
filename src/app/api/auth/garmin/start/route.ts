import { assertSafeMcpUrl, getConfig, hasSessionSecret } from "@/lib/config";
import { getBaseUrl, oauthCallbackUrl } from "@/lib/http";
import { discoverOAuth, registerClient } from "@/lib/oauth";
import { buildAuthorizeUrl, createPkcePair, createState, OAuthError } from "@/lib/oauth-core";
import { getSessionStore, SessionConfigError } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorRedirect(request: Request, reason: string): Response {
  const url = new URL("/", getBaseUrl(request));
  url.searchParams.set("garmin", "error");
  url.searchParams.set("reason", reason);
  return Response.redirect(url, 302);
}

export async function GET(request: Request) {
  const config = getConfig();
  if (!hasSessionSecret(config)) {
    return errorRedirect(request, "setup_required");
  }

  try {
    assertSafeMcpUrl(config.mcpUrl);
    const redirectUri = oauthCallbackUrl(request);
    const discovery = await discoverOAuth(config.mcpUrl);

    // Verified provider behavior: open dynamic client registration, no approval.
    const client = await registerClient(discovery.authServer, redirectUri);
    const pkce = createPkcePair();
    const state = createState();

    const store = await getSessionStore();
    const current = await store.read();
    await store.write({
      // Keep a working connection while a reconnection attempt is in flight.
      ...(current.garmin ? { garmin: current.garmin } : {}),
      oauth: {
        state,
        codeVerifier: pkce.verifier,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        redirectUri,
        mcpUrl: config.mcpUrl,
        createdAt: Date.now(),
      },
    });

    const authorizeUrl = buildAuthorizeUrl({
      metadata: discovery.authServer,
      clientId: client.clientId,
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
      resource: discovery.resource.resource,
    });

    return Response.redirect(authorizeUrl, 302);
  } catch (error) {
    if (error instanceof SessionConfigError) return errorRedirect(request, "setup_required");
    if (error instanceof OAuthError) return errorRedirect(request, error.code);
    return errorRedirect(request, "connect_failed");
  }
}
