/**
 * Session data model.
 *
 * Database-free by design: the complete OAuth result lives inside an
 * authenticated-encrypted, HttpOnly, Secure cookie sealed by iron-session.
 * Tokens never touch localStorage, URLs, or the client bundle.
 *
 * If a future provider issues tokens too large for a cookie, implement the
 * `SessionStore` interface in `session-store.ts` against a durable store and
 * keep the same route contract. Do not shrink security to fit the cookie.
 */

export type GarminSession = {
  accessToken: string;
  /** Absolute epoch ms, or null when the provider omits expires_in. */
  tokenExpiresAt: number | null;
  connectedAt: number;
  mcpUrl: string;
  toolCount: number;
};

export type OAuthHandshake = {
  state: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  mcpUrl: string;
  createdAt: number;
};

export type AppSessionData = {
  garmin?: GarminSession;
  oauth?: OAuthHandshake;
};

export const SESSION_COOKIE_NAME = "garmin_chat_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * iron-session seals and base64-expands the payload; stay well below the
 * ~4 KB per-cookie limit even though iron-session can chunk.
 */
export const MAX_SESSION_BYTES = 3000;

export class SessionTooLargeError extends Error {
  constructor(size: number) {
    super(
      `The authorization session is ${size} bytes, which is too large to store safely in a cookie. Configure a durable SessionStore instead.`,
    );
    this.name = "SessionTooLargeError";
  }
}

export function sessionByteLength(data: AppSessionData): number {
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

export function assertSessionFits(data: AppSessionData): void {
  const size = sessionByteLength(data);
  if (size > MAX_SESSION_BYTES) throw new SessionTooLargeError(size);
}

export function isGarminTokenExpired(
  garmin: Pick<GarminSession, "tokenExpiresAt"> | undefined,
  now = Date.now(),
): boolean {
  if (!garmin) return false;
  if (garmin.tokenExpiresAt === null) return false;
  return now >= garmin.tokenExpiresAt;
}

export function isConnected(
  data: AppSessionData | null | undefined,
  now = Date.now(),
): boolean {
  return Boolean(data?.garmin?.accessToken) && !isGarminTokenExpired(data?.garmin, now);
}

/** Remove the transient handshake once it has been used or has expired. */
export function withoutHandshake(data: AppSessionData): AppSessionData {
  return { garmin: data.garmin };
}
