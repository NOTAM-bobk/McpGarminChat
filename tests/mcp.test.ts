import { describe, expect, it, vi } from "vitest";
import {
  extractSseMessage,
  extractToolResultText,
  McpAuthError,
  McpClient,
  McpError,
} from "@/lib/mcp";

type Call = { method: string; headers: Headers; body: Record<string, unknown> };

function rpcResult(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

describe("MCP client", () => {
  it("initializes, lists tools, and calls a tool with the bearer token", async () => {
    const calls: Call[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({
        method: String(body.method),
        headers: new Headers(init?.headers),
        body,
      });

      if (body.method === "initialize") {
        return new Response(
          rpcResult(body.id, {
            protocolVersion: "2025-06-18",
            capabilities: {},
            serverInfo: { name: "missingmcp", version: "1" },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Mcp-Session-Id": "session-123",
            },
          },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (body.method === "tools/list") {
        return new Response(
          `event: message\ndata: ${rpcResult(body.id, {
            tools: [
              {
                name: "get_sleep_summary",
                description: "Sleep",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          })}\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      }
      if (body.method === "tools/call") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [
                { type: "text", text: "7h 20m" },
                { type: "image", data: "ignored", mimeType: "image/png" },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("unexpected", { status: 400 });
    }) as unknown as typeof fetch;

    const client = new McpClient(
      "https://missingmcp.com/garmin/mcp",
      "access-token-abc",
      fetchImpl,
    );
    await client.initialize();
    const tools = await client.listTools();
    const result = await client.callTool("get_sleep_summary", { date: "2026-10-20" });

    expect(tools.map((tool) => tool.name)).toEqual(["get_sleep_summary"]);
    expect(result.text).toBe("7h 20m");
    expect(result.isError).toBe(false);

    expect(calls[0].headers.get("authorization")).toBe("Bearer access-token-abc");
    expect(calls[0].headers.get("mcp-protocol-version")).toBeTruthy();
    // The session id from initialize must be reused on later requests.
    expect(calls[2].headers.get("mcp-session-id")).toBe("session-123");
    expect(calls[2].method).toBe("tools/list");
    expect(calls[3].body).toMatchObject({
      method: "tools/call",
      params: { name: "get_sleep_summary", arguments: { date: "2026-10-20" } },
    });
  });

  it("maps a 401 to reconnect_required", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const client = new McpClient("https://missingmcp.com/garmin/mcp", "expired", fetchImpl);
    await expect(client.initialize()).rejects.toBeInstanceOf(McpAuthError);
  });

  it("surfaces rate limits with the retry delay", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("slow down", { status: 429, headers: { "Retry-After": "12" } }),
    ) as unknown as typeof fetch;
    const client = new McpClient("https://missingmcp.com/garmin/mcp", "token", fetchImpl);
    await expect(client.initialize()).rejects.toMatchObject({
      code: "rate_limited",
      message: expect.stringContaining("12"),
    });
  });

  it("reports a JSON-RPC tool error without leaking payloads", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.method === "initialize") {
        return new Response(
          rpcResult(body.id, { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: {} }),
          { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "s" } },
        );
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "Unknown tool: delete_activity" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const client = new McpClient("https://missingmcp.com/garmin/mcp", "token", fetchImpl);
    await client.initialize();
    await expect(client.callTool("delete_activity", {})).rejects.toBeInstanceOf(McpError);
  });
});

describe("SSE parsing", () => {
  it("finds the matching JSON-RPC response and ignores heartbeats", () => {
    const body = [
      ": ping",
      "",
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}`,
      "",
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 7, result: { tools: [] } })}`,
      "",
    ].join("\n");
    expect(extractSseMessage(body, 7)).toMatchObject({ id: 7 });
    expect(extractSseMessage(body, 8)).toBeNull();
  });
});

describe("tool output", () => {
  it("joins text blocks and truncates oversized results", () => {
    expect(
      extractToolResultText({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }).text,
    ).toBe("a\nb");

    const truncated = extractToolResultText({
      content: [{ type: "text", text: "x".repeat(20_000) }],
    }).text;
    expect(truncated.length).toBeLessThan(16_200);
    expect(truncated).toContain("Output truncated");
  });

  it("marks isError and handles empty content", () => {
    expect(extractToolResultText({ content: [], isError: true })).toEqual({
      text: "[The Garmin tool returned no readable content.]",
      isError: true,
    });
  });
});
