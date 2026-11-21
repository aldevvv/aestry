import { describe, expect, it } from "vitest"

import {
  compileGenerationPrompt,
  getSkill,
  SKILL_IDS,
} from "./registry"

const validBrief = {
  concept: "A compass rose merged with a code bracket",
  style: "Flat geometric, minimal detail",
  palette: "Charcoal on white with one warm accent",
  composition: "Centered glyph with generous safe margins",
}

describe("skill registry", () => {
  it("exposes exactly the three supported skills", () => {
    expect(SKILL_IDS).toEqual(["app-icon", "logo", "og-image"])
    for (const id of SKILL_IDS) {
      expect(getSkill(id).id).toBe(id)
    }
  })

  it("compiles a prompt that carries skill constraints and brief fields", () => {
    const prompt = compileGenerationPrompt("app-icon", validBrief)
    expect(prompt).toContain("application icon")
    expect(prompt).toContain(`Concept: ${validBrief.concept}`)
    expect(prompt).toContain(`Palette: ${validBrief.palette}`)
    expect(prompt).toContain("legible at very small sizes")
  })

  it("renders headline text exactly as written for OG images", () => {
    const prompt = compileGenerationPrompt("og-image", {
      ...validBrief,
      headline: "Ship design assets faster",
    })
    expect(prompt).toContain('Headline text, rendered exactly as written: "Ship design assets faster"')
  })

  it("appends refinement notes as adjustments, not new directions", () => {
    const prompt = compileGenerationPrompt("logo", validBrief, "Make it more minimal")
    expect(prompt).toContain("Apply this refinement while preserving the established direction: Make it more minimal")
  })

  it("rejects an incomplete brief", () => {
    expect(() =>
      compileGenerationPrompt("logo", {
        concept: "x",
        style: "y",
        palette: "z",
        composition: "",
      })
    ).toThrow()
  })
})
