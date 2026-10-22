"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CircleAlert,
  Link2,
  Menu,
  Settings,
  X,
} from "lucide-react";
import { ChatMessage } from "@/components/chat-message";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { SettingsDialog } from "@/components/settings-dialog";
import { Sidebar } from "@/components/sidebar";
import type { ChatEvent } from "@/lib/chat-events";
import type {
  ChatMessage as ChatMessageType,
  ConnectionInfo,
  OAuthResult,
  Provider,
  Theme,
} from "@/lib/client-types";
import { runPuterTurn } from "@/lib/puter-chat";
import { PuterError } from "@/lib/puter-client";

type Props = {
  initialConnection: ConnectionInfo;
  oauthResult: OAuthResult;
};

type Toast = { tone: "success" | "error"; text: string } | null;

class AppError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Garmin connection was cancelled.",
  state_mismatch: "The connection attempt didn't match this browser. Start again.",
  state_expired: "That connection attempt expired. Start again.",
  missing_handshake: "The sign-in session expired. Start again.",
  missing_code: "MissingMCP did not return an authorization code.",
  provider_error: "MissingMCP reported an error during sign-in.",
  provider_configuration:
    "MissingMCP's OAuth setup doesn't match what this app needs (discovery or client registration failed).",
  token_exchange_failed: "MissingMCP rejected the token exchange. Start again.",
  expired_token: "MissingMCP returned an already-expired authorization. Start again.",
  discovery_failed:
    "Could not load MissingMCP's OAuth metadata. Check GARMIN_MCP_URL and try again.",
  registration_failed:
    "MissingMCP rejected this app's dynamic client registration. Try again.",
  registration_unsupported:
    "MissingMCP does not advertise dynamic client registration, so this app cannot connect without provider configuration.",
  invalid_metadata: "MissingMCP's OAuth metadata failed validation.",
  invalid_configuration: "GARMIN_MCP_URL is not a valid MCP endpoint.",
  pkce_unsupported: "MissingMCP does not support PKCE S256, which this app requires.",
  mcp_rejected_token: "MissingMCP accepted the sign-in but rejected the token for Garmin data.",
  no_read_only_tools: "Connected, but no supported read-only Garmin tools were found.",
  setup_required: "SESSION_SECRET must be configured before connecting Garmin.",
  connect_failed: "Could not connect Garmin. Try again.",
};

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function readStored<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
  } catch {
    return null;
  }
}

export function ChatApp({ initialConnection, oauthResult }: Props) {
  const [connection, setConnection] = useState<ConnectionInfo>(initialConnection);
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [provider, setProvider] = useState<Provider>(
    initialConnection.groqConfigured ? "groq" : "puter",
  );
  const [theme, setTheme] = useState<Theme>("system");
  const [isDark, setIsDark] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const oauthHandledRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/garmin/status", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as ConnectionInfo;
      setConnection(data);
    } catch {
      // Keep the last known state; failures surface when the user acts.
    }
  }, []);

  // Restore non-sensitive preferences only. Chats are never persisted.
  useEffect(() => {
    const storedProvider = readStored("garmin-chat-provider", ["groq", "puter"] as const);
    if (storedProvider === "puter" || (storedProvider === "groq" && initialConnection.groqConfigured)) {
      setProvider(storedProvider);
    }
    const storedTheme = readStored("garmin-chat-theme", ["light", "dark", "system"] as const);
    if (storedTheme) setTheme(storedTheme);
  }, [initialConnection.groqConfigured]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      setIsDark(dark);
    };
    apply();
    try {
      window.localStorage.setItem("garmin-chat-theme", theme);
    } catch {
      // Storage can be unavailable in private mode; the theme still applies.
    }
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!oauthResult || oauthHandledRef.current) return;
    oauthHandledRef.current = true;

    if (oauthResult.kind === "connected") {
      setToast({ tone: "success", text: "Garmin connected. Ask about your activities or recovery." });
      void refreshStatus();
    } else {
      setToast({
        tone: "error",
        text: OAUTH_ERROR_MESSAGES[oauthResult.reason] ?? "Garmin connection failed. Try again.",
      });
      void refreshStatus();
    }

    const url = new URL(window.location.href);
    ["garmin", "reason", "host"].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, "", url);
  }, [oauthResult, refreshStatus]);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const conversationTitle = useMemo(() => {
    const first = messages.find((message) => message.role === "user");
    if (!first) return "New conversation";
    return first.content.replace(/\s+/g, " ").slice(0, 64);
  }, [messages]);

  const hasMessages = messages.length > 0;
  const timeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  const patchMessage = useCallback(
    (
      id: string,
      patch:
        | Partial<ChatMessageType>
        | ((message: ChatMessageType) => Partial<ChatMessageType>),
    ) => {
      setMessages((previous) =>
        previous.map((message) =>
          message.id === id
            ? { ...message, ...(typeof patch === "function" ? patch(message) : patch) }
            : message,
        ),
      );
    },
    [],
  );

  const streamGroq = useCallback(
    async (history: ChatMessageType[], assistantId: string, signal: AbortSignal) => {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          messages: history
            .filter((message) => message.content.trim())
            .map((message) => ({ role: message.role, content: message.content })),
          timezone: timeZone,
        }),
        signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        throw new AppError(
          payload?.error?.code ?? "request_failed",
          payload?.error?.message ?? `The chat request failed (HTTP ${response.status}).`,
        );
      }
      if (!response.body) throw new AppError("empty_response", "Groq returned an empty stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: AppError | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let separator = buffer.indexOf("\n\n");
        while (separator !== -1) {
          const rawEvent = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          separator = buffer.indexOf("\n\n");

          const dataLine = rawEvent
            .split("\n")
            .find((line) => line.trimStart().startsWith("data:"));
          if (!dataLine) continue;

          let event: ChatEvent;
          try {
            event = JSON.parse(dataLine.trim().slice(5).trim()) as ChatEvent;
          } catch {
            continue;
          }

          if (event.type === "status") {
            setStatusLabel(event.label);
            patchMessage(assistantId, { statusLabel: event.label });
          } else if (event.type === "delta") {
            patchMessage(assistantId, (message) => ({
              content: message.content + event.text,
            }));
          } else if (event.type === "done") {
            patchMessage(assistantId, {
              status: "done",
              statusLabel: null,
              dateRange: event.dateRange,
              toolsUsed: event.toolsUsed,
              stopReason: event.stopReason,
            });
            setStatusLabel(null);
          } else if (event.type === "error") {
            streamError = new AppError(event.code, event.message);
          }
        }

        if (streamError) {
          await reader.cancel().catch(() => {});
          break;
        }
      }

      if (streamError) throw streamError;
    },
    [patchMessage, timeZone],
  );

  const send = useCallback(
    async (text: string, base?: ChatMessageType[]) => {
      const trimmed = text.trim();
      if (!trimmed || generating) return;

      if (provider === "groq" && !connection.groqConfigured) {
        setToast({
          tone: "error",
          text: "GROQ_API_KEY is not configured. Switch to Puter or add the key.",
        });
        return;
      }
      if (provider === "groq" && !connection.connected) {
        setToast({
          tone: "error",
          text: "Connect Garmin before asking Groq about your data.",
        });
        return;
      }

      const baseMessages = base ?? messages;
      const userMessage: ChatMessageType = {
        id: newId(),
        role: "user",
        content: trimmed,
        status: "done",
      };
      const assistantId = newId();
      const assistantMessage: ChatMessageType = {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "streaming",
        statusLabel: null,
        provider,
      };
      const history = [...baseMessages.filter((message) => message.content.trim()), userMessage];

      setMessages([...history, assistantMessage]);
      setGenerating(true);
      setStatusLabel(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (provider === "groq") {
          await streamGroq(history, assistantId, controller.signal);
        } else {
          const result = await runPuterTurn({
            history: history.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            timezone: timeZone,
            model: connection.puterModel,
            connected: connection.connected,
            signal: controller.signal,
            onDelta: (delta) => {
              patchMessage(assistantId, (message) => ({ content: message.content + delta }));
            },
            onStatus: (label) => {
              setStatusLabel(label);
              patchMessage(assistantId, { statusLabel: label });
            },
          });

          patchMessage(assistantId, {
            content: result.content,
            status: "done",
            statusLabel: null,
            toolsUsed: result.toolsUsed,
            dateRange: result.dateRange,
            stopReason: result.stopReason,
            provider: "puter",
          });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          patchMessage(assistantId, { stopReason: "cancelled" });
        } else {
          const code =
            error instanceof AppError || error instanceof PuterError ? error.code : "chat_failed";
          const message =
            error instanceof AppError || error instanceof PuterError
              ? error.message
              : "Something went wrong while answering. Retry your question.";
          patchMessage(assistantId, {
            status: "error",
            error: message,
            statusLabel: null,
          });
          if (code === "reconnect_required" || code === "not_connected") {
            setConnection((previous) => ({ ...previous, connected: false, expired: true }));
            // Clear the stale encrypted cookie with a normal JSON response.
            void fetch("/api/auth/garmin/disconnect", { method: "POST" }).catch(() => {});
          }
        }
      } finally {
        setMessages((previous) =>
          previous.flatMap((message) => {
            if (message.id !== assistantId) return [message];
            if (!message.content && !message.error) return [];
            return [
              {
                ...message,
                status: message.error ? "error" : "done",
                statusLabel: null,
                stopReason:
                  message.stopReason ??
                  (controller.signal.aborted ? "cancelled" : "complete"),
              },
            ];
          }),
        );
        setGenerating(false);
        setStatusLabel(null);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [
      connection,
      generating,
      messages,
      patchMessage,
      provider,
      streamGroq,
      timeZone,
    ],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(
    (messageId: string) => {
      if (generating) return;
      const index = messages.findIndex((message) => message.id === messageId);
      if (index < 0) return;
      let userIndex = index - 1;
      while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex -= 1;
      if (userIndex < 0) return;
      const prompt = messages[userIndex].content;
      const base = messages.slice(0, userIndex);
      setMessages(base);
      void send(prompt, base);
    },
    [generating, messages, send],
  );

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setGenerating(false);
    setStatusLabel(null);
    setToast(null);
  }, []);

  const connect = useCallback(() => {
    if (!connection.sessionConfigured) {
      setToast({
        tone: "error",
        text: "Add SESSION_SECRET (32+ characters) before connecting Garmin.",
      });
      return;
    }
    window.location.assign("/api/auth/garmin/start");
  }, [connection.sessionConfigured]);

  const disconnect = useCallback(async () => {
    abortRef.current?.abort();
    try {
      const response = await fetch("/api/auth/garmin/disconnect", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("disconnect failed");
      setConnection((previous) => ({
        ...previous,
        connected: false,
        expired: false,
        connectedAt: null,
        toolCount: null,
      }));
      setMessages([]);
      setSettingsOpen(false);
      setToast({
        tone: "success",
        text: "Garmin disconnected and this app's session was cleared.",
      });
    } catch {
      setToast({ tone: "error", text: "Could not disconnect Garmin. Try again." });
    }
  }, []);

  const changeProvider = useCallback((next: Provider) => {
    if (next === "groq" && !initialConnection.groqConfigured) return;
    setProvider(next);
    try {
      window.localStorage.setItem("garmin-chat-provider", next);
    } catch {
      // Preference persistence is optional.
    }
  }, [initialConnection.groqConfigured]);

  const toggleTheme = useCallback(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSettingsOpen(false);
    setToast({ tone: "success", text: "Conversation cleared from this tab." });
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        connection={connection}
        conversationTitle={conversationTitle}
        hasMessages={hasMessages}
        theme={isDark ? "dark" : "light"}
        onNewChat={newChat}
        onConnect={connect}
        onDisconnect={() => void disconnect()}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setSidebarOpen(false);
        }}
        onToggleTheme={toggleTheme}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
              aria-expanded={sidebarOpen}
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-bubble hover:text-foreground lg:hidden"
            >
              <Menu className="h-4 w-4" aria-hidden />
            </button>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-[13px] font-medium">
                {hasMessages ? conversationTitle : "New conversation"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 sm:hidden">
              <Activity className="h-4 w-4 text-accent" aria-hidden />
              <span className="text-[13px] font-semibold">Garmin Chat</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div
              role="group"
              aria-label="AI provider"
              className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
            >
              <button
                type="button"
                onClick={() => changeProvider("groq")}
                aria-pressed={provider === "groq"}
                disabled={!connection.groqConfigured}
                title={
                  connection.groqConfigured
                    ? `Groq · ${connection.groqModel}`
                    : "Add GROQ_API_KEY to enable Groq"
                }
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  provider === "groq"
                    ? "bg-surface-raised text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Groq
              </button>
              <button
                type="button"
                onClick={() => changeProvider("puter")}
                aria-pressed={provider === "puter"}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  provider === "puter"
                    ? "bg-surface-raised text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Puter
              </button>
            </div>

            <button
              type="button"
              onClick={() => (connection.connected ? setSettingsOpen(true) : connect())}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 text-[11px] font-medium transition-colors hover:border-border-strong"
              title={connection.connected ? "Garmin connected" : "Connect Garmin"}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connection.connected
                    ? "bg-success"
                    : connection.expired
                      ? "bg-warning"
                      : "bg-muted/60"
                }`}
                aria-hidden
              />
              <span className="hidden sm:inline">
                {connection.connected
                  ? "Connected"
                  : connection.expired
                    ? "Reconnect"
                    : "Not connected"}
              </span>
              <Link2 className="h-3.5 w-3.5 text-muted sm:hidden" aria-hidden />
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-bubble hover:text-foreground"
            >
              <Settings className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </header>

        {(!connection.sessionConfigured || !connection.groqConfigured) && (
          <div className="border-b border-border bg-warning-soft">
            <div className="mx-auto flex w-full max-w-3xl items-start gap-2 px-4 py-2.5 text-[11.5px] leading-relaxed text-foreground sm:px-6">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
              <p>
                <span className="font-medium">Setup needed.</span>{" "}
                {!connection.sessionConfigured &&
                  "Add SESSION_SECRET (32+ characters) so Garmin connections can be stored securely. "}
                {!connection.groqConfigured &&
                  "Add GROQ_API_KEY to enable Groq; Puter remains available for general chat. "}
                <span className="text-muted">Set these in your hosting environment, then reload.</span>
              </p>
            </div>
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            autoScrollRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 140;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {messages.length === 0 ? (
            <EmptyState
              connection={connection}
              provider={provider}
              onConnect={connect}
              onSuggestion={(prompt) => void send(prompt)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-6 sm:px-6 sm:py-8">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  timeZone={timeZone}
                  onRetry={retry}
                />
              ))}
              <div className="h-4" />
            </div>
          )}
        </div>

        <Composer
          onSend={(text) => void send(text)}
          onStop={stop}
          onConnect={connect}
          generating={generating}
          connected={connection.connected}
          provider={provider}
          groqConfigured={connection.groqConfigured}
        />
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        connection={connection}
        provider={provider}
        onProviderChange={changeProvider}
        theme={theme}
        onThemeChange={setTheme}
        onConnect={connect}
        onDisconnect={() => void disconnect()}
        onClearChat={clearChat}
        hasMessages={hasMessages}
      />

      <div aria-live="polite" className="sr-only">
        {statusLabel ?? ""}
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
          <div
            role={toast.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-md items-start gap-2.5 rounded-lg border px-3 py-2 text-[12px] shadow-lg ${
              toast.tone === "error"
                ? "border-danger/30 bg-danger-soft text-foreground"
                : "border-border bg-surface-raised text-foreground"
            }`}
          >
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                toast.tone === "error" ? "bg-danger" : "bg-success"
              }`}
              aria-hidden
            />
            <p className="leading-relaxed">{toast.text}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss message"
              className="ml-1 rounded p-0.5 text-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
