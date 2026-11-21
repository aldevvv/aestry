import { z } from "zod"

import { designBriefSchema } from "@/lib/skills/registry"

/**
 * Interaction blocks: model-selected presentation units from a trusted
 * registry. Every variant is typed, bounded, and serializable; the server
 * drops unknown or malformed entries individually so one bad block never
 * costs the user the whole reply.
 */
export const interactionBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("concept-comparison"),
    options: z
      .array(
        z.object({
          title: z.string().min(1).max(80),
          premise: z.string().min(1).max(400),
          composition: z.string().max(400).nullish(),
          tradeoffs: z.string().max(400).nullish(),
        })
      )
      .min(2)
      .max(4),
  }),
  z.object({
    type: z.literal("critique"),
    basedOn: z.enum(["reference-image", "generated-image", "description"]),
    strengths: z.array(z.string().min(1).max(300)).max(4),
    problems: z.array(z.string().min(1).max(300)).max(4),
    refinements: z.array(z.string().min(1).max(300)).max(4),
  }),
  z.object({
    type: z.literal("palette"),
    colors: z
      .array(
        z.object({
          hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          role: z.string().min(1).max(80),
        })
      )
      .min(2)
      .max(6),
    note: z.string().max(300).nullish(),
  }),
  z.object({
    type: z.literal("typography"),
    directions: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          attitude: z.string().min(1).max(200),
          note: z.string().max(200).nullish(),
        })
      )
      .min(2)
      .max(3),
  }),
  z.object({
    type: z.literal("generation-proposal"),
    summary: z.string().min(1).max(400),
    suggestedCount: z.union([z.literal(1), z.literal(2), z.literal(4)]).nullish(),
  }),
])

export type InteractionBlock = z.infer<typeof interactionBlockSchema>

export const CONSULTATION_INTENTS = [
  "answer",
  "clarify",
  "explore",
  "compare",
  "critique",
  "prepare",
  "generate",
  "refine",
] as const

export type ConsultationIntent = (typeof CONSULTATION_INTENTS)[number]

/**
 * How a multi-image generation should differ across items. These are not
 * interchangeable: distinct directions explore, single-concept variations
 * preserve one approved symbol, refinement edits an existing image.
 */
export const GENERATION_STRATEGIES = [
  "distinct-directions",
  "single-concept-variations",
  "refinement",
] as const

export type GenerationStrategy = (typeof GENERATION_STRATEGIES)[number]

export const generationPlanSchema = z.object({
  strategy: z.enum(GENERATION_STRATEGIES),
  /**
   * Per-image direction lines for "distinct-directions" (2-4 entries).
   * Ignored for the other strategies.
   */
  directions: z.array(z.string().min(1).max(400)).max(4).nullish(),
})

export type GenerationPlan = z.infer<typeof generationPlanSchema>

/**
 * Validated contract between the multimodal provider and the orchestrator.
 * The server parses the model's JSON output against this schema before the
 * client ever sees it; malformed output never becomes a fake design brief.
 * `intent` and `blocks` drive adaptive rendering — plain `message` text
 * remains a complete, first-class outcome on its own.
 */
export const consultationOutcomeSchema = z.object({
  message: z.string().min(1),
  phase: z.enum(["clarifying", "ready"]),
  /** The asset skill the consultant assigned to this conversation. */
  skill: z.enum(["app-icon", "logo", "og-image"]).nullish(),
  brief: designBriefSchema.nullish(),
  clarification: z
    .object({
      question: z.string().min(1),
      suggestions: z.array(z.string()).max(6).nullish(),
    })
    .nullish(),
  /** AI-proposed session title for the first consultation turn. */
  title: z.string().max(200).nullish(),
  /** What kind of interaction this turn is. Defaults to a plain answer. */
  intent: z.enum(CONSULTATION_INTENTS).nullish(),
  /** Optional presentation blocks; unknown or malformed ones are dropped. */
  blocks: z.array(z.unknown()).max(6).nullish(),
  /** Proposed strategy for an upcoming multi-image generation. */
  generationPlan: generationPlanSchema.nullish(),
})

export type ConsultationOutcome = {
  message: string
  phase: "clarifying" | "ready"
  skill?: "app-icon" | "logo" | "og-image"
  brief?: z.infer<typeof designBriefSchema>
  clarification?: { question: string; suggestions?: string[] }
  /** Sanitized AI-proposed session title, when the model supplied one. */
  title?: string
  intent: ConsultationIntent
  blocks: InteractionBlock[]
  /** Proposed strategy for an upcoming multi-image generation. */
  generationPlan?: z.infer<typeof generationPlanSchema>
  /**
   * False when the model's reply could not be parsed as the structured
   * contract and only its plain text was recovered. No brief is invented
   * in that case.
   */
  structured: boolean
}

export const chatRequestSchema = z.object({
  /** Which built-in provider handles this request; credentials resolve server-side. */
  providerId: z.enum(["gemini", "vertex"]),
  model: z.string().trim().min(1).max(120),
  skillId: z.enum(["app-icon", "logo", "og-image"]),
  brief: designBriefSchema.nullish(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(8_000),
      })
    )
    .max(80),
  referenceImages: z
    .array(
      z.object({
        mimeType: z.string().regex(/^image\//),
        data: z.string().min(1).max(11_000_000),
      })
    )
    .max(4)
    .optional(),
  projectContext: z.string().max(8_000).optional(),
  /** "compact" runs the auto-compaction pass instead of consultation. */
  mode: z.enum(["consult", "compact"]).default("consult"),
  /** Consultation streams over SSE by default. */
  stream: z.boolean().default(true),
})

export type ChatRequestBody = z.infer<typeof chatRequestSchema>

export type ChatApiResponse = {
  outcome?: ConsultationOutcome
  /** Compaction result when mode is "compact". */
  compaction?: { summary: string; decisions?: string[] }
  /** Prompt tokens reported by the provider for this request. */
  usage?: { promptTokens?: number }
  warning?: string
}
