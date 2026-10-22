"use client";

import { useState } from "react";
import {
  Activity,
  CalendarDays,
  Check,
  CircleAlert,
  Copy,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/lib/client-types";
import { formatDateRange } from "@/lib/date-range";
import { Markdown } from "@/components/markdown";

type Props = {
  message: ChatMessageType;
  timeZone: string;
  onRetry: (messageId: string) => void;
};

export function ChatMessage({ message, timeZone, onRetry }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end animate-fade-rise">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-border bg-bubble px-4 py-2.5 text-[0.9375rem] leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  const range = formatDateRange(message.dateRange ?? null, timeZone);
  const toolsUsed = message.toolsUsed?.length ?? 0;
  const isStreaming = message.status === "streaming";

  return (
    <div className="flex gap-3 animate-fade-rise">
      <div className="mt-0.5 hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface sm:flex">
        <Activity className="h-4 w-4 text-accent" aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted">
          <span>Garmin Chat</span>
          {message.provider && (
            <>
              <span aria-hidden>·</span>
              <span className="normal-case tracking-normal">
                {message.provider === "groq" ? "Groq" : "Puter"}
              </span>
            </>
          )}
        </div>

        {isStreaming && message.statusLabel && (
          <div
            className="mb-2 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-muted"
            role="status"
            aria-live="polite"
          >
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden />
            {message.statusLabel}
          </div>
        )}

        {message.content ? (
          <div className="relative">
            <Markdown content={message.content} />
            {isStreaming && (
              <span
                className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-caret bg-accent"
                aria-hidden
              />
            )}
          </div>
        ) : (
          isStreaming && (
            <div className="space-y-2 py-1" aria-hidden>
              <div className="h-3 w-3/4 animate-pulse rounded bg-bubble" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-bubble" />
            </div>
          )
        )}

        {message.error && (
          <div
            role="alert"
            className="mt-3 flex flex-col gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
              <span>{message.error}</span>
            </span>
            <button
              type="button"
              onClick={() => onRetry(message.id)}
              className="inline-flex shrink-0 items-center gap-1.5 self-end rounded-md border border-border bg-surface-raised px-2.5 py-1 text-xs font-medium hover:border-border-strong sm:self-auto"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Retry
            </button>
          </div>
        )}

        {!isStreaming && message.content && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 pt-2 text-[11px] text-muted">
            {range && (
              <span className="inline-flex items-center gap-1.5" title="Date range used for this answer">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                {range}
              </span>
            )}
            {toolsUsed > 0 && (
              <span>
                {toolsUsed} Garmin {toolsUsed === 1 ? "source" : "sources"} retrieved
              </span>
            )}
            {message.stopReason === "step_limit" && (
              <span className="text-warning">Stopped at the tool-call limit</span>
            )}
            {message.stopReason === "cancelled" && <span>Stopped</span>}
            <button
              type="button"
              onClick={copy}
              className="ml-auto inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-bubble hover:text-foreground"
              aria-label="Copy response"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}

        {toolsUsed > 0 && !isStreaming && (
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Built from recorded Garmin data and AI interpretation. Informational only — not
            medical advice.
          </p>
        )}
      </div>
    </div>
  );
}
