import type { AssetSkill } from "./types"

export const logoSkill: AssetSkill = {
  id: "logo",
  name: "Logo",
  description: "Brand identity marks: logomarks, wordmarks, and combinations.",
  previewAspect: "square",
  openAiSize: "1024x1024",
  consultationInstructions: [
    "You are helping the user design a brand logo.",
    "Learn the brand name, what the product or company does, its personality, and its audience.",
    "Clarify the desired category: abstract logomark, pictorial mark, monogram, wordmark, or a mark-plus-wordmark combination.",
    "Discuss symbolic direction and metaphor candidates grounded in the brand's domain.",
    "Discuss typography attitude when lettering is involved, and color direction.",
    "Ask where the logo will live (product UI, website header, social avatars, print) since that shapes versatility.",
  ].join(" "),
  briefGuidance:
    "The brief must capture the brand concept, the logo category, the visual style, the palette, and the composition.",
  generationInstructions: [
    "Create a single logo presentation on a clean, solid background.",
    "The mark must be distinctive, simple, and memorable with a clear focal point.",
    "Balanced geometry and optical alignment; nothing accidental or cluttered.",
    "Strong contrast and clean edges so the logo scales from favicon to signage.",
    "If the brief includes lettering, render it precisely and consistently with the brand personality.",
    "No extra decorative elements, mockups, or backgrounds beyond what the brief describes.",
  ].join(" "),
  refinementInstructions:
    "Refinements adjust the mark (symbol, weight, color, lettering) while preserving brand recognition unless the user asks for a new direction.",
}
