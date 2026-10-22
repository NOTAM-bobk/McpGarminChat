"use client";

import {
  Activity,
  Link2,
  Link2Off,
  MessageSquare,
  Moon,
  Plus,
  Settings,
  Sun,
  X,
} from "lucide-react";
import type { ConnectionInfo, Theme } from "@/lib/client-types";

type Props = {
  open: boolean;
  onClose: () => void;
  connection: ConnectionInfo;
  conversationTitle: string;
  hasMessages: boolean;
  theme: Theme;
  onNewChat: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
};

export function Sidebar({
  open,
  onClose,
  connection,
  conversationTitle,
  hasMessages,
  theme,
  onNewChat,
  onConnect,
  onDisconnect,
  onOpenSettings,
  onToggleTheme,
}: Props) {
  const connected = connection.connected;
  const expired = connection.expired;

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <aside
        aria-label="Navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-[278px] shrink-0 flex-col border-r border-border bg-surface transition-transform duration-200 ease-out lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between px-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-raised">
              <Activity className="h-4 w-4 text-accent" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight tracking-tight">
                Garmin Chat
              </span>
              <span className="block text-[10px] leading-tight text-muted">
                via MissingMCP
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-1.5 text-muted hover:bg-bubble hover:text-foreground lg:hidden"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="px-3 pt-1">
          <button
            type="button"
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-[13px] font-medium transition-colors hover:border-border-strong hover:bg-bubble"
          >
            <Plus className="h-4 w-4 text-muted" aria-hidden />
            New chat
          </button>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
            Conversations
          </p>
          <div
            className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 ${
              hasMessages
                ? "border-border bg-surface-raised"
                : "border-dashed border-border/80 bg-transparent"
            }`}
          >
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0">
              <p
                className={`truncate text-[12.5px] ${
                  hasMessages ? "font-medium text-foreground" : "text-muted"
                }`}
              >
                {hasMessages ? conversationTitle : "New conversation"}
              </p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-muted">
                {hasMessages ? "In this tab only" : "Chats are not saved to this device"}
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-border p-3">
          <div className="rounded-xl border border-border bg-surface-raised p-3">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  connected ? "bg-success" : expired ? "bg-warning" : "bg-muted/60"
                }`}
                aria-hidden
              />
              <p className="text-[12.5px] font-medium">
                {connected
                  ? "Garmin connected"
                  : expired
                    ? "Reconnect Garmin"
                    : "Garmin not connected"}
              </p>
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              {connected
                ? `${connection.toolCount ?? 0} read-only tools · ${connection.mcpHost}`
                : expired
                  ? "Your authorization expired. Connect again to continue."
                  : `Connect through ${connection.mcpHost} to use your own data.`}
            </p>

            {connected ? (
              <button
                type="button"
                onClick={onDisconnect}
                className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11.5px] font-medium text-muted-strong transition-colors hover:border-border-strong hover:text-foreground"
              >
                <Link2Off className="h-3.5 w-3.5" aria-hidden />
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={onConnect}
                disabled={!connection.sessionConfigured}
                className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden />
                {expired ? "Reconnect Garmin" : "Connect Garmin"}
              </button>
            )}
            {!connection.sessionConfigured && (
              <p className="mt-2 text-[10px] leading-relaxed text-warning">
                SESSION_SECRET is not configured.
              </p>
            )}
          </div>

          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-strong transition-colors hover:bg-bubble hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden />
              Settings
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle color theme"
              title="Toggle color theme"
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-bubble hover:text-foreground"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" aria-hidden />
              ) : (
                <Moon className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>

          <p className="mt-2 px-2 text-[10px] leading-snug text-muted">
            Not an official Garmin product.
          </p>
        </div>
      </aside>
    </>
  );
}
