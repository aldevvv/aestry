import { describe, expect, it } from "vitest"

import { composeGenerationPrompts } from "./generation"

const BASE =
  "Create a single application icon.\nConcept: compass + bracket\nPalette: strict black on white"

describe("composeGenerationPrompts", () => {
  it("uses the base prompt for every slot without a plan", () => {
    const prompts = composeGenerationPrompts(BASE, undefined, 4)
    expect(prompts).toHaveLength(4)
    for (const prompt of prompts) {
      expect(prompt).toBe(BASE)
    }
  })

  it("maps one distinct direction per image slot", () => {
    const prompts = composeGenerationPrompts(
      BASE,
      {
        strategy: "distinct-directions",
        directions: [
          "Monolithic symbol architecture",
          "Negative-space construction",
          "Modular grid composition",
          "Unexpected symbolic abstraction",
        ],
      },
      4
    )
    expect(prompts).toHaveLength(4)
    expect(prompts[0]).toContain("Monolithic symbol architecture")
    expect(prompts[1]).toContain("Negative-space construction")
    expect(prompts[2]).toContain("Modular grid composition")
    expect(prompts[3]).toContain("Unexpected symbolic abstraction")
    // Fixed constraints survive verbatim in every slot.
    for (const prompt of prompts) {
      expect(prompt).toContain("Concept: compass + bracket")
      expect(prompt).toContain("Palette: strict black on white")
      expect(prompt).toContain("Create a single application icon.")
    }
  })

  it("cycles directions when the user requests more images than proposed", () => {
    const prompts = composeGenerationPrompts(
      BASE,
      { strategy: "distinct-directions", directions: ["Direction A", "Direction B"] },
      4
    )
    expect(prompts[0]).toContain("Direction A")
    expect(prompts[1]).toContain("Direction B")
    expect(prompts[2]).toContain("Direction A")
    expect(prompts[2]).toContain("Second exploration")
    expect(prompts[3]).toContain("Direction B")
  })

  it("keeps single-concept variations on one approved symbol", () => {
    const prompts = composeGenerationPrompts(
      BASE,
      { strategy: "single-concept-variations" },
      2
    )
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) {
      expect(prompt).toContain(BASE)
      expect(prompt).toContain("same single concept")
    }
  })

  it("leaves refinement prompts on the base (refinement text is compiled in)", () => {
    const prompts = composeGenerationPrompts(
      `${BASE}\nApply this refinement: sharper corners`,
      { strategy: "refinement" },
      1
    )
    expect(prompts[0]).toContain("sharper corners")
  })
})
