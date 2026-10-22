import { MCP_PROTOCOL_VERSION } from "@/lib/oauth-core";

/**
 * Minimal, dependency-free MCP Streamable HTTP client.
 *
 * MissingMCP's `/garmin/mcp` is a Streamable HTTP MCP server that may answer
 * with `application/json` or `text/event-stream`. Running the client on the
 * server keeps the Bearer token out of the browser, lets us allowlist tools,
 * and works within Vercel's request lifecycle (no long-lived process).
 */

export type FetchLike = typeof fetch;

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    [key: string]: unknown;
  };
};

export type McpJsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export class McpError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class McpAuthError extends McpError {
  constructor(message = "Your Garmin connection is no longer authorized. Reconnect Garmin.") {
    super("reconnect_required", message, 401);
  }
}

const MAX_DOCUMENT_BYTES = 2_000_000;
export const MAX_TOOL_OUTPUT_CHARS = 16_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const TOOL_TIMEOUT_MS = 20_000;

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_DOCUMENT_BYTES) {
      await reader.cancel().catch(() => {});
      throw new McpError("response_too_large", "The Garmin MCP server returned too much data.");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/** Parse an SSE body and return the JSON-RPC message matching `id`. */
export function extractSseMessage(
  body: string,
  id: number | string,
): McpJsonRpcResponse | null {
  const events = body.split(/\r?\n\r?\n/);
  for (const event of events) {
    const dataLines: string[] = [];
    for (const line of event.split(/\r?\n/)) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n");
    try {
      const parsed = JSON.parse(payload) as McpJsonRpcResponse;
      if (parsed && String(parsed.id) === String(id)) return parsed;
    } catch {
      // Ignore heartbeats and partial non-JSON events.
    }
  }
  return null;
}

function truncate(text: string, limit = MAX_TOOL_OUTPUT_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[Output truncated at ${limit} characters.]`;
}

/** Extract text from an MCP tools/call result, dropping images/resources. */
export function extractToolResultText(result: unknown): { text: string; isError: boolean } {
  const value = result as
    | { content?: unknown; structuredContent?: unknown; isError?: boolean }
    | null;
  const isError = Boolean(value && typeof value === "object" && value.isError);
  const chunks: string[] = [];

  if (value && Array.isArray(value.content)) {
    for (const block of value.content) {
      const item = block as { type?: string; text?: string };
      if (item?.type === "text" && typeof item.text === "string") chunks.push(item.text);
    }
  }

  if (chunks.length === 0 && value && value.structuredContent !== undefined) {
    try {
      chunks.push(JSON.stringify(value.structuredContent));
    } catch {
      chunks.push("[Unserializable structured content]");
    }
  }

  const text = chunks.join("\n").trim() || "[The Garmin tool returned no readable content.]";
  return { text: truncate(text), isError };
}

function mapHttpError(response: Response): McpError {
  const retryAfter = response.headers.get("retry-after");
  switch (response.status) {
    case 401:
      return new McpAuthError();
    case 403:
      return new McpError(
        "forbidden",
        "MissingMCP refused access to this Garmin account. Reconnect Garmin.",
        403,
      );
    case 404:
      return new McpError(
        "endpoint_not_found",
        "The Garmin MCP endpoint was not found. Check GARMIN_MCP_URL.",
        404,
      );
    case 429:
      return new McpError(
        "rate_limited",
        retryAfter
          ? `Garmin data access is rate limited. Try again in ${retryAfter} seconds.`
          : "Garmin data access is rate limited. Try again shortly.",
        429,
      );
    default:
      return new McpError(
        "mcp_request_failed",
        `The Garmin MCP server returned HTTP ${response.status}.`,
        response.status,
      );
  }
}

export class McpClient {
  private readonly url: string;
  private readonly accessToken: string;
  private readonly fetchImpl: FetchLike;
  private sessionId: string | null = null;
  private protocolVersion = MCP_PROTOCOL_VERSION;
  private nextId = 1;

  constructor(url: string, accessToken: string, fetchImpl: FetchLike = fetch) {
    this.url = url;
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.accessToken}`,
      "MCP-Protocol-Version": this.protocolVersion,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return headers;
  }

  private async post(
    body: Record<string, unknown>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    parentSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    parentSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      return await this.fetchImpl(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      if (controller.signal.aborted) {
        if (parentSignal?.aborted) throw new McpError("aborted", "Request cancelled.");
        throw new McpError("timeout", "The Garmin MCP server took too long to respond.");
      }
      throw new McpError(
        "mcp_unreachable",
        `Could not reach the Garmin MCP server${error instanceof Error ? `: ${error.name}` : "."}`,
      );
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    }
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    parentSignal?: AbortSignal,
  ): Promise<unknown> {
    const id = this.nextId++;
    const response = await this.post(
      { jsonrpc: "2.0", id, method, params },
      timeoutMs,
      parentSignal,
    );

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw mapHttpError(response);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (response.status === 202) {
      await response.body?.cancel().catch(() => {});
      return null;
    }

    const text = await readBounded(response);
    let message: McpJsonRpcResponse | null = null;
    if (contentType.includes("text/event-stream")) {
      message = extractSseMessage(text, id);
    } else {
      try {
        message = JSON.parse(text) as McpJsonRpcResponse;
      } catch {
        throw new McpError("invalid_response", "The Garmin MCP server returned invalid JSON.");
      }
    }

    if (!message) {
      throw new McpError("invalid_response", "The Garmin MCP server sent no matching response.");
    }
    if (message.error) {
      const messageText =
        typeof message.error.message === "string" && message.error.message
          ? message.error.message.slice(0, 300)
          : "The Garmin MCP tool rejected the request.";
      throw new McpError("mcp_error", messageText);
    }
    return message.result;
  }

  async initialize(parentSignal?: AbortSignal): Promise<void> {
    const result = (await this.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "garmin-chat", version: "0.1.0" },
      },
      DEFAULT_TIMEOUT_MS,
      parentSignal,
    )) as { protocolVersion?: string } | null;

    if (result && typeof result.protocolVersion === "string" && result.protocolVersion) {
      this.protocolVersion = result.protocolVersion;
    }

    // Notification: no id, no response body expected.
    const response = await this.post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      DEFAULT_TIMEOUT_MS,
      parentSignal,
    );
    await response.body?.cancel().catch(() => {});
    if (!response.ok) throw mapHttpError(response);
  }

  async listTools(parentSignal?: AbortSignal): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 4; page += 1) {
      const result = (await this.request(
        "tools/list",
        cursor ? { cursor } : {},
        DEFAULT_TIMEOUT_MS,
        parentSignal,
      )) as { tools?: unknown; nextCursor?: unknown } | null;

      if (result && Array.isArray(result.tools)) {
        for (const entry of result.tools) {
          const tool = entry as McpTool;
          if (typeof tool?.name === "string" && tool.name) {
            tools.push({
              name: tool.name,
              description: typeof tool.description === "string" ? tool.description : undefined,
              inputSchema:
                tool.inputSchema && typeof tool.inputSchema === "object"
                  ? tool.inputSchema
                  : { type: "object", properties: {} },
              annotations:
                tool.annotations && typeof tool.annotations === "object"
                  ? tool.annotations
                  : undefined,
            });
          }
        }
      }

      if (result && typeof result.nextCursor === "string" && result.nextCursor) {
        cursor = result.nextCursor;
      } else {
        break;
      }
    }

    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    parentSignal?: AbortSignal,
  ): Promise<{ text: string; isError: boolean }> {
    const result = await this.request(
      "tools/call",
      { name, arguments: args },
      TOOL_TIMEOUT_MS,
      parentSignal,
    );
    return extractToolResultText(result);
  }

  /** Best-effort session termination per Streamable HTTP transport. */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      await this.fetchImpl(this.url, {
        method: "DELETE",
        headers: this.headers(),
        signal: controller.signal,
        cache: "no-store",
      }).then((response) => response.body?.cancel().catch(() => {}));
    } catch {
      // Closing is advisory; ignore failures.
    } finally {
      clearTimeout(timer);
      this.sessionId = null;
    }
  }
}

/** Connect and initialize a short-lived MCP session for one request. */
export async function connectMcp(
  mcpUrl: string,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<McpClient> {
  const client = new McpClient(mcpUrl, accessToken, fetchImpl);
  await client.initialize();
  return client;
}
