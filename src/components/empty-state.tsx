"use client";

import {
  Activity,
  Dumbbell,
  Footprints,
  HeartPulse,
  Link2,
  Moon,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { ConnectionInfo, Provider } from "@/lib/client-types";

type Suggestion = {
  icon: typeof Dumbbell;
  title: string;
  prompt: string;
};

const SUGGESTIONS: Suggestion[] = [
  {
    icon: Dumbbell,
    title: "Recent workouts",
    prompt: "Summarize my recent workouts, including dates, duration, and distance.",
  },
  {
    icon: Moon,
    title: "Last week's sleep",
    prompt: "How did I sleep over the last week? Include duration and sleep scores by night.",
  },
  {
    icon: Footprints,
    title: "Compare recent runs",
    prompt: "Compare my latest runs by distance, pace, and heart rate.",
  },
  {
    icon: HeartPulse,
    title: "Recovery check",
    prompt: "What does my recent recovery data show, including HRV and training readiness?",
  },
];

type Props = {
  connection: ConnectionInfo;
  provider: Provider;
  onConnect: () => void;
  onSuggestion: (prompt: string) => void;
  onOpenSettings: () => void;
};

export function EmptyState({
  connection,
  provider,
  onConnect,
  onSuggestion,
  onOpenSettings,
}: Props) {
  const connected = connection.connected;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-5 py-10 text-center sm:py-16">
      <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium text-muted">
        <Activity className="h-3.5 w-3.5 text-accent" aria-hidden />
        MissingMCP × Garmin
      </div>

      <h1 className="mt-5 max-w-lg text-balance text-3xl font-semibold tracking-tight sm:text-[2.35rem] sm:leading-[1.15]">
        Ask your training data a real question.
      </h1>
      <p className="mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted sm:text-[0.9375rem]">
        Garmin Chat reads your own activities, sleep, recovery, and training metrics through
        MissingMCP, then answers with Groq or Puter. No made-up workouts.
      </p>

      <div className="mt-6 flex flex-col items-center gap-2.5">
        {connected ? (
          <div className="inline-flex items-center gap-2 rounded-lg border border-success/25 bg-success-soft px-3 py-1.5 text-xs font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            Garmin connected
            <span className="font-normal text-muted">
              · {connection.toolCount ?? 0} read-only tools
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onConnect}
              disabled={!connection.sessionConfigured}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Link2 className="h-4 w-4" aria-hidden />
              Connect Garmin
            </button>
            <p className="text-[11px] text-muted">
              Sign-in happens on MissingMCP. This app never sees your Garmin password.
            </p>
          </>
        )}

        {provider === "puter" && !connected && (
          <p className="max-w-sm text-[11px] leading-relaxed text-muted">
            Puter is set to general chat. It cannot see Garmin data until you connect.
          </p>
        )}
      </div>

      <div className="mt-9 grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => {
          const Icon = suggestion.icon;
          return (
            <button
              key={suggestion.title}
              type="button"
              onClick={() => (connected ? onSuggestion(suggestion.prompt) : onConnect())}
              className="group flex items-start gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 transition-colors hover:border-border-strong hover:bg-surface-raised"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-raised text-muted-strong transition-colors group-hover:text-accent">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{suggestion.title}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted">
                  {suggestion.prompt}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Read-only access
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {provider === "groq" ? "Groq" : "Puter"} provider
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="underline decoration-border underline-offset-2 hover:text-foreground"
        >
          Privacy & settings
        </button>
      </div>
    </div>
  );
}
