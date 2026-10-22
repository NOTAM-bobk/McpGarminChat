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

process.env.SESSION_SECRET = "callback-test-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.GARMIN_MCP_URL = "https://missingmcp.com/garmin/mcp";

const { getSessionStore } = await import("@/lib/session-store");
const { GET: callbackGET } = await import("@/app/api/auth/garmin/callback/route");

const MCP_URL = "https://missingmcp.com/garmin/mcp";
const REDIRECT_URI = "http://localhost:3000/api/auth/garmin/callback";
const STATE = "known-state-value";

const resourceDoc = {
  resource: MCP_URL,
  authorization_servers: ["https://missingmcp.com/garmin"],
};

const authDoc = {
  issuer: "https://missingmcp.com/garmin",
  authorization_endpoint: "https://missingmcp.com/garmin/oauth/authorize",
  token_endpoint: "https://missingmcp.com/garmin/oauth/token",
  registration_endpoint: "https://missingmcp.com/garmin/oauth/register",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["client_secret_post"],
};

async function seedHandshake(overrides: Record<string, unknown> = {}) {
  const store = await getSessionStore();
  await store.write({
    oauth: {
      state: STATE,
      codeVerifier: "verifier-test",
      clientId: "client-test",
      clientSecret: "secret-test",
      redirectUri: REDIRECT_URI,
      mcpUrl: MCP_URL,
      createdAt: Date.now(),
      ...overrides,
    },
  });
}

function installFetch() {
  const tokenBodies: URLSearchParams[] = [];
  const mocked = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/garmin/oauth/token")) {
      tokenBodies.push(new URLSearchParams(String(init?.body)));
      return Response.json({
        access_token: "new-access-token",
        token_type: "Bearer",
        expires_in: 7_776_000,
      });
    }

    if (url === "https://missingmcp.com/.well-known/oauth-protected-resource/garmin/mcp") {
      return Response.json(resourceDoc);
    }
    if (url === "https://missingmcp.com/.well-known/oauth-authorization-server/garmin") {
      return Response.json(authDoc);
    }

    if (url === MCP_URL) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.method === "initialize") {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: {} },
          },
          { headers: { "mcp-session-id": "callback-session" } },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (body.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              { name: "get_sleep_summary" },
              { name: "delete_activity" },
            ],
          },
        });
      }
    }

    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", mocked);
  return { mocked, tokenBodies };
}

function callbackRequest(query: string): Request {
  return new Request(`${REDIRECT_URI}?${query}`);
}

beforeEach(() => {
  jar.cookies.clear();
  vi.unstubAllGlobals();
});

describe("GET /api/auth/garmin/callback", () => {
  it("verifies tools, stores the token, and redirects to connected", async () => {
    await seedHandshake();
    const { tokenBodies } = installFetch();

    const response = await callbackGET(callbackRequest(`code=code-123&state=${STATE}`));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/?garmin=connected");

    expect(tokenBodies).toHaveLength(1);
    expect(tokenBodies[0].get("grant_type")).toBe("authorization_code");
    expect(tokenBodies[0].get("code")).toBe("code-123");
    expect(tokenBodies[0].get("code_verifier")).toBe("verifier-test");
    expect(tokenBodies[0].get("client_secret")).toBe("secret-test");

    const store = await getSessionStore();
    const data = await store.read();
    expect(data.garmin?.accessToken).toBe("new-access-token");
    expect(data.garmin?.toolCount).toBe(1); // only the read-only tool counts
    expect(data.oauth).toBeUndefined();
  });

  it("rejects a mismatched state without exchanging the code", async () => {
    await seedHandshake();
    const { tokenBodies } = installFetch();

    const response = await callbackGET(callbackRequest("code=code-123&state=wrong-state"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/?garmin=error&reason=state_mismatch",
    );
    expect(tokenBodies).toHaveLength(0);

    const store = await getSessionStore();
    expect((await store.read()).garmin).toBeUndefined();
  });

  it("rejects an expired handshake", async () => {
    await seedHandshake({ createdAt: Date.now() - 11 * 60 * 1000 });
    const { tokenBodies } = installFetch();

    const response = await callbackGET(callbackRequest(`code=code-123&state=${STATE}`));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/?garmin=error&reason=state_expired",
    );
    expect(tokenBodies).toHaveLength(0);
  });

  it("rejects a callback with no stored handshake", async () => {
    const { mocked } = installFetch();
    const response = await callbackGET(callbackRequest(`code=code-123&state=${STATE}`));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/?garmin=error&reason=missing_handshake",
    );
    expect(mocked).not.toHaveBeenCalled();
  });

  it("does not save a connection when the provider denies access", async () => {
    await seedHandshake();
    const { mocked } = installFetch();
    const response = await callbackGET(
      callbackRequest("error=access_denied&state=" + STATE),
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/?garmin=error&reason=access_denied",
    );
    expect(mocked).not.toHaveBeenCalled();
    expect((await (await getSessionStore()).read()).garmin).toBeUndefined();
  });
});
