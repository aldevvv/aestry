import { describe, expect, it } from "vitest"

import {
  COMPACTION_OUTPUT_RESERVE_TOKENS,
  COMPACTION_SAFETY_OCCUPANCY,
  estimateTokens,
  parseCompactionReply,
  shouldAutoCompact,
} from "./compaction"

describe("estimateTokens", () => {
  it("uses ~4 characters per token", () => {
    expect(estimateTokens("abcd".repeat(100))).toBe(100)
    expect(estimateTokens("a")).toBe(1)
  })
})

describe("shouldAutoCompact", () => {
  it("reserves output headroom on top of projected input", () => {
    // budget = 100k * 0.9 = 90k; projected 80k + 8k reserve = 88k -> safe.
    expect(shouldAutoCompact(80_000, 100_000)).toBe(false)
    // 82k + 8k reserve = 90k -> at budget, compact.
    expect(shouldAutoCompact(82_000, 100_000)).toBe(true)
    expect(shouldAutoCompact(95_000, 100_000)).toBe(true)
  })

  it("uses a defensible budget, not a raw 95% of the window", () => {
    expect(COMPACTION_SAFETY_OCCUPANCY).toBe(0.9)
    expect(COMPACTION_OUTPUT_RESERVE_TOKENS).toBeGreaterThan(0)
    // The budget rule triggers EARLIER than the raw 95%: 85% occupancy plus
    // the output reserve already crosses the safety line.
    expect(shouldAutoCompact(85_000, 100_000)).toBe(true)
    // Comfortably below budget minus reserve: no compaction.
    expect(shouldAutoCompact(70_000, 100_000)).toBe(false)
  })

  it("never triggers when the window is unknown", () => {
    expect(shouldAutoCompact(1_000_000, undefined)).toBe(false)
    expect(shouldAutoCompact(1_000_000, 0)).toBe(false)
  })
})

describe("parseCompactionReply", () => {
  it("parses a valid compaction reply", () => {
    const outcome = parseCompactionReply(
      JSON.stringify({
        summary: "The user wants a charcoal compass icon; decisions locked.",
        decisions: ["Charcoal palette", "Compass symbol"],
      })
    )
    expect(outcome?.summary).toContain("compass icon")
    expect(outcome?.decisions).toEqual(["Charcoal palette", "Compass symbol"])
  })

  it("accepts JSON embedded in prose", () => {
    const outcome = parseCompactionReply(
      'Done.\n{"summary":"compacted state","decisions":null}'
    )
    expect(outcome?.summary).toBe("compacted state")
    expect(outcome?.decisions).toBeUndefined()
  })

  it("rejects malformed replies outright", () => {
    expect(parseCompactionReply("no json here")).toBeNull()
    expect(parseCompactionReply('{"wrong":"shape"}')).toBeNull()
  })
})
