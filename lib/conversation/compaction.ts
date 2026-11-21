import { z } from "zod"

/**
 * Auto-compaction: an internal maintenance skill. When the consultation
 * context approaches the model's window, the multimodal model itself
 * summarizes the conversation so far into a compact, decision-preserving
 * state. Older messages stay rendered and stored — only what is SENT to the
 * model is compacted.
 */

export const AUTO_COMPACT_THRESHOLD = 0.95

/**
 * Rough token estimate for planning text (~4 chars/token). Used only for
 * the compaction decision; authoritative usage comes from provider usage
 * metadata after each consultation.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Reference images are counted conservatively (~1k tokens each). */
export const ESTIMATED_TOKENS_PER_IMAGE = 1_000

export function shouldAutoCompact(
  projectedTokens: number,
  contextWindow: number | undefined
): boolean {
  if (!contextWindow || contextWindow <= 0) return false
  return projectedTokens / contextWindow >= AUTO_COMPACT_THRESHOLD
}

/**
 * System prompt for the compaction pass. It is an internal maintenance
 * instruction set, separate from the design-consultant persona.
 */
export function buildCompactionSystemPrompt(): string {
  return [
    "You are Aestry's conversation compactor. The design consultation below is approaching the model's context window, so you will compress it.",
    "Read the conversation and produce a compact continuation state that lets the design consultation resume seamlessly:",
    "- Keep every settled design decision (palette, style, composition, symbolism, wording) in brief detail.",
    "- Keep explicit user corrections and preferences — these outrank everything else.",
    "- Keep unresolved questions and the current next step.",
    "- Drop pleasantries, duplicated reasoning, and superseded proposals.",
    "- Never invent decisions that were not made.",
    "Respond with ONLY a single JSON object, no markdown, matching exactly:",
    '{"summary": string, "decisions": string[]}',
    '"summary" is one tight paragraph of the current design state. "decisions" lists short bullet-like commitments (max 10).',
  ].join("\n")
}

export const compactionOutcomeSchema = z.object({
  summary: z.string().min(1),
  decisions: z.array(z.string()).max(10).nullish(),
})

export type CompactionOutcome = {
  summary: string
  decisions?: string[]
}

/**
 * Parses a compaction reply. Degraded output is rejected outright —
 * compacting with an unusable summary would silently lose context.
 */
export function parseCompactionReply(text: string): CompactionOutcome | null {
  const raw = text.trim()
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    const parsed = compactionOutcomeSchema.safeParse(JSON.parse(raw.slice(start, end + 1)))
    if (!parsed.success) return null
    return {
      summary: parsed.data.summary,
      decisions: parsed.data.decisions ?? undefined,
    }
  } catch {
    return null
  }
}
