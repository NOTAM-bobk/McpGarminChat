import { requireGarminAuth } from "@/lib/auth";
import { parseChatBody, type ChatRequestBody } from "@/lib/chat-request";
import { encodeSse, type ChatEvent } from "@/lib/chat-events";
import { getConfig } from "@/lib/config";
import { runGroqChat } from "@/lib/groq";
import { HttpError, jsonError, readJsonBody, requireSameOrigin } from "@/lib/http";
import { connectMcp } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel: bounded generation + a few tool round-trips. See README for plan limits.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
  } catch {
    return jsonError(403, "cross_origin_blocked", "Cross-origin request blocked.");
  }

  let auth;
  try {
    auth = await requireGarminAuth();
  } catch (error) {
    if (error instanceof HttpError) return jsonError(error.status, error.code, error.message);
    return jsonError(500, "session_error", "Could not read your session.");
  }

  let parsed;
  try {
    parsed = parseChatBody(await readJsonBody<ChatRequestBody>(request, 64_000));
  } catch (error) {
    if (error instanceof HttpError) return jsonError(error.status, error.code, error.message);
    return jsonError(400, "invalid_body", "Invalid request body.");
  }

  const config = getConfig();
  if (!config.groqApiKey) {
    return jsonError(
      503,
      "groq_not_configured",
      "GROQ_API_KEY is not configured. Add it in your environment variables, or use Puter.",
    );
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          // Client disconnected; the run loop will stop via the signal.
        }
      };

      try {
        await runGroqChat({
          messages: parsed.messages,
          timeZone: parsed.timezone,
          config,
          emit,
          signal: abort.signal,
          // The cookie cannot be mutated after SSE headers are sent; the client
          // clears the stale session via /api/auth/garmin/disconnect instead.
          connect: () => connectMcp(auth.mcpUrl, auth.accessToken),
        });
      } catch {
        emit({
          type: "error",
          code: "chat_failed",
          message: "The response failed unexpectedly. Retry your question.",
        });
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // Already closed/cancelled.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
