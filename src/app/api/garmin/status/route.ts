import { readConnectionState } from "@/lib/auth";
import { getConfig, hasSessionSecret, safeHost } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = getConfig();
  const state = await readConnectionState();
  return Response.json(
    {
      ...state,
      groqConfigured: Boolean(config.groqApiKey),
      groqModel: config.groqModel,
      puterModel: config.puterModel,
      mcpHost: safeHost(config.mcpUrl),
      oauthReady: hasSessionSecret(config),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
