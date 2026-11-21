import type { ChatRequestBody, ConsultationOutcome } from "./schema"

/**
 * Client-side consultation streaming: consumes the SSE wire from
 * POST /api/chat and exposes live deltas plus the final validated outcome.
 */

function isRecordPublic(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Extracts the growing `message` string from a partially streamed JSON
 * object. Handles escapes and stops at the closing quote; returns null
 * while the key has not started yet. The consultant is instructed to emit
 * `message` first so text can be rendered as it arrives.
 */
export function extractPartialMessage(raw: string): string | null {
  const match = /"message"\s*:\s*"/.exec(raw)
  if (!match) return null
  let index = match.index + match[0].length
  let out = ""
  while (index < raw.length) {
    const character = raw[index]
    if (character === "\\") {
      const next = raw[index + 1]
      if (next === undefined) break // incomplete escape; completes next delta
      switch (next) {
        case '"':
          out += '"'
          break
        case "\\":
          out += "\\"
          break
        case "/":
          out += "/"
          break
        case "n":
          out += "\n"
          break
        case "t":
          out += "\t"
          break
        case "r":
          out += "\r"
          break
        case "u": {
          const hex = raw.slice(index + 2, index + 6)
          if (hex.length < 4) return out
          out += String.fromCharCode(Number.parseInt(hex, 16))
          index += 4
          break
        }
        default:
          out += next
      }
      index += 2
      continue
    }
    if (character === '"') break // message string closed
    out += character
    index += 1
  }
  return out
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
