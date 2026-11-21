import { describe, expect, it } from "vitest"

import {
  AUTO_COMPACT_THRESHOLD,
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
  it("triggers at the 95% threshold", () => {
    expect(shouldAutoCompact(95_000, 100_000)).toBe(true)
    expect(shouldAutoCompact(96_000, 100_000)).toBe(true)
    expect(shouldAutoCompact(94_000, 100_000)).toBe(false)
    expect(AUTO_COMPACT_THRESHOLD).toBe(0.95)
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
