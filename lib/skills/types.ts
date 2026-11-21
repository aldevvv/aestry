import { z } from "zod"

export type SkillId = "app-icon" | "logo" | "og-image"

export type PreviewAspect = "square" | "landscape"

/**
 * Internal Aestry skills. Each asset type carries its own consultation
 * guidance, structured-brief expectations, and generation constraints. The
 * registry is consumed by the consultation orchestrator and by server-side
 * generation prompt compilation — it is not decorative metadata.
 */
export type AssetSkill = {
  id: SkillId
  name: string
  description: string
  /** How results should be previewed in the conversation. */
  previewAspect: PreviewAspect
  /** Preferred output size for OpenAI-compatible size-aware endpoints. */
  openAiSize: string
  /** Injected into the consultant system prompt for this asset type. */
  consultationInstructions: string
  /** What the design brief should capture for this asset type. */
  briefGuidance: string
  /** Core constraints applied when compiling the generation prompt. */
  generationInstructions: string
  /** How refinements should be interpreted for this asset type. */
  refinementInstructions: string
}

/**
 * The structured design brief shared between consultation and generation.
 * Fields are intentionally generic enough for all three skills; skill-level
 * guidance decides which fields matter most.
 */
export const designBriefSchema = z.object({
  concept: z.string().min(1),
  style: z.string().min(1),
  palette: z.string().min(1),
  composition: z.string().min(1),
  symbolism: z.string().nullish(),
  typography: z.string().nullish(),
  headline: z.string().nullish(),
  subline: z.string().nullish(),
  constraints: z.array(z.string()).max(8).nullish(),
})

export type DesignBrief = z.infer<typeof designBriefSchema>

/** Normalizes model-emitted nulls into undefined for clean storage. */
export function normalizeDesignBrief(
  value: z.infer<typeof designBriefSchema>
): DesignBrief {
  return {
    concept: value.concept,
    style: value.style,
    palette: value.palette,
    composition: value.composition,
    symbolism: value.symbolism ?? undefined,
    typography: value.typography ?? undefined,
    headline: value.headline ?? undefined,
    subline: value.subline ?? undefined,
    constraints: value.constraints ?? undefined,
  }
}
