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
  /** The prompt actually sent for each item, in request order. */
  prompts?: string[]
  warning?: string
}

/**
 * The generation strategy proposed by the consultant and validated
 * server-side. These are not interchangeable operations: distinct
 * directions explore, single-concept variations preserve one approved
 * symbol, refinement edits an existing image.
 */
export type GenerationStrategy =
  | "distinct-directions"
  | "single-concept-variations"
  | "refinement"

export type GenerationPlan = {
  strategy: GenerationStrategy
  /** Per-image direction lines for "distinct-directions". */
  directions?: string[]
}

const VARIATION_INSTRUCTION =
  "Create a fresh rendering of the same single concept: the symbol, palette, and composition intent stay identical, with only incidental execution details varying between images."

/**
 * Composes the prompt actually sent for each image slot.
 *
 * - No plan (or refinement strategy): every slot gets the base prompt;
 *   provider sampling provides the natural variation.
 * - "single-concept-variations": base plus an explicit same-concept
 *   instruction, so divergence stays incidental.
 * - "distinct-directions": each slot carries its own direction line,
 *   cycling if the user requests more images than proposed directions.
 *
 * Fixed constraints (brand identity, palette, forbidden elements, skill
 * output rules) live in the base prompt and are preserved verbatim in
 * every slot.
 */
export function composeGenerationPrompts(
  basePrompt: string,
  plan: GenerationPlan | undefined,
  count: number
): string[] {
  const prompts: string[] = []
  for (let index = 0; index < count; index += 1) {
    if (
      plan?.strategy === "distinct-directions" &&
      plan.directions &&
      plan.directions.length > 0
    ) {
      const direction = plan.directions[index % plan.directions.length]
      const reiteration =
        index >= plan.directions.length
          ? " Second exploration of this direction with fresh execution."
          : ""
      prompts.push(
        `${basePrompt}\nDistinct direction for this image (variation ${index + 1} of ${count.toString()}): ${direction.trim()}${reiteration}`
      )
      continue
    }
    if (plan?.strategy === "single-concept-variations") {
      prompts.push(`${basePrompt}\n${VARIATION_INSTRUCTION}`)
      continue
    }
    prompts.push(basePrompt)
  }
  return prompts
}
