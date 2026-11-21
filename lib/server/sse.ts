/**
 * Server-side SSE line parser for upstream provider streams (Google's
 * alt=sse and OpenAI-compatible chat streams both emit `data: {...}` lines).
 */
export function createUpstreamSseParser(onData: (data: string) => void) {
  let buffer = ""
  return {
    push(chunk: string) {
      buffer += chunk
      let separator = buffer.indexOf("\n\n")
      while (separator !== -1) {
        const block = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        for (const line of block.split("\n")) {
          const trimmed = line.trim()
          if (trimmed.startsWith("data:")) {
            onData(trimmed.slice(5).trim())
          }
        }
        separator = buffer.indexOf("\n\n")
      }
    },
    flush() {
      if (buffer.trim()) {
        for (const line of buffer.split("\n")) {
          const trimmed = line.trim()
          if (trimmed.startsWith("data:")) {
            onData(trimmed.slice(5).trim())
          }
        }
        buffer = ""
      }
    },
  }
}
