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
  brief: designBriefSchema.nullish(),
  clarification: z
    .object({
      question: z.string().min(1),
      suggestions: z.array(z.string()).max(6).nullish(),
    })
    .nullish(),
})

export type ConsultationOutcome = {
  message: string
  phase: "clarifying" | "ready"
  brief?: z.infer<typeof designBriefSchema>
  clarification?: { question: string; suggestions?: string[] }
  /**
   * False when the model's reply could not be parsed as the structured
   * contract and only its plain text was recovered. No brief is invented
   * in that case.
   */
  structured: boolean
}

export const chatRequestSchema = z.object({
  kind: z.enum(["google", "openai-compatible"]),
  apiKey: z.string().trim().min(1),
  model: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().optional(),
  skillId: z.enum(["app-icon", "logo", "og-image"]),
  brief: designBriefSchema.nullish(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(8_000),
      })
    )
    .max(30),
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
})

export type ChatRequestBody = z.infer<typeof chatRequestSchema>

export type ChatApiResponse = {
  outcome: ConsultationOutcome
  warning?: string
}
