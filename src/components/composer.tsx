"use client";

import { useRef, useState } from "react";
import { ArrowUp, Link2, Square } from "lucide-react";
import type { Provider } from "@/lib/client-types";

type Props = {
  onSend: (text: string) => void;
  onStop: () => void;
  onConnect: () => void;
  generating: boolean;
  connected: boolean;
  provider: Provider;
  groqConfigured: boolean;
};

export function Composer({
  onSend,
  onStop,
  onConnect,
  generating,
  connected,
  provider,
  groqConfigured,
}: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const garminBlocked = provider === "groq" && !connected;
  const groqBlocked = provider === "groq" && !groqConfigured;
  const disabled = garminBlocked || groqBlocked;
  const canSend = !disabled && !generating && value.trim().length > 0;

  function submit() {
    const text = value.trim();
    if (!text || !canSend) return;
    setValue("");
    onSend(text);
    textareaRef.current?.focus();
  }

  return (
    <div className="border-t border-border bg-background">
      <div className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-6 sm:py-4">
        {disabled ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <div>
                <p className="text-sm font-medium">
                  {groqBlocked ? "Groq is not configured" : "Connect Garmin to use Groq"}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  {groqBlocked
                    ? "Add GROQ_API_KEY in your environment, or switch to Puter."
                    : "Groq answers use your real Garmin data through MissingMCP. Switch to Puter for general chat."}
                </p>
              </div>
            </div>
            {!groqBlocked && (
              <button
                type="button"
                onClick={onConnect}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
              >
                Connect Garmin
              </button>
            )}
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="rounded-2xl border border-border bg-surface-raised transition-colors focus-within:border-border-strong"
          >
            <label htmlFor="composer" className="sr-only">
              Message Garmin Chat
            </label>
            <textarea
              id="composer"
              ref={textareaRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder={
                provider === "puter" && !connected
                  ? "General chat — Garmin tools unavailable"
                  : "Ask about your activities, sleep, or recovery…"
              }
              className="max-h-44 min-h-[52px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[0.9375rem] leading-relaxed outline-none placeholder:text-muted"
            />

            <div className="flex items-center justify-between gap-3 px-2.5 pb-2">
              <span className="truncate text-[11px] text-muted">
                {provider === "puter" && !connected
                  ? "General chat — Garmin tools unavailable"
                  : "Enter to send · Shift+Enter for a new line"}
              </span>

              <div className="flex items-center gap-2">
                {generating ? (
                  <button
                    type="button"
                    onClick={onStop}
                    aria-label="Stop generating"
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-muted-strong transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    <Square className="h-3.5 w-3.5" aria-hidden />
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!canSend}
                    aria-label="Send message"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </form>
        )}

        <p className="mt-2 px-1 text-center text-[11px] leading-relaxed text-muted">
          {provider === "puter" && connected
            ? "Puter answers with Garmin data retrieved by this app's server. "
            : "Garmin data via MissingMCP. "}
          AI can make mistakes. Informational only — not medical advice.
        </p>
      </div>
    </div>
  );
}
