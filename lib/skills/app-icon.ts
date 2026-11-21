import type { AssetSkill } from "./types"

export const appIconSkill: AssetSkill = {
  id: "app-icon",
  name: "App Icon",
  description: "Recognizable application icons that read clearly at small sizes.",
  previewAspect: "square",
  openAiSize: "1024x1024",
  consultationInstructions: [
    "You are helping the user design an application icon.",
    "Understand what the application does, its audience, and the single idea the icon should communicate.",
    "Explore the central symbol or glyph before anything else; an icon lives or dies by its silhouette.",
    "Discuss visual complexity deliberately: flat vs. subtly dimensional, geometric vs. organic.",
    "Consider color direction, but remember icons are viewed on many backgrounds and in light and dark system themes.",
    "Consider where it will be used (home screen, dock, favicon) and how it reads at 16px.",
    "Optical correctness matters: circles need slight overshoot against squares, and visual weight must balance optically, not mathematically.",
    "Keep safe margins inside the canvas so platform masking never clips the subject.",
    "Avoid suggesting embedded typography unless the user explicitly wants it.",
  ].join(" "),
  briefGuidance:
    "The brief must capture the central symbol, the visual style, the palette, and the composition within a square canvas.",
  generationInstructions: [
    "Create a single application icon.",
    "Square composition filling the canvas with comfortable safe margins around the subject.",
    "One clear central subject with a recognizable, strong silhouette that survives being shrunk to 16px.",
    "High contrast between the subject and its background; the icon must stay legible at very small sizes and against both light and dark home screens.",
    "Minimal fine detail; no thin lines or small shapes that disappear or alias when scaled down.",
    "Consistent visual weight, optically balanced geometry, and deliberate corner treatment appropriate to modern platform shapes (squircle, rounded square, or full-bleed as briefed).",
    "No thin outlines around the whole canvas, no drop shadows that read as artifacts, and no mockup context.",
    "Do not include text or lettering unless explicitly requested.",
    "The icon should look at home on a modern home screen or dock.",
  ].join(" "),
  refinementInstructions:
    "Refinements adjust the existing icon direction (shape, color, weight, detail level) while keeping the core symbol recognizable unless the user asks for a new symbol. When the user reports small-size legibility problems, reduce detail and increase contrast rather than adding ornament.",
}
