import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractPuterMessage,
  PuterError,
  toPuterError,
} from "@/lib/puter-client";
import { runPuterTurn } from "@/lib/puter-chat";

const puterChat = vi.fn();

function stubPuter() {
  vi.stubGlobal("window", { puter: { ai: { chat: puterChat } } });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init),
    ),
  );
}

beforeEach(() => {
  stubPuter();
});

afterEach(() => {
  vi.unstubAllGlobals();
  puterChat.mockReset();
});

describe("Puter response normalization", () => {
  it("extracts text arrays and function calls", () => {
    const message = extractPuterMessage({
      message: {
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "there" },
        ],
        tool_calls: [
          {
            id: "call_1",
            function: { name: "get_sleep_summary", arguments: { startDate: "2026-10-01" } },
          },
        ],
      },
    });
    expect(message.content).toBe("Hello there");
    expect(message.toolCalls[0]).toMatchObject({
      id: "call_1",
      type: "function",
      function: { name: "get_sleep_summary" },
    });
    expect(JSON.parse(message.toolCalls[0].function.arguments)).toEqual({
      startDate: "2026-10-01",
    });
  });

  it("handles OpenAI-style choices", () => {
    expect(
      extractPuterMessage({ choices: [{ message: { content: "hi" } }] }).content,
    ).toBe("hi");
  });

  it("maps auth, allowance, and cancellation errors", () => {
    expect(toPuterError({ status: 401, message: "Sign in required" })).toMatchObject({
      code: "puter_auth",
    });
    expect(toPuterError({ status: 402, message: "Insufficient allowance" })).toMatchObject({
      code: "puter_allowance",
    });
    expect(
      toPuterError(new DOMException("The operation was aborted.", "AbortError")),
    ).toMatchObject({ code: "cancelled" });
  });
});

describe("Puter Garmin tool loop", () => {
  it("runs server-side tools and never sends a token to Puter", async () => {
    puterChat
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [
            {
              id: "call_1",
              function: {
                name: "get_sleep_summary",
                arguments: JSON.stringify({ startDate: "2026-10-15", endDate: "2026-10-21" }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        message: { content: "You averaged about 7h 20m." },
      });

    const calls: Array<{ url: string; body?: unknown }> = [];
    stubFetch((url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/garmin/tools") {
        return Response.json({
          tools: [
            {
              name: "get_sleep_summary",
              description: "Sleep",
              parameters: { type: "object", properties: {} },
            },
          ],
        });
      }
      if (url === "/api/garmin/tool-call") {
        return Response.json({ text: "7h 20m", isError: false, label: "Checking sleep data…" });
      }
      return new Response("not found", { status: 404 });
    });

    const deltas: string[] = [];
    const statuses: string[] = [];
    const result = await runPuterTurn({
      history: [{ role: "user", content: "How did I sleep?" }],
      timezone: "America/New_York",
      model: "gpt-5.4-nano",
      connected: true,
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
      onStatus: (label) => statuses.push(label),
    });

    expect(result.content).toBe("You averaged about 7h 20m.");
    expect(result.toolsUsed).toEqual(["get_sleep_summary"]);
    expect(result.dateRange).not.toBeNull();
    expect(deltas.join("")).toBe("You averaged about 7h 20m.");
    expect(statuses).toContain("Retrieving Garmin data…");

    expect(calls.some((call) => call.url === "/api/garmin/tool-call")).toBe(true);
    expect(calls.find((call) => call.url === "/api/garmin/tool-call")?.body).toEqual({
      name: "get_sleep_summary",
      arguments: { startDate: "2026-10-15", endDate: "2026-10-21" },
    });

    // The browser calls the SDK with messages and tools, never a Garmin token.
    const firstOptions = puterChat.mock.calls[0][1] as Record<string, unknown>;
    expect(JSON.stringify(firstOptions)).not.toMatch(/Bearer|accessToken/i);
    expect(firstOptions).toMatchObject({ toolChoice: "required", stream: false });
  });

  it("discards a first answer that ignored Garmin tools", async () => {
    puterChat.mockResolvedValueOnce({
      message: { content: "You slept great, probably." },
    });
    stubFetch(() =>
      Response.json({
        tools: [{ name: "get_sleep_summary", parameters: { type: "object" } }],
      }),
    );

    await expect(
      runPuterTurn({
        history: [{ role: "user", content: "sleep?" }],
        timezone: "UTC",
        model: "some-model",
        connected: true,
        signal: new AbortController().signal,
        onDelta: () => {},
        onStatus: () => {},
      }),
    ).rejects.toMatchObject({ code: "puter_tools_unsupported" });
  });

  it("surfaces reconnect when the server rejects the Garmin session", async () => {
    puterChat.mockResolvedValueOnce({
      message: {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            function: { name: "get_sleep_summary", arguments: "{}" },
          },
        ],
      },
    });
    stubFetch((url) => {
      if (url === "/api/garmin/tools") {
        return Response.json({ tools: [{ name: "get_sleep_summary" }] });
      }
      return Response.json(
        { error: { code: "reconnect_required", message: "Reconnect Garmin." } },
        { status: 401 },
      );
    });

    await expect(
      runPuterTurn({
        history: [{ role: "user", content: "sleep?" }],
        timezone: "UTC",
        model: "some-model",
        connected: true,
        signal: new AbortController().signal,
        onDelta: () => {},
        onStatus: () => {},
      }),
    ).rejects.toMatchObject({ code: "reconnect_required" });
  });

  it("uses general chat without offering tools when Garmin is disconnected", async () => {
    puterChat.mockResolvedValueOnce({
      async *[Symbol.asyncIterator]() {
        yield { type: "text", text: "General answer." };
      },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runPuterTurn({
      history: [{ role: "user", content: "hello" }],
      timezone: "UTC",
      model: "some-model",
      connected: false,
      signal: new AbortController().signal,
      onDelta: () => {},
      onStatus: () => {},
    });

    expect(result.content).toBe("General answer.");
    expect(result.toolsUsed).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    const options = puterChat.mock.calls[0][1] as Record<string, unknown>;
    expect(options).toMatchObject({ stream: true });
    expect(options.tools).toBeUndefined();
  });

  it("stops a general Puter stream when the user cancels", async () => {
    const controller = new AbortController();
    puterChat.mockImplementationOnce(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "text", text: "partial" };
        controller.abort();
        yield { type: "text", text: "ignored" };
      },
    }));

    const deltas: string[] = [];
    const result = await runPuterTurn({
      history: [{ role: "user", content: "hello" }],
      timezone: "UTC",
      model: "some-model",
      connected: false,
      signal: controller.signal,
      onDelta: (text) => deltas.push(text),
      onStatus: () => {},
    });

    expect(result.stopReason).toBe("cancelled");
    expect(result.content).toBe("partial");
    expect(deltas.join("")).toBe("partial");
  });

  it("maps an unavailable Puter SDK to a clear error", async () => {
    const error = toPuterError(new PuterError("puter_unavailable", "Puter.js could not load."));
    expect(error.code).toBe("puter_unavailable");
    expect(error.message).toContain("could not load");
  });
});
