import type { ChatHistoryMessage } from "@/lib/groq";
import { HttpError } from "@/lib/http";

export type ChatRequestBody = { messages?: unknown; timezone?: unknown };

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function parseChatBody(body: ChatRequestBody): {
  messages: ChatHistoryMessage[];
  timezone: string;
} {
  const timezone =
    typeof body.timezone === "string" && isValidTimeZone(body.timezone)
      ? body.timezone
      : "UTC";

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new HttpError(400, "invalid_messages", "A non-empty messages array is required.");
  }
  if (body.messages.length > 30) {
    throw new HttpError(400, "invalid_messages", "Too many messages in this conversation.");
  }

  const messages: ChatHistoryMessage[] = [];
  let totalChars = 0;

  for (const entry of body.messages) {
    if (!entry || typeof entry !== "object") {
      throw new HttpError(400, "invalid_messages", "Each message must be an object.");
    }
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") {
      throw new HttpError(400, "invalid_messages", "Messages must be from user or assistant.");
    }
    if (typeof content !== "string" || !content.trim() || content.length > 8_000) {
      throw new HttpError(400, "invalid_messages", "Each message needs 1–8000 characters.");
    }
    totalChars += content.length;
    messages.push({ role, content });
  }

  if (totalChars > 40_000) {
    throw new HttpError(413, "invalid_messages", "This conversation is too large to send.");
  }
  if (messages[messages.length - 1]?.role !== "user") {
    throw new HttpError(400, "invalid_messages", "The last message must be from the user.");
  }

  return { messages, timezone };
}
