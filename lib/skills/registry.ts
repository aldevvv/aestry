import { appIconSkill } from "./app-icon"
import { logoSkill } from "./logo"
import { ogImageSkill } from "./og-image"
import {
  designBriefSchema,
  type AssetSkill,
  type DesignBrief,
  type SkillId,
} from "./types"

export type { AssetSkill, DesignBrief, SkillId, PreviewAspect } from "./types"
export { designBriefSchema, normalizeDesignBrief } from "./types"

export const SKILL_IDS: SkillId[] = ["app-icon", "logo", "og-image"]

const REGISTRY: Record<SkillId, AssetSkill> = {
  "app-icon": appIconSkill,
  logo: logoSkill,
  "og-image": ogImageSkill,
}

export function isSkillId(value: string): value is SkillId {
  return (SKILL_IDS as string[]).includes(value)
}

export function getSkill(skillId: SkillId): AssetSkill {
  const skill = REGISTRY[skillId]
  if (!skill) {
    throw new Error(`Unknown asset skill: ${skillId}`)
  }
  return skill
}

/**
 * Compiles the final image-generation prompt from the validated design brief
 * and the selected skill. Called server-side only: caller-supplied compiled
 * prompts are never trusted, the skill's constraints are enforced here.
 */
export function compileGenerationPrompt(
  skillId: SkillId,
  brief: DesignBrief,
  refinement?: string
): string {
  const skill = getSkill(skillId)
  // Re-validate defensively: the brief crossing the wire must satisfy the
  // schema even when callers already validated it.
  const parsed = designBriefSchema.safeParse(brief)
  if (!parsed.success) {
    throw new Error("The design brief is incomplete.")
  }
  const normalized = { ...brief, ...parsed.data }

  const lines: string[] = [skill.generationInstructions]
  lines.push(`Concept: ${normalized.concept}`)
  lines.push(`Style: ${normalized.style}`)
  lines.push(`Palette: ${normalized.palette}`)
  lines.push(`Composition: ${normalized.composition}`)
  if (normalized.symbolism) {
    lines.push(`Symbolism: ${normalized.symbolism}`)
  }
  if (normalized.typography) {
    lines.push(`Typography: ${normalized.typography}`)
  }
  if (normalized.headline) {
    lines.push(`Headline text, rendered exactly as written: "${normalized.headline}"`)
  }
  if (normalized.subline) {
    lines.push(`Supporting line, rendered exactly as written: "${normalized.subline}"`)
  }
  if (normalized.constraints && normalized.constraints.length > 0) {
    lines.push(`Additional constraints: ${normalized.constraints.join("; ")}`)
  }
  if (refinement && refinement.trim()) {
    lines.push(
      `Apply this refinement while preserving the established direction: ${refinement.trim()}`
    )
  }
  return lines.join("\n")
}
