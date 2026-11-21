/**
 * In-memory ring buffer of structured provider diagnostics for the
 * Terminal page. Events follow an allowlisted schema: identity, timing,
 * status, and counters only. Conversation content, prompts, provider
 * payloads, and credentials are never part of the default fields. A
 * truncated raw excerpt is attached only when the operator sets
 * AESTRY_ENABLE_DIAGNOSTICS=true, and even then credential values are
 * replaced with [redacted].
 */

export type DiagnosticLevel = "info" | "warn" | "error"

export type DiagnosticUsage = {
  promptTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export type DiagnosticEvent = {
  id: number
  at: string
  provider: string
  operation: string
  requestId?: string
  model?: string
  level: DiagnosticLevel
  message: string
  status?: number
  durationMs?: number
  usage?: DiagnosticUsage
  finishReason?: string
  eventCount?: number
  errorCategory?: string
  /** Bounded, non-sensitive elaboration of the event. */
  detail?: string
  /** Truncated raw evidence; only present when diagnostics are enabled. */
  excerpt?: string
}

export type DiagnosticInput = {
  provider: string
  operation: string
  requestId?: string
  model?: string
  level?: DiagnosticLevel
  message: string
  status?: number
  durationMs?: number
  usage?: DiagnosticUsage
  finishReason?: string
  eventCount?: number
  errorCategory?: string
  detail?: string
  excerpt?: string
  /** Credential values to scrub from the excerpt. */
  secret?: string
}

const MAX_ENTRIES = 300
const MAX_DETAIL_CHARS = 600
const MAX_EXCERPT_CHARS = 1_600

const entries: DiagnosticEvent[] = []
let nextId = 1

export function diagnosticsEnabled(): boolean {
  return process.env.AESTRY_ENABLE_DIAGNOSTICS === "true"
}

function bound(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}… [truncated]` : text
}

export function logDiagnostic(input: DiagnosticInput): void {
  let excerpt: string | undefined
  if (input.excerpt && diagnosticsEnabled()) {
    excerpt = input.secret
      ? bound(input.excerpt.split(input.secret).join("[redacted]"), MAX_EXCERPT_CHARS)
      : bound(input.excerpt, MAX_EXCERPT_CHARS)
  }
  entries.push({
    id: nextId++,
    at: new Date().toISOString(),
    provider: input.provider,
    operation: input.operation,
    requestId: input.requestId,
    model: input.model,
    level: input.level ?? "info",
    message: bound(input.message, MAX_DETAIL_CHARS),
    status: input.status,
    durationMs: input.durationMs,
    usage: input.usage,
    finishReason: input.finishReason,
    eventCount: input.eventCount,
    errorCategory: input.errorCategory,
    detail: input.detail ? bound(input.detail, MAX_DETAIL_CHARS) : undefined,
    excerpt,
  })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
}

export function getProviderLogs(): DiagnosticEvent[] {
  return [...entries].reverse()
}

export function clearProviderLogs(): void {
  entries.length = 0
}

/**
 * Transitional adapter for call sites not yet migrated to structured
 * events. The scope is split into provider/operation; raw detail may
 * contain payload fragments, so it is treated as a flag-gated excerpt
 * rather than a default field. Remaining call sites are removed when the
 * hand-written Google adapter is replaced by the official SDK.
 */
export function logProvider(entry: {
  scope: string
  level?: DiagnosticLevel
  message: string
  detail?: string
  secret?: string
}): void {
  const [provider, operation] = entry.scope.split(".")
  logDiagnostic({
    provider: provider || "unknown",
    operation: operation ?? "unknown",
    level: entry.level,
    message: entry.message,
    excerpt: entry.detail,
    secret: entry.secret,
  })
}
