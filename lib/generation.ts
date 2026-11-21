import { z } from "zod"

export const generationRequestSchema = z.object({
  kind: z.enum(["google", "openai-compatible"]),
  apiKey: z.string().trim().min(1),
  model: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().optional(),
  prompt: z.string().trim().min(1, "A prompt is required").max(8000),
  count: z.number().int().min(1).max(4),
  referenceImages: z
    .array(
      z.object({
        mimeType: z.string().regex(/^image\//, "References must be images"),
        data: z
          .string()
          .min(1)
          .max(11_000_000, "A reference image is too large"),
      })
    )
    .max(4)
    .refine(
      (images) =>
        images.reduce((sum, image) => sum + image.data.length, 0) <=
        24_000_000,
      "Reference images are too large overall"
    )
    .optional(),
})

export type GenerationRequestBody = z.infer<typeof generationRequestSchema>

/**
 * Mirrors the provider adapter contract: each requested image is reported
 * independently so partial failures stay visible.
 */
export type GenerationResult =
  | { ok: true; mimeType: string; data: string }
  | { ok: false; error: string }

export type GenerationApiResponse = {
  results: GenerationResult[]
  /** The server-compiled generation prompt (metadata, no secrets). */
  prompt?: string
  warning?: string
}
