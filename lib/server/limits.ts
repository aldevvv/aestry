/**
 * Request-level resource limits: bounded body reads and a small in-process
 * concurrency semaphore for billable provider operations. These complement
 * authorization — they bound what an authorized caller can do at once, and
 * blunt accidental floods in unprotected deployments.
 */

export type BodyRead =
  | { ok: true; data: unknown }
  | { ok: false; status: 400 | 413; error: string }

/**
 * Reads the request body with a hard size cap (declared content-length is
 * checked first, then the actual stream is capped while reading) and parses
 * it as JSON. Unbounded response.json()/text() calls on request bodies are
 * not allowed in API routes.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number
): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: "The request body is too large." }
  }
  const reader = request.body?.getReader()
  if (!reader) {
    return { ok: false, status: 400, error: "The request body is empty." }
  }
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      received += value.byteLength
      if (received > maxBytes) {
        void reader.cancel()
        return { ok: false, status: 413, error: "The request body is too large." }
      }
      chunks.push(value)
    }
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")
  try {
    return { ok: true, data: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, status: 400, error: "The request body is not valid JSON." }
  }
}

const activeSlots = new Map<string, number>()

/**
 * A held concurrency slot with single-owner release semantics. `release`
 * is idempotent: however many code paths reach it (request handler,
 * stream teardown, error paths), the slot is returned exactly once and
 * the counter can never underflow.
 */
export type ConcurrencySlot = {
  /** True once the slot has been released. */
  readonly released: boolean
  /** Returns the slot. Safe to call multiple times. */
  release: () => void
}

/** Takes one of `max` concurrent slots for `key`, or null when saturated. */
export function acquireSlot(key: string, max: number): ConcurrencySlot | null {
  const active = activeSlots.get(key) ?? 0
  if (active >= max) return null
  activeSlots.set(key, active + 1)
  let released = false
  return {
    get released() {
      return released
    },
    release() {
      if (released) return
      released = true
      const current = activeSlots.get(key) ?? 0
      if (current <= 1) {
        activeSlots.delete(key)
      } else {
        activeSlots.set(key, current - 1)
      }
    },
  }
}

/** Runs `operation` inside a bounded concurrency slot, or null when busy. */
export async function withSlot<T>(
  key: string,
  max: number,
  operation: () => Promise<T>
): Promise<T | null> {
  const slot = acquireSlot(key, max)
  if (!slot) return null
  try {
    return await operation()
  } finally {
    slot.release()
  }
}

const loginFailures: number[] = []
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_LOGIN_FAILURES_PER_WINDOW = 10

/** Sliding-window throttle on failed logins (per server process). */
export function loginThrottled(now = Date.now()): boolean {
  while (loginFailures.length > 0 && now - loginFailures[0] > LOGIN_WINDOW_MS) {
    loginFailures.shift()
  }
  return loginFailures.length >= MAX_LOGIN_FAILURES_PER_WINDOW
}

export function recordLoginFailure(now = Date.now()): void {
  loginFailures.push(now)
}

export function resetLoginThrottle(): void {
  loginFailures.length = 0
}
