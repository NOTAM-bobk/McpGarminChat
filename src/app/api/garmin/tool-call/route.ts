import { requireGarminAuth } from "@/lib/auth";
import { HttpError, jsonError, readJsonBody, requireSameOrigin } from "@/lib/http";
import { connectMcp, McpAuthError, McpError } from "@/lib/mcp";
import { toSafeErrorMessage } from "@/lib/redact";
import {
  filterAllowlistedTools,
  isAllowedTool,
  toolActivityLabel,
  ToolValidationError,
  validateToolArguments,
} from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { name?: unknown; arguments?: unknown };

/**
 * Server-side Garmin tool execution for the Puter.js client loop.
 * The browser sends only a tool name and arguments; the MCP token stays here.
 */
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

  let body: Body;
  try {
    body = await readJsonBody<Body>(request, 16_000);
  } catch (error) {
    if (error instanceof HttpError) return jsonError(error.status, error.code, error.message);
    return jsonError(400, "invalid_body", "Invalid request body.");
  }

  if (typeof body.name !== "string" || !body.name || body.name.length > 100) {
    return jsonError(400, "invalid_tool", "A tool name is required.");
  }
  if (!isAllowedTool(body.name)) {
    return jsonError(403, "tool_not_allowed", "That Garmin tool is not available in this app.");
  }

  const client = await connectMcp(auth.mcpUrl, auth.accessToken);
  try {
    const discovered = await client.listTools();
    const tool = filterAllowlistedTools(discovered).find((entry) => entry.name === body.name);
    if (!tool) {
      return jsonError(404, "tool_unavailable", "That Garmin tool is not available right now.");
    }

    let args: Record<string, unknown>;
    try {
      args = validateToolArguments(tool, body.arguments);
    } catch (error) {
      if (error instanceof ToolValidationError) {
        return jsonError(400, "invalid_arguments", error.message);
      }
      return jsonError(400, "invalid_arguments", "Invalid tool arguments.");
    }

    const result = await client.callTool(body.name, args);
    return Response.json(
      {
        text: result.text,
        isError: result.isError,
        label: toolActivityLabel(body.name),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof McpAuthError) {
      await auth.store.destroy().catch(() => {});
      return jsonError(401, "reconnect_required", error.message);
    }
    if (error instanceof McpError) {
      return jsonError(502, error.code, toSafeErrorMessage(error));
    }
    return jsonError(500, "tool_failed", toSafeErrorMessage(error));
  } finally {
    await client.close().catch(() => {});
  }
}
