import type { ChatRequestBody, ConsultationOutcome } from "./schema"

/**
 * Client-side consultation streaming: consumes the SSE wire from
 * POST /api/chat. The server extracts the user-facing message server-side,
 * so deltas are clean text — no JSON scaffolding ever crosses the wire.
 */

function isRecordPublic(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; promptTokens: number }
  | { type: "outcome"; outcome: ConsultationOutcome; warning?: string }
  | { type: "error"; error: string }

function parseStreamEvent(line: string): StreamEvent | null {
  if (line === "[DONE]") return null
  try {
    const event: unknown = JSON.parse(line)
    if (!isRecordPublic(event) || typeof event.type !== "string") return null
    if (event.type === "delta" && typeof event.text === "string") {
      return { type: "delta", text: event.text }
    }
    if (
      event.type === "usage" &&
      isRecordPublic(event.usage) &&
      typeof event.usage.promptTokens === "number"
    ) {
      return { type: "usage", promptTokens: event.usage.promptTokens }
    }
    if (event.type === "error" && typeof event.error === "string") {
      return { type: "error", error: event.error }
    }
    if (
      event.type === "outcome" &&
      isRecordPublic(event.outcome)
    ) {
      return {
        type: "outcome",
        outcome: event.outcome as unknown as ConsultationOutcome,
        warning:
          typeof event.warning === "string" ? event.warning : undefined,
      }
    }
    return null
  } catch {
    return null
  }
}

function createSseParser(onData: (line: string) => void) {
  let buffer = ""
  return {
    push(chunk: string) {
      buffer += chunk
      let separator = buffer.indexOf("\n\n")
      while (separator !== -1) {
        const block = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        for (const line of block.split("\n")) {
          const trimmed = line.trim()
          if (trimmed.startsWith("data:")) {
            onData(trimmed.slice(5).trim())
          }
        }
        separator = buffer.indexOf("\n\n")
      }
    },
    flush() {
      if (buffer.trim()) {
        for (const line of buffer.split("\n")) {
          const trimmed = line.trim()
          if (trimmed.startsWith("data:")) {
            onData(trimmed.slice(5).trim())
          }
        }
        buffer = ""
      }
    },
  }
}

export type ChatStreamHandlers = {
  onDelta?: (text: string) => void
  onUsage?: (promptTokens: number) => void
}

export type ChatStreamResult =
  | { ok: true; outcome: ConsultationOutcome; warning?: string }
  | { ok: false; error: string }

/**
 * Runs a streamed consultation and reports deltas live. Resolves with the
 * validated outcome once the stream completes, or an error that is safe to
 * show inline.
 */
export async function streamChat(
  body: Omit<ChatRequestBody, "stream" | "mode"> & {
    stream?: true
    mode?: ChatRequestBody["mode"]
  },
  handlers: ChatStreamHandlers = {},
  signal?: AbortSignal
): Promise<ChatStreamResult> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("text/event-stream")) {
    // Non-streaming failure (validation, provider auth, etc.).
    const data: unknown = await response.json().catch(() => null)
    return {
      ok: false,
      error:
        isRecordPublic(data) && typeof data.error === "string"
          ? data.error
          : `Consultation failed (${response.status}).`,
    }
  }
  if (!response.body) {
    return { ok: false, error: "The consultation stream was empty." }
  }

  let outcome: ConsultationOutcome | null = null
  let warning: string | undefined
  let streamError: string | null = null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser((line) => {
    const event = parseStreamEvent(line)
    if (!event) return
    switch (event.type) {
      case "delta":
        handlers.onDelta?.(event.text)
        break
      case "usage":
        handlers.onUsage?.(event.promptTokens)
        break
      case "outcome":
        outcome = event.outcome
        warning = event.warning
        break
      case "error":
        streamError = event.error
        break
    }
  })

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.push(decoder.decode(value, { stream: true }))
  }

  if (streamError) return { ok: false, error: streamError }
  if (outcome) return { ok: true, outcome, warning }
  return { ok: false, error: "The consultation ended unexpectedly." }
}
