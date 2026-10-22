import { describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@/lib/chat-events";
import { getConfig } from "@/lib/config";
import { runGroqChat } from "@/lib/groq";
import type { McpClient, McpTool } from "@/lib/mcp";
import { McpAuthError } from "@/lib/mcp";

const TOOLS: McpTool[] = [
  {
    name: "get_sleep_summary",
    description: "Sleep summary",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string" },
        endDate: { type: "string" },
      },
    },
  },
  {
    name: "get_activities_by_date",
    description: "Activities",
    inputSchema: {
      type: "object",
      properties: { startDate: { type: "string" } },
    },
  },
];

function sse(chunks: unknown[]): Response {
  const body = chunks
    .map((chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function toolCallResponse(name: string, args: Record<string, unknown>) {
  return sse([
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
    "[DONE]",
  ]);
}

function textResponse(text: string) {
  return sse([
    { choices: [{ delta: { content: text }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    "[DONE]",
  ]);
}

function makeClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    listTools: vi.fn(async () => TOOLS),
    callTool: vi.fn(async () => ({ text: "Recorded sleep: 7h 20m", isError: false })),
    close: vi.fn(async () => {}),
    ...overrides,
  } as unknown as McpClient;
}

function collect() {
  const events: ChatEvent[] = [];
  return { events, emit: (event: ChatEvent) => events.push(event) };
}

const config = () => ({ ...getConfig(), groqApiKey: "test-key", groqModel: "openai/gpt-oss-120b" });

describe("Groq tool loop", () => {
  it("executes a read-only tool and streams the final answer", async () => {
    const client = makeClient();
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return bodies.length === 1
        ? toolCallResponse("get_sleep_summary", {
            startDate: "2026-10-15",
            endDate: "2026-10-21",
          })
        : textResponse("You averaged about 7h 20m of sleep.");
    }) as unknown as typeof fetch;

    const { events, emit } = collect();
    await runGroqChat({
      messages: [{ role: "user", content: "How did I sleep last week?" }],
      timeZone: "America/New_York",
      config: config(),
      connect: async () => client,
      emit,
      fetchImpl,
      now: new Date("2026-10-22T12:00:00Z"),
    });

    expect(client.callTool).toHaveBeenCalledWith(
      "get_sleep_summary",
      { startDate: "2026-10-15", endDate: "2026-10-21" },
      undefined,
    );

    const deltas = events.filter((event) => event.type === "delta");
    expect(deltas).toEqual([
      { type: "delta", text: "You averaged about 7h 20m of sleep." },
    ]);

    const done = events.find((event) => event.type === "done");
    expect(done).toMatchObject({
      type: "done",
      toolsUsed: ["get_sleep_summary"],
      stopReason: "complete",
    });
    if (done?.type === "done") {
      expect(done.dateRange).not.toBeNull();
    }

    // The second request must carry the assistant tool call and its result.
    const secondMessages = (bodies[1].messages as Array<Record<string, unknown>>) ?? [];
    expect(
      secondMessages.some((message) => message.role === "tool" && message.tool_call_id === "call_1"),
    ).toBe(true);
    expect(events.some((event) => event.type === "status" && event.stage === "tool")).toBe(true);
    expect(client.close).toHaveBeenCalled();
  });

  it("never executes a tool outside the allowlist", async () => {
    const client = makeClient();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_bad",
                      function: { name: "delete_activity", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    ) as unknown as typeof fetch;

    const { events, emit } = collect();
    await runGroqChat({
      messages: [{ role: "user", content: "Delete my run" }],
      timeZone: "UTC",
      config: config(),
      connect: async () => client,
      emit,
      fetchImpl,
    });

    expect(client.callTool).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "delta")).toBe(false);
    expect(events.some((event) => event.type === "done")).toBe(true);
  });

  it("rejects malformed tool arguments without calling Garmin", async () => {
    const client = makeClient();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_bad_args",
                      function: {
                        name: "get_activities_by_date",
                        arguments: JSON.stringify({ unexpected: true }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\ndata: [DONE]\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    ) as unknown as typeof fetch;

    const { emit } = collect();
    await runGroqChat({
      messages: [{ role: "user", content: "hello" }],
      timeZone: "UTC",
      config: config(),
      connect: async () => client,
      emit,
      fetchImpl,
    });
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns the documented error when the model is rate limited", async () => {
    const client = makeClient();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const { events, emit } = collect();
    await runGroqChat({
      messages: [{ role: "user", content: "hi" }],
      timeZone: "UTC",
      config: config(),
      connect: async () => client,
      emit,
      fetchImpl,
    });

    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", code: "groq_rate_limit" }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("explains when no supported read-only tools exist", async () => {
    const client = makeClient({
      listTools: vi.fn(async () => [
        { name: "update_activity" },
        { name: "delete_activity" },
      ]),
    });
    const { events, emit } = collect();
    await runGroqChat({
      messages: [{ role: "user", content: "hi" }],
      timeZone: "UTC",
      config: config(),
      connect: async () => client,
      emit,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(client.callTool).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", code: "no_tools" }),
    );
  });

  it("clears the session when Garmin rejects the token", async () => {
    const client = makeClient({
      callTool: vi.fn(async () => {
        throw new McpAuthError();
      }),
    });
    const fetchImpl = vi.fn(async () =>
      toolCallResponse("get_sleep_summary", { startDate: "2026-10-01" }),
    ) as unknown as typeof fetch;
    const onAuthError = vi.fn(async () => {});

    const { events, emit } = collect();
    await runGroqChat({
      messages: [{ role: "user", content: "sleep" }],
      timeZone: "UTC",
      config: config(),
      connect: async () => client,
      emit,
      fetchImpl,
      onAuthError,
    });

    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", code: "reconnect_required" }),
    );
  });

  it("refuses to run without a Groq key", async () => {
    const { events, emit } = collect();
    await runGroqChat({
      messages: [{ role: "user", content: "hi" }],
      timeZone: "UTC",
      config: { ...getConfig(), groqApiKey: "" },
      connect: async () => makeClient(),
      emit,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", code: "groq_not_configured" }),
    );
  });
});

describe("system prompt", () => {
  it("uses the user's timezone and forbids fabrication", async () => {
    const { buildSystemPrompt } = await import("@/lib/groq");
    const prompt = buildSystemPrompt("Asia/Tokyo", new Date("2026-10-22T12:00:00Z"));
    expect(prompt).toContain("Asia/Tokyo");
    expect(prompt).toMatch(/never invent/i);
    expect(prompt).toMatch(/untrusted data/i);
    expect(prompt).toMatch(/medical advice/i);
  });
});
