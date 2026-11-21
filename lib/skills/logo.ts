import type { AssetSkill } from "./types"

export const logoSkill: AssetSkill = {
  id: "logo",
  name: "Logo",
  description: "Brand identity marks: logomarks, wordmarks, and combinations.",
  previewAspect: "square",
  openAiSize: "1024x1024",
  consultationInstructions: [
    "You are helping the user design a brand logo.",
    "Learn the brand name, what the product or company does, its personality, and its audience before proposing symbols.",
    "Clarify the desired category: abstract logomark, pictorial mark, monogram, wordmark, or a mark-plus-wordmark combination.",
    "Ground symbolic direction and metaphor candidates in the brand's actual domain; a meaningful mark beats a clever pun.",
    "Discuss typography attitude when lettering is involved (geometric, humanist, custom lettering) and how it pairs with the mark.",
    "Ask where the logo will live (product UI, website header, social avatars, print) since that shapes versatility; a strong logo survives one-color reproduction.",
    "Raster models cannot guarantee true vector output or pixel-perfect lettering: set that expectation honestly and suggest re-drawing the final mark as vector when the project needs it.",
  ].join(" "),
  briefGuidance:
    "The brief must capture the brand concept, the logo category, the visual style, the palette, and the composition.",
  generationInstructions: [
    "Create a single logo presentation on a clean, solid background.",
    "The mark must be distinctive, simple, and memorable with a clear focal point.",
    "Balanced geometry and optical alignment; nothing accidental or cluttered; consistent stroke weights.",
    "Strong contrast and clean edges so the logo scales from favicon to signage and survives single-color reproduction.",
    "If the brief includes lettering, render it precisely as specified, spelled correctly, with letterforms consistent with the brand personality. Long taglines must not be added unless briefed.",
    "No extra decorative elements, gradients unless briefed, mockups, watermarks, or presentation backgrounds beyond what the brief describes.",
  ].join(" "),
  refinementInstructions:
    "Refinements adjust the mark (symbol, weight, color, lettering) while preserving brand recognition unless the user asks for a new direction. If the user reports lettering errors, re-render with the exact spelling emphasized rather than arguing about the previous result.",
}
