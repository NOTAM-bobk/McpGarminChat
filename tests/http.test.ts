import { afterEach, describe, expect, it } from "vitest";
import { getBaseUrl, isSameOrigin, readJsonBody } from "@/lib/http";
import { parseChatBody } from "@/lib/chat-request";
import { redactText, redactToken, redactUrl, toSafeErrorMessage } from "@/lib/redact";

process.env.APP_URL = "https://garmin-chat.example";

afterEach(() => {
  process.env.APP_URL = "https://garmin-chat.example";
});

describe("same-origin protection", () => {
  it("accepts the configured origin", () => {
    const request = new Request("https://garmin-chat.example/api/chat", {
      method: "POST",
      headers: { Origin: "https://garmin-chat.example" },
    });
    expect(isSameOrigin(request)).toBe(true);
  });

  it("rejects another origin", () => {
    const request = new Request("https://garmin-chat.example/api/chat", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(isSameOrigin(request)).toBe(false);
  });

  it("rejects requests without an Origin header", () => {
    const request = new Request("https://garmin-chat.example/api/chat", { method: "POST" });
    expect(isSameOrigin(request)).toBe(false);
  });
});

describe("base URL", () => {
  it("prefers APP_URL", () => {
    expect(getBaseUrl(new Request("http://internal:3000/api/x"))).toBe(
      "https://garmin-chat.example",
    );
  });

  it("falls back to the request origin in development", () => {
    delete process.env.APP_URL;
    expect(getBaseUrl(new Request("http://localhost:3000/api/x"))).toBe(
      "http://localhost:3000",
    );
  });

  it("honors forwarded protocol and host", () => {
    delete process.env.APP_URL;
    const request = new Request("http://internal:3000/api/x", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "preview.vercel.app" },
    });
    expect(getBaseUrl(request)).toBe("https://preview.vercel.app");
  });
});

describe("chat request validation", () => {
  it("accepts user and assistant turns with a valid timezone", () => {
    const parsed = parseChatBody({
      timezone: "Europe/Berlin",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "sleep?" },
      ],
    });
    expect(parsed.timezone).toBe("Europe/Berlin");
    expect(parsed.messages).toHaveLength(3);
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(
      parseChatBody({ timezone: "Mars/Olympus", messages: [{ role: "user", content: "hi" }] })
        .timezone,
    ).toBe("UTC");
  });

  it("rejects an empty, oversized, or malformed conversation", () => {
    expect(() => parseChatBody({ messages: [] })).toThrow(/non-empty/);
    expect(() =>
      parseChatBody({ messages: [{ role: "system", content: "hi" }] }),
    ).toThrow(/user or assistant/);
    expect(() =>
      parseChatBody({ messages: [{ role: "user", content: "   " }] }),
    ).toThrow(/characters/);
    expect(() =>
      parseChatBody({
        messages: [
          { role: "user", content: "a".repeat(8_001) },
        ],
      }),
    ).toThrow(/characters/);
    expect(() =>
      parseChatBody({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      }),
    ).toThrow(/last message/i);
  });

  it("rejects a conversation over the character budget", () => {
    const messages = Array.from({ length: 7 }).map((_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(7_000),
    }));
    messages.push({ role: "user", content: "final" });
    expect(() => parseChatBody({ messages })).toThrow(/too large/i);
  });

  it("rejects request bodies that are too large", async () => {
    const request = new Request("https://app.example/api", {
      method: "POST",
      body: JSON.stringify({ padding: "x".repeat(2_000) }),
    });
    await expect(readJsonBody(request, 100)).rejects.toMatchObject({ status: 413 });
  });
});

describe("secret redaction", () => {
  it("redacts bearer tokens and provider keys", () => {
    expect(redactText("Authorization: Bearer abcdefghijklmnop")).not.toContain(
      "abcdefghijklmnop",
    );
    expect(redactText("key gsk_abcdefghijklmnop")).toBe("key [redacted]");
  });

  it("redacts token JSON and query parameters", () => {
    expect(redactText('{"access_token":"super-secret-value"}')).toBe(
      '{"access_token":"[redacted]"}',
    );
    const url = redactUrl("https://app.example/cb?code=abc&access_token=secret&state=ok");
    expect(url).not.toContain("secret");
    expect(url).toContain("state=ok");
  });

  it("masks short and long tokens", () => {
    expect(redactToken("short")).toBe("[redacted]");
    expect(redactToken("abcdefghijklmnop")).toBe("ab…op [redacted]");
  });

  it("turns unknown errors into safe text", () => {
    expect(toSafeErrorMessage(new Error("Bearer abcdefghijklmnop"))).not.toContain(
      "abcdefghijklmnop",
    );
    expect(toSafeErrorMessage(null, "fallback")).toBe("fallback");
    expect(toSafeErrorMessage("plain")).toBe("plain");
  });
});
