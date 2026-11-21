/**
 * Internal quality rubric injected into compiled generation prompts.
 * Deliberately internal: never rendered to the user as a checklist and
 * never presented as scores. Lives with the skills because it governs
 * generation prompt compilation, not conversation.
 */

export const GENERATION_RUBRIC = [
  "Before finalizing the prompt, internally verify it expresses:",
  "- A concrete visual concept tied to the brief (not a vague style description).",
  "- The user's stated constraints and preferences, unchanged.",
  "- Composition and hierarchy appropriate to the asset type.",
  "- Palette and style direction that can be rendered faithfully.",
  "- Technical constraints for the asset type (sizes, margins, legibility).",
  "Resolve any gap by enriching the prompt from the brief before generation.",
].join("\n")
