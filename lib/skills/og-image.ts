import type { AssetSkill } from "./types"

export const ogImageSkill: AssetSkill = {
  id: "og-image",
  name: "OG Image",
  description: "Open Graph social preview images in landscape composition.",
  previewAspect: "landscape",
  openAiSize: "1536x1024",
  consultationInstructions: [
    "You are helping the user design an Open Graph preview image (the link-unfurl card shared on social platforms).",
    "Learn the project name, the headline it should carry, and any supporting line.",
    "Clarify the visual subject and mood: abstract graphics, product-themed illustration, typography-led, or imagery-led.",
    "Consider brand colors and how the card reads next to typical social feeds; it must win a glance.",
    "Design the hierarchy explicitly: what is read first (headline), second (subject), and last (supporting details).",
    "Keep the scope tight: this is a single landscape card, not a poster series.",
    "Raster models often garble long text: for headlines beyond a few words, recommend deterministic text composition as a follow-up and keep the generated art as the background layer.",
  ].join(" "),
  briefGuidance:
    "The brief must capture the headline, the visual concept, the style, the palette, and the landscape layout hierarchy.",
  generationInstructions: [
    "Create a single Open Graph preview image in landscape orientation, composed for roughly 1200x630 with a readable crop.",
    "Strong visual hierarchy: the headline dominates, supporting text stays subordinate, and nothing competes with it.",
    "Generous safe margins; nothing important hugging the edges or near the corners where platform UI overlays sit.",
    "Backgrounds and graphics must not reduce headline legibility; keep sufficient contrast between type and its background across the whole type area.",
    "Render any headline text exactly as specified, spelled correctly, prominently and cleanly; keep headline length short enough to render reliably.",
    "The card must remain readable when previewed at small thumbnail sizes.",
  ].join(" "),
  refinementInstructions:
    "Refinements adjust the layout, subject, palette, or wording of the card while keeping the landscape hierarchy intact. When text renders incorrectly, prefer shortening the headline or moving text out of the generated image entirely.",
}
