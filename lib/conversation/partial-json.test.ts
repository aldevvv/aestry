import { describe, expect, it } from "vitest"

import { extractPartialMessage } from "./partial-json"

describe("extractPartialMessage", () => {
  it("returns null before the message key starts", () => {
    expect(extractPartialMessage('{"mess')).toBeNull()
    expect(extractPartialMessage("")).toBeNull()
  })

  it("extracts the growing message text across deltas", () => {
    const first = extractPartialMessage('{"message": "Hel')
    expect(first).toBe("Hel")
    const more = extractPartialMessage('{"message": "Hello there, de')
    expect(more).toBe("Hello there, de")
    const closed = extractPartialMessage(
      '{"message": "Hello there, design friend.","phase": "ready"'
    )
    expect(closed).toBe("Hello there, design friend.")
  })

  it("decodes escape sequences progressively", () => {
    expect(extractPartialMessage('{"message": "line one\\nline t')).toBe(
      "line one\nline t"
    )
    expect(extractPartialMessage('{"message": "quote \\" inside an')).toBe(
      'quote " inside an'
    )
    expect(extractPartialMessage('{"message": "back\\\\slash an')).toBe(
      "back\\slash an"
    )
    // Incomplete escape at the stream tail is held back until complete.
    expect(extractPartialMessage('{"message": "trailing backslash \\')).toBe(
      "trailing backslash "
    )
  })

  it("handles unicode escapes that are still streaming", () => {
    expect(extractPartialMessage('{"message": "\\u00e9"}')).toBe("é")
    expect(extractPartialMessage('{"message": "\\u0')).toBe("")
  })

  it("finds the message key even when prose precedes it", () => {
    const raw = 'noise "with quotes" {"message": "actual text"}'
    expect(extractPartialMessage(raw)).toBe("actual text")
  })
})
