/**
 * Extracts the growing `message` string from a partially streamed JSON
 * object. Handles escapes and stops at the closing quote; returns null
 * while the key has not started yet. The consultant is instructed to emit
 * `message` first so text can be rendered as it arrives.
 *
 * Runs SERVER-side during consultation streaming: the client only ever
 * receives extracted message text as typed delta events — never partial
 * JSON scaffolding.
 */
export function extractPartialMessage(raw: string): string | null {
  const match = /"message"\s*:\s*"/.exec(raw)
  if (!match) return null
  let index = match.index + match[0].length
  let out = ""
  while (index < raw.length) {
    const character = raw[index]
    if (character === "\\") {
      const next = raw[index + 1]
      if (next === undefined) break // incomplete escape; completes next delta
      switch (next) {
        case '"':
          out += '"'
          break
        case "\\":
          out += "\\"
          break
        case "/":
          out += "/"
          break
        case "n":
          out += "\n"
          break
        case "t":
          out += "\t"
          break
        case "r":
          out += "\r"
          break
        case "u": {
          const hex = raw.slice(index + 2, index + 6)
          if (hex.length < 4) return out
          out += String.fromCharCode(Number.parseInt(hex, 16))
          index += 4
          break
        }
        default:
          out += next
      }
      index += 2
      continue
    }
    if (character === '"') break // message string closed
    out += character
    index += 1
  }
  return out
}
