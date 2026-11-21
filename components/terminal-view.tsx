"use client"

import * as React from "react"
import { RefreshCwIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

type DiagnosticUsage = {
  promptTokens?: number
  outputTokens?: number
  totalTokens?: number
}

type DiagnosticEvent = {
  id: number
  at: string
  provider: string
  operation: string
  requestId?: string
  model?: string
  level: "info" | "warn" | "error"
  message: string
  status?: number
  durationMs?: number
  usage?: DiagnosticUsage
  finishReason?: string
  eventCount?: number
  errorCategory?: string
  detail?: string
  excerpt?: string
}

/**
 * Module-level log store: a single shared poller feeds the snapshot that
 * every Terminal view subscribes to via useSyncExternalStore — no setState
 * inside effects anywhere. The endpoint is operator-gated; a 401 simply
 * keeps the previous snapshot (the page shows the sign-in surface).
 */
let cachedLogs: DiagnosticEvent[] | null = null
const listeners = new Set<() => void>()
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollers = 0

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

async function refreshNow(): Promise<void> {
  try {
    const response = await fetch("/api/logs", { cache: "no-store" })
    if (response.status === 401) return
    const data: unknown = await response.json().catch(() => null)
    if (
      data &&
      typeof data === "object" &&
      Array.isArray((data as { logs?: unknown }).logs)
    ) {
      cachedLogs = (data as { logs: DiagnosticEvent[] }).logs
      notify()
    }
  } catch {
    // Keep the previous snapshot; the poll retries shortly.
  }
}

function startPolling(): void {
  pollers += 1
  if (pollTimer !== null) return
  void refreshNow()
  pollTimer = setInterval(() => void refreshNow(), 2_500)
}

function stopPolling(): void {
  pollers -= 1
  if (pollers <= 0 && pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  startPolling()
  return () => {
    listeners.delete(listener)
    stopPolling()
  }
}

function getSnapshot(): DiagnosticEvent[] | null {
  return cachedLogs
}

function getServerSnapshot(): DiagnosticEvent[] | null {
  return null
}

async function clearNow(): Promise<void> {
  try {
    await fetch("/api/logs", { method: "DELETE" })
    cachedLogs = []
    notify()
  } catch {
    // Leave the snapshot; the poll will resync.
  }
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false })
}

function levelClassName(level: DiagnosticEvent["level"]): string {
  switch (level) {
    case "error":
      return "text-destructive"
    case "warn":
      return "text-warning"
    default:
      return "text-muted-foreground"
  }
}

function usageText(usage: DiagnosticUsage | undefined): string | undefined {
  if (!usage) return undefined
  const parts = [
    usage.promptTokens !== undefined
      ? `${usage.promptTokens.toString()} prompt`
      : undefined,
    usage.outputTokens !== undefined
      ? `${usage.outputTokens.toString()} out`
      : undefined,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function TerminalView() {
  const logs = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [expandedId, setExpandedId] = React.useState<number | null>(null)
  const [clearing, setClearing] = React.useState(false)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshNow()}
          aria-label="Refresh diagnostics"
        >
          <RefreshCwIcon />
          Refresh
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={async () => {
            setClearing(true)
            await clearNow()
            setClearing(false)
          }}
          disabled={clearing}
        >
          {clearing ? <Spinner className="size-3.5" /> : <Trash2Icon />}
          Clear
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          Structured provider events · newest first
        </span>
      </div>
      {logs === null ? (
        <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/50" />
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No events yet — run a consultation or generation and structured
          diagnostics show up here. Raw excerpts require
          AESTRY_ENABLE_DIAGNOSTICS=true on the server.
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2 font-mono text-xs">
          {logs.map((log) => {
            const expanded = expandedId === log.id
            const meta = [
              log.model,
              log.status !== undefined ? `HTTP ${log.status.toString()}` : undefined,
              log.durationMs !== undefined
                ? `${log.durationMs.toString()}ms`
                : undefined,
              log.eventCount !== undefined
                ? `${log.eventCount.toString()} events`
                : undefined,
              log.finishReason,
              log.errorCategory ? `category: ${log.errorCategory}` : undefined,
              usageText(log.usage),
            ].filter(Boolean)
            return (
              <div
                key={log.id}
                className="border-b border-border/60 last:border-0"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId((previous) =>
                      previous === log.id ? null : log.id
                    )
                  }
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                  aria-expanded={expanded}
                >
                  <span className="shrink-0 tabular-nums text-muted-foreground/60">
                    {timeOf(log.at)}
                  </span>
                  <span className={`shrink-0 uppercase ${levelClassName(log.level)}`}>
                    {log.level}
                  </span>
                  <span className="shrink-0 text-foreground/80">
                    {log.provider}.{log.operation}
                  </span>
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    {log.message}
                  </span>
                  <span className="hidden shrink-0 text-muted-foreground/60 sm:block">
                    {meta.join(" · ")}
                  </span>
                </button>
                {expanded ? (
                  <div className="mx-2 mb-2 flex flex-col gap-2">
                    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/40 p-2.5 text-muted-foreground">
                      {log.requestId ? (
                        <p className="break-all">
                          <span className="text-muted-foreground/70">request:</span>{" "}
                          {log.requestId}
                        </p>
                      ) : null}
                      {meta.length > 0 ? <p>{meta.join(" · ")}</p> : null}
                    </div>
                    {log.detail ? (
                      <pre className="overflow-x-auto rounded-lg bg-muted/60 p-2.5 whitespace-pre-wrap break-words text-muted-foreground">
                        {log.detail}
                      </pre>
                    ) : null}
                    {log.excerpt ? (
                      <div className="flex flex-col gap-1">
                        <p className="text-muted-foreground/70">
                          Raw excerpt (diagnostics enabled)
                        </p>
                        <pre className="max-h-64 overflow-auto rounded-lg bg-muted/60 p-2.5 whitespace-pre-wrap break-words text-muted-foreground">
                          {log.excerpt}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { TerminalView }
