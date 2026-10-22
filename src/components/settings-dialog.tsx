"use client";

import { useEffect, useRef } from "react";
import {
  Check,
  Link2,
  Link2Off,
  Monitor,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type {
  ConnectionInfo,
  Provider,
  Theme,
} from "@/lib/client-types";

type Props = {
  open: boolean;
  onClose: () => void;
  connection: ConnectionInfo;
  provider: Provider;
  onProviderChange: (provider: Provider) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onClearChat: () => void;
  hasMessages: boolean;
};

const THEMES: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function SettingsDialog({
  open,
  onClose,
  connection,
  provider,
  onProviderChange,
  theme,
  onThemeChange,
  onConnect,
  onDisconnect,
  onClearChat,
  hasMessages,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-xl sm:rounded-2xl"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 id="settings-title" className="text-sm font-semibold tracking-tight">
            Settings
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-bubble hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
          <section aria-labelledby="provider-heading">
            <div className="flex items-center justify-between">
              <h3
                id="provider-heading"
                className="text-[11px] font-medium uppercase tracking-wider text-muted"
              >
                AI provider
              </h3>
              <Sparkles className="h-3.5 w-3.5 text-muted" aria-hidden />
            </div>

            <div className="mt-2 space-y-2">
              <button
                type="button"
                onClick={() => onProviderChange("groq")}
                aria-pressed={provider === "groq"}
                disabled={!connection.groqConfigured}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  provider === "groq"
                    ? "border-accent bg-accent-soft"
                    : "border-border bg-surface hover:border-border-strong"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    Groq
                    <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-muted">
                      Primary
                    </span>
                  </span>
                  {provider === "groq" && <Check className="h-4 w-4 text-accent" aria-hidden />}
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">
                  Server-side answers with Garmin tools. Streaming supported.
                </span>
                <span className="mt-1.5 block text-[10.5px] text-muted">
                  {connection.groqConfigured
                    ? `Model: ${connection.groqModel}`
                    : "Not configured — add GROQ_API_KEY to enable."}
                </span>
              </button>

              <button
                type="button"
                onClick={() => onProviderChange("puter")}
                aria-pressed={provider === "puter"}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  provider === "puter"
                    ? "border-accent bg-accent-soft"
                    : "border-border bg-surface hover:border-border-strong"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    Puter
                    <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-muted">
                      Optional
                    </span>
                  </span>
                  {provider === "puter" && <Check className="h-4 w-4 text-accent" aria-hidden />}
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">
                  Browser chat with your Puter account. Garmin tools run on this app&apos;s server.
                </span>
                <span className="mt-1.5 block text-[10.5px] text-muted">
                  {connection.connected
                    ? `Garmin tools available · ${connection.puterModel}`
                    : `General chat — Garmin tools unavailable · ${connection.puterModel}`}
                </span>
              </button>
            </div>
          </section>

          <section aria-labelledby="connection-heading">
            <h3
              id="connection-heading"
              className="text-[11px] font-medium uppercase tracking-wider text-muted"
            >
              Garmin connection
            </h3>
            <div className="mt-2 rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    connection.connected
                      ? "bg-success"
                      : connection.expired
                        ? "bg-warning"
                        : "bg-muted/60"
                  }`}
                  aria-hidden
                />
                <p className="text-[13px] font-medium">
                  {connection.connected
                    ? "Connected"
                    : connection.expired
                      ? "Authorization expired"
                      : "Not connected"}
                </p>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                {connection.connected
                  ? `MissingMCP at ${connection.mcpHost}. Access is limited to read-only tools in this app.`
                  : `Garmin access is provided through MissingMCP at ${connection.mcpHost}. You sign in on their site; this app never asks for your Garmin password.`}
              </p>

              {connection.connected ? (
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-[11.5px] font-medium text-muted-strong transition-colors hover:border-border-strong hover:text-foreground"
                >
                  <Link2Off className="h-3.5 w-3.5" aria-hidden />
                  Disconnect Garmin
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onConnect}
                  disabled={!connection.sessionConfigured}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                  {connection.expired ? "Reconnect Garmin" : "Connect Garmin"}
                </button>
              )}

              {!connection.sessionConfigured && (
                <p className="mt-2 text-[10.5px] leading-relaxed text-warning">
                  SESSION_SECRET is missing. Garmin connections cannot be stored until it is
                  configured.
                </p>
              )}
            </div>
          </section>

          <section aria-labelledby="appearance-heading">
            <h3
              id="appearance-heading"
              className="text-[11px] font-medium uppercase tracking-wider text-muted"
            >
              Appearance
            </h3>
            <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-lg border border-border bg-surface p-1">
              {THEMES.map((option) => {
                const Icon = option.icon;
                const active = theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onThemeChange(option.value)}
                    aria-pressed={active}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium transition-colors ${
                      active
                        ? "border border-border bg-surface-raised text-foreground shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="privacy-heading">
            <h3
              id="privacy-heading"
              className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted"
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Privacy
            </h3>
            <ul className="mt-2 space-y-2 text-[11.5px] leading-relaxed text-muted">
              <li>
                Garmin access is provided through MissingMCP. MissingMCP handles the Garmin
                sign-in; this app never collects your Garmin password.
              </li>
              <li>
                Relevant Garmin data is sent to the selected provider only to answer your
                question: Groq from this app&apos;s server, or Puter from your browser.
              </li>
              <li>
                Puter uses your Puter account and its allowance or billing. Free tiers can
                impose limits.
              </li>
              <li>
                Conversation history lives in this browser tab only. Health chats are not saved
                to localStorage.
              </li>
              <li>
                Tokens stay in an encrypted, HttpOnly cookie and are never exposed to the page
                or to Puter.
              </li>
              <li>This app is not an official Garmin product.</li>
            </ul>
          </section>

          <section aria-labelledby="data-heading" className="border-t border-border pt-4">
            <h3
              id="data-heading"
              className="text-[11px] font-medium uppercase tracking-wider text-muted"
            >
              Conversation
            </h3>
            <button
              type="button"
              onClick={onClearChat}
              disabled={!hasMessages}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-danger/30 px-2.5 py-1.5 text-[11.5px] font-medium text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Clear conversation
            </button>
            <p className="mt-2 text-[10.5px] leading-relaxed text-muted">
              Clearing removes the messages from this tab. It does not delete anything from
              Garmin, MissingMCP, or your AI provider.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
