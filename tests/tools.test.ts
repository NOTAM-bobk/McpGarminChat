import { describe, expect, it } from "vitest";
import type { McpTool } from "@/lib/mcp";
import {
  collectToolDateRange,
  filterAllowlistedTools,
  formatDateRange,
  isAllowedTool,
  MAX_EXPOSED_TOOLS,
  READ_ONLY_TOOL_ALLOWLIST,
  toGroqTools,
  ToolValidationError,
  toolActivityLabel,
  validateToolArguments,
} from "@/lib/tools";

describe("read-only allowlist", () => {
  it("allows known read-only tools", () => {
    expect(isAllowedTool("get_sleep_summary")).toBe(true);
    expect(isAllowedTool("get_activities_by_date")).toBe(true);
    expect(toolActivityLabel("get_sleep_summary")).toBe("Checking sleep data…");
  });

  it("never allows write tools or unknown names", () => {
    for (const name of [
      "update_activity",
      "delete_activity",
      "add_weigh_in",
      "create_workout",
      "schedule_workout",
      "set_user_profile",
      "download_activity_file",
      "unknown_tool",
      "__proto__",
    ]) {
      expect(isAllowedTool(name)).toBe(false);
    }
  });

  it("intersects discovered tools with the allowlist and drops destructive hints", () => {
    const discovered: McpTool[] = [
      { name: "get_sleep_summary" },
      { name: "update_activity" },
      { name: "get_activities" },
      { name: "get_activities" },
      { name: "get_stats", annotations: { destructiveHint: true } },
      { name: "get_training_status", annotations: { readOnlyHint: false } },
      { name: "get_hrv_data", annotations: { readOnlyHint: true } },
    ];
    expect(filterAllowlistedTools(discovered).map((tool) => tool.name)).toEqual([
      "get_sleep_summary",
      "get_activities",
      "get_hrv_data",
    ]);
  });

  it("caps the number of tools exposed to the model", () => {
    const discovered: McpTool[] = Object.keys(READ_ONLY_TOOL_ALLOWLIST).map((name) => ({
      name,
    }));
    expect(discovered.length).toBeGreaterThan(MAX_EXPOSED_TOOLS);
    expect(filterAllowlistedTools(discovered)).toHaveLength(MAX_EXPOSED_TOOLS);
  });
});

describe("schema adaptation", () => {
  it("sanitizes and bounds the function schema and description", () => {
    const [tool] = toGroqTools([
      {
        name: "get_activities_by_date",
        description: "x".repeat(900),
        inputSchema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: {
            startDate: { type: "string", description: "y".repeat(900) },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
          required: ["startDate"],
          additionalProperties: false,
        },
      },
    ]);

    expect(tool.function.name).toBe("get_activities_by_date");
    expect(tool.function.description.length).toBeLessThan(450);
    expect(tool.function.description).toContain("untrusted data");
    expect(tool.function.parameters).not.toHaveProperty("$schema");
    expect(tool.function.parameters.required).toEqual(["startDate"]);
    const properties = tool.function.parameters.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(String(properties.startDate.description).length).toBe(300);
    expect(properties.limit.maximum).toBe(100);
  });
});

describe("tool argument validation", () => {
  const tool: McpTool = {
    name: "get_activities_by_date",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string" },
        endDate: { type: "string" },
        limit: { type: "integer" },
        activityType: { type: "string", enum: ["running", "cycling"] },
      },
      required: ["startDate"],
    },
  };

  it("accepts valid arguments, including a JSON string", () => {
    expect(validateToolArguments(tool, { startDate: "2026-10-01" })).toEqual({
      startDate: "2026-10-01",
    });
    expect(
      validateToolArguments(tool, '{"startDate":"2026-10-01","limit":5}'),
    ).toEqual({ startDate: "2026-10-01", limit: 5 });
  });

  it("requires required properties", () => {
    expect(() => validateToolArguments(tool, {})).toThrow(ToolValidationError);
  });

  it("rejects unknown properties", () => {
    expect(() =>
      validateToolArguments(tool, { startDate: "2026-10-01", admin: true }),
    ).toThrow(/Unexpected tool argument/);
  });

  it("rejects wrong types and enum values", () => {
    expect(() =>
      validateToolArguments(tool, { startDate: "2026-10-01", limit: "5" }),
    ).toThrow(/Invalid type/);
    expect(() =>
      validateToolArguments(tool, { startDate: "2026-10-01", activityType: "swimming" }),
    ).toThrow(/Invalid value/);
  });

  it("rejects prototype pollution keys", () => {
    const dangerous = JSON.parse('{"startDate":"2026-10-01","__proto__":{"polluted":true}}');
    expect(() => validateToolArguments(tool, dangerous)).toThrow(/forbidden key/);
  });

  it("rejects non-object payloads and oversized payloads", () => {
    expect(() => validateToolArguments(tool, [])).toThrow(/JSON object/);
    expect(() =>
      validateToolArguments(tool, { startDate: "x".repeat(9_000) }),
    ).toThrow(ToolValidationError);
  });
});

describe("date range", () => {
  it("collects the actual dates passed to tools", () => {
    const range = collectToolDateRange([
      {
        name: "get_sleep_summary_range",
        arguments: { startDate: "2026-10-15", endDate: "2026-10-21" },
      },
    ]);
    expect(formatDateRange(range, "UTC")).toBe("Oct 15 – Oct 21, 2026");
  });

  it("keeps calendar dates stable across timezones", () => {
    const range = collectToolDateRange([
      { name: "get_activities", arguments: { date: "2026-01-01" } },
    ]);
    expect(range.dateOnly).toBe(true);
    expect(formatDateRange(range, "UTC")).toBe("Jan 1, 2026");
    expect(formatDateRange(range, "Asia/Tokyo")).toBe("Jan 1, 2026");
    expect(formatDateRange(range, "America/New_York")).toBe("Jan 1, 2026");
  });

  it("formats real timestamps in the browser timezone", () => {
    const range = collectToolDateRange([
      {
        name: "get_activities",
        arguments: { startTime: Date.UTC(2026, 0, 1, 2, 0, 0) },
      },
    ]);
    expect(range.dateOnly).toBe(false);
    expect(formatDateRange(range, "UTC")).toBe("Jan 1, 2026");
    expect(formatDateRange(range, "America/New_York")).toBe("Dec 31, 2025");
  });

  it("returns null when no explicit date was used", () => {
    const range = collectToolDateRange([{ name: "get_stats", arguments: { limit: 5 } }]);
    expect(range).toEqual({ start: null, end: null, dateOnly: false });
    expect(formatDateRange(range, "UTC")).toBeNull();
  });
});
