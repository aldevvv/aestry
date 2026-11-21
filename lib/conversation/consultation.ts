import {
  consultationOutcomeSchema,
  interactionBlockSchema,
  type InteractionBlock,
  type ConsultationOutcome,
} from "./schema"
import type { Message } from "./types"
import { buildConsultationSystemPrompt } from "./prompts/compose"

/**
 * Server-side consultation layer: composes the consultant system prompt
 * from the layered prompt modules and parses the model's reply into a
 * validated outcome. Pure functions — unit-testable without network access.
 */

export { buildConsultationSystemPrompt }

/** Maximum visible characters for AI-generated session titles. */
export const SESSION_TITLE_MAX_CHARS = 60

/**
 * Sanitizes a model-proposed session title: strips markdown and quote
 * characters, collapses whitespace, and enforces a Unicode-aware 60
 * visible-character limit. Empty results are rejected so the caller keeps
 * its deterministic fallback.
 */
export function sanitizeSessionTitle(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const cleaned = raw
    .replace(/[`*_~#>[\]"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return undefined
  const visible = Array.from(cleaned)
  const capped = visible
    .slice(0, SESSION_TITLE_MAX_CHARS)
    .join("")
    .trimEnd()
  return capped.length > 0 ? capped : undefined
}

function extractJsonCandidate(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const raw = (fenced ? fenced[1] : text).trim()
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  return raw.slice(start, end + 1)
}

/**
 * Parses a raw model reply into a ConsultationOutcome. Malformed or
 * non-JSON replies degrade to a plain-text clarifying outcome — a fake
 * design brief is never fabricated.
 */
/**
 * Validates the model-proposed interaction blocks individually: unknown
 * types or malformed entries are dropped one by one so a single bad block
 * never costs the user the whole reply.
 */
function sanitizeInteractionBlocks(raw: unknown): InteractionBlock[] {
  if (!Array.isArray(raw)) return []
  const blocks: InteractionBlock[] = []
  for (const entry of raw.slice(0, 6)) {
    const parsed = interactionBlockSchema.safeParse(entry)
    if (parsed.success) {
      blocks.push(parsed.data)
    }
  }
  return blocks
}

export function parseConsultationReply(text: string): ConsultationOutcome {
  const candidate = extractJsonCandidate(text)
  if (candidate) {
    try {
      const parsed = consultationOutcomeSchema.safeParse(
        JSON.parse(candidate)
      )
      if (parsed.success) {
        const data = parsed.data
        const brief = data.brief
          ? {
              concept: data.brief.concept,
              style: data.brief.style,
              palette: data.brief.palette,
              composition: data.brief.composition,
              symbolism: data.brief.symbolism ?? undefined,
              typography: data.brief.typography ?? undefined,
              headline: data.brief.headline ?? undefined,
              subline: data.brief.subline ?? undefined,
              constraints: data.brief.constraints ?? undefined,
            }
          : undefined
        // "ready" without a usable brief is downgraded: no pretend-briefs.
        const phase = data.phase === "ready" && !brief ? "clarifying" : data.phase
        return {
          message: data.message,
          phase,
          skill: data.skill ?? undefined,
          brief,
          clarification: data.clarification
            ? {
                question: data.clarification.question,
                suggestions: data.clarification.suggestions ?? undefined,
              }
            : undefined,
          title: sanitizeSessionTitle(data.title),
          intent: data.intent ?? "answer",
          blocks: sanitizeInteractionBlocks(data.blocks),
          structured: true,
        }
      }
    } catch {
      // Fall through to plain-text recovery.
    }
  }
  return { message: text, phase: "clarifying", intent: "answer", blocks: [], structured: false }
}

/**
 * Serializes conversation history for the multimodal request. Bounded:
 * recent turns only, images are attached separately by the caller, and the
 * total text size is capped.
 */
export function buildConsultationTurns(
  messages: Message[],
  maxTurns = 16,
  maxCharacters = 16_000,
  afterMessageId?: string
): Array<{ role: "user" | "assistant"; text: string }> {
  // When the conversation was compacted, only send what came after the
  // compaction point — the summary itself is injected into the system prompt.
  const startIndex = afterMessageId
    ? messages.findIndex((message) => message.id === afterMessageId) + 1
    : 0
  const scoped = startIndex > 0 ? messages.slice(startIndex) : messages
  const turns: Array<{ role: "user" | "assistant"; text: string }> = []
  let characters = 0
  const recent = scoped.slice(-maxTurns).reverse()
  // Consecutive same-role turns are merged: Gemini rejects non-alternating
  // multiturn payloads, and failed turns can leave two user messages in a row.
  for (const message of recent) {
    let text = ""
    switch (message.content.type) {
      case "text":
      case "assistant-text":
        text = message.content.text
        break
      case "clarification":
        text = `Question from assistant: ${message.content.question}`
        break
      case "brief":
        text = `Design brief proposed: ${JSON.stringify(message.content.brief)}`
        break
      case "generation":
        text = "[Generated images shown to the user]"
        break
      case "context":
        text = `Project context gathered: ${message.content.summary}`
        break
      default:
        text = ""
    }
    if (!text.trim()) continue
    const bounded = text.length > 2_000 ? `${text.slice(0, 2_000)}…` : text
    if (characters + bounded.length > maxCharacters) break
    characters += bounded.length
    const last = turns[turns.length - 1]
    if (last && last.role === message.role) {
      last.text = `${last.text}\n\n${bounded}`
    } else {
      turns.push({ role: message.role, text: bounded })
    }
  }
  return turns.reverse()
}
