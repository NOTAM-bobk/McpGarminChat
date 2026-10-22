import { requireGarminAuth } from "@/lib/auth";
import { HttpError, jsonError } from "@/lib/http";
import { connectMcp, McpAuthError, McpError } from "@/lib/mcp";
import { toSafeErrorMessage } from "@/lib/redact";
import { filterAllowlistedTools, toGroqTools } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let auth;
  try {
    auth = await requireGarminAuth();
  } catch (error) {
    if (error instanceof HttpError) return jsonError(error.status, error.code, error.message);
    return jsonError(500, "session_error", "Could not read your session.");
  }

  const client = await connectMcp(auth.mcpUrl, auth.accessToken);
  try {
    const discovered = await client.listTools();
    const tools = filterAllowlistedTools(discovered);
    const adapted = toGroqTools(tools).map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
    return Response.json(
      { tools: adapted, count: adapted.length },
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
    return jsonError(500, "tools_failed", "Could not load Garmin tools.");
  } finally {
    await client.close().catch(() => {});
  }
}
