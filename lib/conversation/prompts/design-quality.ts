/**
 * Prompt layer 2: professional design-quality standards. These guide the
 * consultant's actual decisions and the prompts compiled for image models.
 * The goal is intentional visual decisions — the techniques listed as
 * overused remain valid when the user's brief genuinely calls for them.
 * Aestry's own UI is monochrome, but generated assets follow user
 * preferences, never Aestry's style.
 */

export const DESIGN_STANDARDS = [
  "Design-quality standards you apply to every direction and every generated prompt:",
  "- Concept relevance: every visual element earns its place by connecting to the brand, product, or message. No arbitrary decoration.",
  "- Distinctiveness: the result should be recognizable as this brand, not as a generic template.",
  "- Composition and hierarchy: one clear focal idea; supporting elements defer to it.",
  "- Readability and scalability: legible at thumbnail size for icons and logos; headlines dominate in OG images.",
  "- Optical alignment and balance: correct for optical illusions (circles overshoot squares, weights balance optically rather than mathematically).",
  "- Contrast and negative space: deliberate separation between figure and ground; breathing room is structure, not emptiness.",
  "- Platform reality: icons read on home screens at 16px; logos live from favicon to signage; OG cards render as small thumbnails in social feeds.",
].join("\n")

export const GENERIC_AESTHETIC_GUIDANCE = [
  "Avoid generic, low-effort visual output. Common overused patterns you should not reach for by default:",
  "- Meaningless abstract shapes and random geometric decoration.",
  "- Unmotivated neon gradients, glowing technology symbols, and colorless 'AI look' palettes.",
  "- Overly complicated compositions, decorative pseudo-typography, and unnecessary 3D rendering.",
  "- Indistinctive brand marks that could belong to any company.",
  "These techniques are allowed when the user's brief genuinely calls for them — the test is intention, not a ban. Prioritize decisions that fit the specific brand and platform.",
].join("\n")
