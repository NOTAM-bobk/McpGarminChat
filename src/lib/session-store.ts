import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { getConfig, hasSessionSecret } from "@/lib/config";
import {
  assertSessionFits,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  type AppSessionData,
} from "@/lib/session";

export class SessionConfigError extends Error {
  constructor() {
    super(
      "SESSION_SECRET is not configured. Add a random string of at least 32 characters.",
    );
    this.name = "SessionConfigError";
  }
}

/**
 * Minimal storage adapter. The default implementation is the encrypted cookie
 * store. A serverless KV/Redis adapter only needs to implement these methods and
 * be returned by `getSessionStore`; route handlers stay unchanged.
 */
export interface SessionStore {
  read(): Promise<AppSessionData>;
  write(data: AppSessionData): Promise<void>;
  destroy(): Promise<void>;
}

function sessionOptions(secret: string, appUrl: string | null): SessionOptions {
  return {
    cookieName: SESSION_COOKIE_NAME,
    password: secret,
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      // Keep local production builds over http usable; real deployments (and
      // Vercel previews without APP_URL) always get Secure cookies.
      secure:
        process.env.NODE_ENV === "production" && !(appUrl?.startsWith("http://") ?? false),
      sameSite: "lax", // required so the top-level OAuth callback carries the cookie
      path: "/",
    },
  };
}

function pickKnownFields(data: AppSessionData): AppSessionData {
  const output: AppSessionData = {};
  if (data.garmin) output.garmin = data.garmin;
  if (data.oauth) output.oauth = data.oauth;
  return output;
}

export async function getSessionStore(): Promise<SessionStore> {
  const config = getConfig();
  if (!hasSessionSecret(config)) throw new SessionConfigError();

  const cookieStore = await cookies();
  const session = await getIronSession<AppSessionData>(
    cookieStore,
    sessionOptions(config.sessionSecret, config.appUrl),
  );

  return {
    async read() {
      const data: AppSessionData = {};
      if (session.garmin) data.garmin = session.garmin;
      if (session.oauth) data.oauth = session.oauth;
      return data;
    },
    async write(data) {
      const clean = pickKnownFields(data);
      assertSessionFits(clean);
      session.garmin = clean.garmin;
      session.oauth = clean.oauth;
      await session.save();
    },
    async destroy() {
      await session.destroy();
    },
  };
}
