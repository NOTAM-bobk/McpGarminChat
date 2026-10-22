import type { ToolDateRange } from "@/lib/date-range";

export type Provider = "groq" | "puter";
export type Theme = "light" | "dark" | "system";

export type ConnectionInfo = {
  sessionConfigured: boolean;
  connected: boolean;
  expired: boolean;
  connectedAt: number | null;
  toolCount: number | null;
  mcpHost: string;
  sessionTtlSeconds: number;
  groqConfigured: boolean;
  groqModel: string;
  puterModel: string;
  oauthReady: boolean;
};

export type OAuthResult =
  | { kind: "connected" }
  | { kind: "error"; reason: string }
  | null;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  error?: string;
  statusLabel?: string | null;
  toolsUsed?: string[];
  dateRange?: ToolDateRange | null;
  stopReason?: "complete" | "step_limit" | "cancelled";
  provider?: Provider;
};
