/**
 * In-memory ring buffer of provider request/response diagnostics for the
 * Terminal page. Entries are written redacted: callers must never include
 * API keys — redactDetail() is the enforced helper for any detail that may
 * have touched a credential.
 */

export type ProviderLogLevel = "info" | "warn" | "error"

export type ProviderLogEntry = {
  id: number
  at: string
  scope: string
  level: ProviderLogLevel
  message: string
  detail?: string
}

const MAX_ENTRIES = 300
const MAX_DETAIL_CHARS = 4_000

const entries: ProviderLogEntry[] = []
let nextId = 1

export function logProvider(entry: {
  scope: string
  level?: ProviderLogLevel
  message: string
  detail?: string
  secret?: string
}): void {
  let detail = entry.detail
  if (detail && entry.secret) {
    detail = detail.split(entry.secret).join("[redacted]")
  }
  if (detail && detail.length > MAX_DETAIL_CHARS) {
    detail = `${detail.slice(0, MAX_DETAIL_CHARS)}… [truncated]`
  }
  entries.push({
    id: nextId++,
    at: new Date().toISOString(),
    scope: entry.scope,
    level: entry.level ?? "info",
    message: entry.message,
    detail,
  })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
}

export function getProviderLogs(): ProviderLogEntry[] {
  return [...entries].reverse()
}

export function clearProviderLogs(): void {
  entries.length = 0
}
