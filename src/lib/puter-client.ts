"use client";

/**
 * Thin bridge over Puter.js, loaded from https://js.puter.com/v2/.
 * Docs: https://docs.puter.com/AI/chat/
 *
 * Puter runs in the browser against the user's Puter account (user-pays
 * allowance). It never receives the MissingMCP access token; Garmin tool calls
 * go through our server route.
 */

export type PuterToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type PuterTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type PuterChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: PuterToolCall[];
  tool_call_id?: string;
  name?: string;
};

type PuterMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
};

type PuterChatOptions = {
  model?: string;
  tools?: PuterTool[];
  toolChoice?: "auto" | "none" | "required";
  stream?: boolean;
  normalize?: boolean;
  signal?: AbortSignal;
};

type PuterGlobal = {
  ai: {
    chat: (
      prompt: PuterChatMessage[] | string,
      options?: PuterChatOptions,
    ) => Promise<unknown>;
  };
  auth?: {
    isSignedIn?: () => boolean;
    getUser?: () => Promise<{ username?: string }>;
    signIn?: () => Promise<unknown>;
  };
};

declare global {
  interface Window {
    puter?: PuterGlobal;
  }
}

export class PuterError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function getPuter(): PuterGlobal | null {
  if (typeof window === "undefined") return null;
  return window.puter ?? null;
}

/**
 * Load the Puter.js SDK on demand, only when the Puter provider is used.
 * Keeping it lazy avoids sending every visitor's browser to a third party.
 */
export async function ensurePuter(timeoutMs = 15_000): Promise<PuterGlobal> {
  const existing = getPuter();
  if (existing) return existing;

  let failed = false;
  if (!document.querySelector('script[data-puter-sdk="true"]')) {
    const script = document.createElement("script");
    script.src = "https://js.puter.com/v2/";
    script.async = true;
    script.dataset.puterSdk = "true";
    script.addEventListener("error", () => {
      failed = true;
    });
    document.head.appendChild(script);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (failed) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const puter = getPuter();
    if (puter) return puter;
  }
  throw new PuterError(
    "puter_unavailable",
    "Puter.js could not load. Check your network or content blocker, then retry.",
  );
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        const item = part as { type?: string; text?: string };
        return item?.type === "text" && typeof item.text === "string" ? item.text : "";
      })
      .join("");
  }
  return "";
}

function normalizeToolCalls(value: unknown): PuterToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: PuterToolCall[] = [];
  for (const [index, entry] of value.entries()) {
    const item = entry as {
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: unknown };
    };
    const name = item?.function?.name;
    if (typeof name !== "string" || !name) continue;
    const args = item.function?.arguments;
    calls.push({
      id: typeof item.id === "string" && item.id ? item.id : `puter_call_${index}`,
      type: "function",
      function: {
        name,
        arguments:
          typeof args === "string"
            ? args
            : args && typeof args === "object"
              ? JSON.stringify(args)
              : "{}",
      },
    });
  }
  return calls;
}

export function extractPuterMessage(response: unknown): {
  content: string;
  toolCalls: PuterToolCall[];
} {
  if (typeof response === "string") return { content: response, toolCalls: [] };
  const value = response as {
    message?: PuterMessage;
    choices?: Array<{ message?: PuterMessage }>;
  } | null;
  const message = value?.message ?? value?.choices?.[0]?.message;
  if (!message) return { content: "", toolCalls: [] };
  return {
    content: contentToText(message.content),
    toolCalls: normalizeToolCalls(message.tool_calls),
  };
}

export async function puterChat(
  puter: PuterGlobal,
  messages: PuterChatMessage[],
  options: PuterChatOptions,
): Promise<unknown> {
  try {
    return await puter.ai.chat(messages, options);
  } catch (error) {
    throw toPuterError(error);
  }
}

/** Stream a general Puter answer. Falls back gracefully if the SDK can't stream. */
export async function streamPuterChat(
  puter: PuterGlobal,
  messages: PuterChatMessage[],
  options: Omit<PuterChatOptions, "stream" | "normalize">,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let response: unknown;
  try {
    response = await puter.ai.chat(messages, {
      ...options,
      stream: true,
      normalize: true,
    });
  } catch (error) {
    throw toPuterError(error);
  }

  // Some providers answer with a plain message even when streaming is asked for.
  const isAsyncIterable =
    Boolean(response) &&
    typeof response === "object" &&
    Symbol.asyncIterator in (response as object);
  if (!isAsyncIterable) {
    const { content } = extractPuterMessage(response);
    if (!content) throw new PuterError("puter_empty", "Puter returned an empty response.");
    onDelta(content);
    return content;
  }

  let text = "";
  try {
    for await (const part of response as AsyncIterable<unknown>) {
      if (signal?.aborted) break;
      if (typeof part === "string") {
        text += part;
        onDelta(part);
        continue;
      }
      const chunk = part as { type?: string; text?: string };
      if (chunk?.type === "text" && typeof chunk.text === "string") {
        text += chunk.text;
        onDelta(chunk.text);
      }
    }
  } catch (error) {
    if (signal?.aborted) return text;
    throw toPuterError(error);
  }

  if (!text && !signal?.aborted) {
    throw new PuterError("puter_empty", "Puter returned an empty response.");
  }
  return text;
}

export function toPuterError(error: unknown): PuterError {
  if (error instanceof PuterError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new PuterError("cancelled", "Generation stopped.");
  }
  const raw = error as {
    code?: string | number;
    message?: string;
    error?: { code?: string | number; message?: string };
    status?: number;
  };
  const message =
    raw?.error?.message || raw?.message || (typeof error === "string" ? error : "");
  const status = Number(raw?.status ?? raw?.code ?? 0);

  if (status === 401 || /sign in|unauthorized|authentication/i.test(message)) {
    return new PuterError(
      "puter_auth",
      "Puter needs you to sign in. Complete the Puter prompt and retry.",
    );
  }
  if (status === 402 || /allowance|insufficient|quota|credit|usage limit/i.test(message)) {
    return new PuterError(
      "puter_allowance",
      "Your Puter allowance for this model is exhausted. Try another Puter model or use Groq.",
    );
  }
  return new PuterError(
    "puter_error",
    message
      ? message.slice(0, 400)
      : "Puter could not complete this request. Retry or switch to Groq.",
  );
}
