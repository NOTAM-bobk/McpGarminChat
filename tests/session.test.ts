import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () =>
      [...jar.cookies.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      if (!value) jar.cookies.delete(name);
      else jar.cookies.set(name, value);
    },
    delete: (name: string) => jar.cookies.delete(name),
  }),
}));

process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
process.env.APP_URL = "http://localhost:3000";
process.env.GARMIN_MCP_URL = "https://missingmcp.com/garmin/mcp";

const { getSessionStore } = await import("@/lib/session-store");
const { requireGarminAuth } = await import("@/lib/auth");
const {
  assertSessionFits,
  isConnected,
  isGarminTokenExpired,
  sessionByteLength,
  SessionTooLargeError,
  withoutHandshake,
} = await import("@/lib/session");

const MCP = "https://missingmcp.com/garmin/mcp";

async function writeSession(token: string, tokenExpiresAt: number | null = null) {
  const store = await getSessionStore();
  await store.write({
    garmin: {
      accessToken: token,
      tokenExpiresAt,
      connectedAt: Date.now(),
      mcpUrl: MCP,
      toolCount: 12,
    },
  });
}

beforeEach(() => {
  jar.cookies.clear();
});

describe("session expiry", () => {
  it("treats a missing token as disconnected", () => {
    expect(isConnected({})).toBe(false);
    expect(isGarminTokenExpired(undefined)).toBe(false);
  });

  it("expires at the provider's absolute timestamp", () => {
    const now = 1_000_000;
    expect(isGarminTokenExpired({ tokenExpiresAt: now + 1 }, now)).toBe(false);
    expect(isGarminTokenExpired({ tokenExpiresAt: now }, now)).toBe(true);
    expect(isGarminTokenExpired({ tokenExpiresAt: null }, now)).toBe(false);
  });

  it("drops the transient OAuth handshake", () => {
    expect(withoutHandshake({ garmin: undefined })).toEqual({ garmin: undefined });
  });
});

describe("session size", () => {
  it("rejects a payload that would not fit safely in a cookie", () => {
    const oversized = {
      garmin: {
        accessToken: "x".repeat(4_000),
        tokenExpiresAt: null,
        connectedAt: Date.now(),
        mcpUrl: MCP,
        toolCount: 1,
      },
    };
    expect(sessionByteLength(oversized)).toBeGreaterThan(3_000);
    expect(() => assertSessionFits(oversized)).toThrow(SessionTooLargeError);
    expect(() => assertSessionFits({})).not.toThrow();
  });
});

describe("connected session", () => {
  it("round-trips the token through the encrypted cookie", async () => {
    await writeSession("token-a");
    const auth = await requireGarminAuth();
    expect(auth.accessToken).toBe("token-a");
    expect(auth.mcpUrl).toBe(MCP);
    expect(auth.garmin.toolCount).toBe(12);
  });

  it("isolates two users' authorizations by cookie", async () => {
    await writeSession("token-user-a");
    const cookieForA = new Map(jar.cookies);
    expect((await requireGarminAuth()).accessToken).toBe("token-user-a");

    // A second browser: no cookie yet, then its own connection.
    jar.cookies.clear();
    await expect(requireGarminAuth()).rejects.toMatchObject({
      status: 401,
      code: "not_connected",
    });
    await writeSession("token-user-b");
    expect((await requireGarminAuth()).accessToken).toBe("token-user-b");

    // Returning to the first user's cookie must never see user B's token.
    jar.cookies.clear();
    for (const [name, value] of cookieForA) jar.cookies.set(name, value);
    expect((await requireGarminAuth()).accessToken).toBe("token-user-a");
  });

  it("rejects expired authorizations and clears the cookie", async () => {
    await writeSession("expired-token", Date.now() - 1_000);
    await expect(requireGarminAuth()).rejects.toMatchObject({
      status: 401,
      code: "reconnect_required",
    });
    expect(jar.cookies.size).toBe(0);
  });

  it("rejects a session sealed with a different secret", async () => {
    await writeSession("token-a");
    process.env.SESSION_SECRET = "a-completely-different-session-secret-value";
    await expect(requireGarminAuth()).rejects.toMatchObject({ code: "not_connected" });
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
  });
});
