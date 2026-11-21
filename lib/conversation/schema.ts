import { z } from "zod"

import { designBriefSchema } from "@/lib/skills/registry"

/**
 * Validated contract between the multimodal provider and the orchestrator.
 * The server parses the model's JSON output against this schema before the
 * client ever sees it; malformed output never becomes a fake design brief.
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
})

export type ConsultationOutcome = {
  message: string
  phase: "clarifying" | "ready"
  skill?: "app-icon" | "logo" | "og-image"
  brief?: z.infer<typeof designBriefSchema>
  clarification?: { question: string; suggestions?: string[] }
  /** Sanitized AI-proposed session title, when the model supplied one. */
  title?: string
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
