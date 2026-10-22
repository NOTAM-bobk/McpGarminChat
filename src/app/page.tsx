import { ChatApp } from "@/components/chat-app";
import { readConnectionState } from "@/lib/auth";
import { getConfig, hasSessionSecret } from "@/lib/config";
import type { ConnectionInfo, OAuthResult } from "@/lib/client-types";

export const dynamic = "force-dynamic";

type SearchParams = {
  garmin?: string | string[];
  reason?: string | string[];
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [state, params] = await Promise.all([readConnectionState(), searchParams]);
  const config = getConfig();

  const initialConnection: ConnectionInfo = {
    ...state,
    groqConfigured: Boolean(config.groqApiKey),
    groqModel: config.groqModel,
    puterModel: config.puterModel,
    oauthReady: hasSessionSecret(config),
  };

  const garmin = typeof params.garmin === "string" ? params.garmin : null;
  const reason = typeof params.reason === "string" ? params.reason : "connect_failed";
  const oauthResult: OAuthResult =
    garmin === "connected"
      ? { kind: "connected" }
      : garmin === "error"
        ? { kind: "error", reason }
        : null;

  return <ChatApp initialConnection={initialConnection} oauthResult={oauthResult} />;
}
