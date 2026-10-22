import { getConfig } from "@/lib/config";
import { requireSameOrigin, jsonOk } from "@/lib/http";
import { discoverOAuth, revokeToken } from "@/lib/oauth";
import { getSessionStore } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
  } catch {
    return Response.json(
      { error: { code: "cross_origin_blocked", message: "Cross-origin request blocked." } },
      { status: 403 },
    );
  }

  const store = await getSessionStore();
  const data = await store.read();
  const token = data.garmin?.accessToken;
  const mcpUrl = data.garmin?.mcpUrl ?? getConfig().mcpUrl;

  let revoked = false;
  if (token) {
    try {
      // MissingMCP currently advertises no revocation endpoint; this is a
      // best-effort step for providers that do.
      const discovery = await discoverOAuth(mcpUrl);
      revoked = await revokeToken(discovery.authServer, token);
    } catch {
      revoked = false;
    }
  }

  await store.destroy();
  return jsonOk({ ok: true, revoked, providerSupportsRevocation: revoked });
}
