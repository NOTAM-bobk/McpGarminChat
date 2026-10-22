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

process.env.SESSION_SECRET = "route-test-session-secret-at-least-32-chars";
process.env.APP_URL = "http://localhost:3000";
process.env.GARMIN_MCP_URL = "https://missingmcp.com/garmin/mcp";
process.env.GROQ_API_KEY = "test-groq-key";

const { getSessionStore } = await import("@/lib/session-store");
const { POST: chatPOST } = await import("@/app/api/chat/route");
const { POST: toolCallPOST } = await import("@/app/api/garmin/tool-call/route");
const { POST: disconnectPOST } = await import("@/app/api/auth/garmin/disconnect/route");

const ORIGIN = "http://localhost:3000";
const MCP_URL = "https://missingmcp.com/garmin/mcp";

async function seedSession(token = "garmin-access-token") {
  const store = await getSessionStore();
  await store.write({
    garmin: {
      accessToken: token,
      tokenExpiresAt: null,
      connectedAt: Date.now(),
      mcpUrl: MCP_URL,
      toolCount: 5,
    },
  });
}

function mcpResponse(body: Record<string, unknown>): Response {
  if (body.method === "initialize") {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: {} },
      },
      { headers: { "mcp-session-id": "route-session" } },
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
          {
            name: "get_sleep_summary",
            description: "Sleep summary",
            inputSchema: {
              type: "object",
              properties: { startDate: { type: "string" } },
            },
          },
        ],
      },
    });
  }
  if (body.method === "tools/call") {
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "text", text: "Sleep: 7h 20m" }] },
    });
  }
  return new Response("not found", { status: 404 });
}

function installFetch(options?: { onMcpCall?: () => void }) {
  const mocked = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.startsWith("https://missingmcp.com/.well-known")) {
      return new Response("not found", { status: 404 });
    }

    if (url.startsWith("https://missingmcp.com")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return mcpResponse(body);
    }

    if (url.startsWith("https://api.groq.com")) {
      const requestBody = JSON.parse(String(init?.body)) as {
        messages?: Array<{ role?: string }>;
      };
      const hasToolResult = (requestBody.messages ?? []).some(
        (message) => message.role === "tool",
      );

      if (!hasToolResult) {
        return new Response(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_route",
                      function: {
                        name: "get_sleep_summary",
                        arguments: JSON.stringify({ startDate: "2026-10-15" }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      }

      options?.onMcpCall?.();
      return new Response(
        `data: ${JSON.stringify({
          choices: [{ delta: { content: "You slept 7h 20m on Oct 15." } }],
        })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }

    return new Response("unexpected", { status: 500 });
  });
  vi.stubGlobal("fetch", mocked);
  return mocked;
}

function chatRequest(body: unknown, origin: string | null = ORIGIN): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  return new Request(`${ORIGIN}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jar.cookies.clear();
  vi.unstubAllGlobals();
});

describe("POST /api/chat", () => {
  it("streams tool progress and a final answer through the real route", async () => {
    await seedSession();
    let toolRan = false;
    installFetch({ onMcpCall: () => { toolRan = true; } });

    const response = await chatPOST(
      chatRequest({
        timezone: "America/New_York",
        messages: [{ role: "user", content: "How did I sleep on Oct 15?" }],
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    expect(text).toContain("Checking sleep data…");
    expect(text).toContain("You slept 7h 20m on Oct 15.");
    expect(toolRan).toBe(true);
    expect(text).toContain('"type":"done"');
    expect(text).toContain("get_sleep_summary");
  });

  it("rejects a disconnected user with a clear code", async () => {
    installFetch();
    const response = await chatPOST(
      chatRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("not_connected");
  });

  it("rejects cross-site requests before reading the session", async () => {
    await seedSession();
    const fetchImpl = installFetch();
    const response = await chatPOST(
      chatRequest({ messages: [{ role: "user", content: "hi" }] }, "https://evil.example"),
    );
    expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("POST /api/garmin/tool-call", () => {
  it("executes an allowlisted read-only tool", async () => {
    await seedSession();
    installFetch();
    const response = await toolCallPOST(
      new Request(`${ORIGIN}/api/garmin/tool-call`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "get_sleep_summary",
          arguments: { startDate: "2026-10-15" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { text?: string };
    expect(payload.text).toBe("Sleep: 7h 20m");
  });

  it("refuses a write tool without touching Garmin", async () => {
    await seedSession();
    const fetchImpl = installFetch();
    const response = await toolCallPOST(
      new Request(`${ORIGIN}/api/garmin/tool-call`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "delete_activity", arguments: { id: "1" } }),
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/garmin/disconnect", () => {
  it("clears the session", async () => {
    await seedSession();
    installFetch();
    const response = await disconnectPOST(
      new Request(`${ORIGIN}/api/auth/garmin/disconnect`, {
        method: "POST",
        headers: { Origin: ORIGIN },
      }),
    );
    expect(response.status).toBe(200);
    expect(jar.cookies.size).toBe(0);
    const store = await getSessionStore();
    expect((await store.read()).garmin).toBeUndefined();
  });

  it("blocks cross-site disconnect attempts", async () => {
    await seedSession();
    installFetch();
    const response = await disconnectPOST(
      new Request(`${ORIGIN}/api/auth/garmin/disconnect`, {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
  });
});
