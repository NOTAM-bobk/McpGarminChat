import { HttpError } from "@/lib/http";
import { getConfig, hasSessionSecret, safeHost } from "@/lib/config";
import {
  isConnected,
  isGarminTokenExpired,
  SESSION_TTL_SECONDS,
  type AppSessionData,
  type GarminSession,
} from "@/lib/session";
import { getSessionStore, SessionConfigError, type SessionStore } from "@/lib/session-store";

export type ConnectionState = {
  sessionConfigured: boolean;
  connected: boolean;
  expired: boolean;
  connectedAt: number | null;
  toolCount: number | null;
  mcpHost: string;
  sessionTtlSeconds: number;
};

export async function readConnectionState(): Promise<ConnectionState> {
  const config = getConfig();
  const base: ConnectionState = {
    sessionConfigured: hasSessionSecret(config),
    connected: false,
    expired: false,
    connectedAt: null,
    toolCount: null,
    mcpHost: safeHost(config.mcpUrl),
    sessionTtlSeconds: SESSION_TTL_SECONDS,
  };
  if (!base.sessionConfigured) return base;

  try {
    const store = await getSessionStore();
    const data = await store.read();
    const garmin = data.garmin;
    return {
      ...base,
      connected: isConnected(data),
      expired: Boolean(garmin) && isGarminTokenExpired(garmin),
      connectedAt: garmin?.connectedAt ?? null,
      toolCount: garmin?.toolCount ?? null,
    };
  } catch (error) {
    if (error instanceof SessionConfigError) return base;
    throw error;
  }
}

export type GarminAuth = {
  accessToken: string;
  mcpUrl: string;
  garmin: GarminSession;
  store: SessionStore;
};

/**
 * Resolve the current request's own Garmin authorization. There is no shared
 * cache and no global token: each cookie gets its own isolated session.
 */
export async function requireGarminAuth(): Promise<GarminAuth> {
  const config = getConfig();
  if (!hasSessionSecret(config)) {
    throw new HttpError(
      503,
      "setup_required",
      "SESSION_SECRET is not configured, so Garmin connections cannot be stored securely.",
    );
  }

  let store: SessionStore;
  try {
    store = await getSessionStore();
  } catch (error) {
    if (error instanceof SessionConfigError) {
      throw new HttpError(503, "setup_required", error.message);
    }
    throw error;
  }

  const data = await store.read();
  const garmin = data.garmin;
  if (!garmin?.accessToken) {
    throw new HttpError(
      401,
      "not_connected",
      "Connect Garmin to ask questions about your activities, sleep, or recovery.",
    );
  }
  if (isGarminTokenExpired(garmin)) {
    await store.destroy().catch(() => {});
    throw new HttpError(
      401,
      "reconnect_required",
      "Your Garmin connection expired. Reconnect Garmin to continue.",
    );
  }

  return { accessToken: garmin.accessToken, mcpUrl: garmin.mcpUrl || config.mcpUrl, garmin, store };
}

export async function saveGarminSession(
  store: SessionStore,
  garmin: GarminSession,
): Promise<void> {
  const data: AppSessionData = { garmin };
  await store.write(data);
}
