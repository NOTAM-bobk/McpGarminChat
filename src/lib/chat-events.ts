import type { ToolDateRange } from "@/lib/tools";

export type ChatEvent =
  | { type: "status"; stage: "connecting" | "thinking" | "tool"; label: string }
  | { type: "delta"; text: string }
  | {
      type: "done";
      dateRange: ToolDateRange | null;
      toolsUsed: string[];
      stopReason: "complete" | "step_limit" | "cancelled";
    }
  | { type: "error"; code: string; message: string };

export function encodeSse(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
