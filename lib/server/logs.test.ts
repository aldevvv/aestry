import { afterEach, describe, expect, it, vi } from "vitest"

import {
  clearProviderLogs,
  getProviderLogs,
  logDiagnostic,
  logProvider,
} from "./logs"

afterEach(() => {
  clearProviderLogs()
  vi.unstubAllEnvs()
})

describe("diagnostic log", () => {
  it("stores allowlisted fields without excerpts by default", () => {
    logDiagnostic({
      provider: "google",
      operation: "chat.stream",
      requestId: "req-1",
      model: "gemini-test",
      level: "error",
      message: "stream finished · 0 chars",
      finishReason: "STOP",
      eventCount: 12,
      durationMs: 4321,
      errorCategory: "empty_response",
      excerpt: '{"candidates":[{"content":{"parts":[{"text":"secret reply"}]}}]}',
    })
    const [entry] = getProviderLogs()
    expect(entry.provider).toBe("google")
    expect(entry.operation).toBe("chat.stream")
    expect(entry.errorCategory).toBe("empty_response")
    expect(entry.finishReason).toBe("STOP")
    // Raw payload fragments stay out of the default event stream.
    expect(entry.excerpt).toBeUndefined()
    expect(JSON.stringify(entry)).not.toContain("secret reply")
  })

  it("attaches redacted excerpts only behind the diagnostics flag", () => {
    vi.stubEnv("AESTRY_ENABLE_DIAGNOSTICS", "true")
    logDiagnostic({
      provider: "google",
      operation: "chat.stream",
      message: "stream finished",
      excerpt: 'data: {"key":"AIzaSECRET","text":"hello"}',
      secret: "AIzaSECRET",
    })
    const [entry] = getProviderLogs()
    expect(entry.excerpt).toContain("[redacted]")
    expect(entry.excerpt).not.toContain("AIzaSECRET")
  })

  it("keeps the legacy call-site adapter on the safe path", () => {
    logProvider({
      scope: "openai.chat.stream",
      message: "stream finished · 5 chars",
      detail: "conversation content that must not ship by default",
      secret: "sk-test",
    })
    const [entry] = getProviderLogs()
    expect(entry.provider).toBe("openai")
    expect(entry.operation).toBe("chat")
    expect(entry.detail).toBeUndefined()
    expect(entry.excerpt).toBeUndefined()
  })

  it("caps the ring buffer at 300 entries, newest first", () => {
    for (let index = 0; index < 305; index += 1) {
      logDiagnostic({
        provider: "test",
        operation: "ring",
        message: `event ${index.toString()}`,
      })
    }
    const logs = getProviderLogs()
    expect(logs.length).toBe(300)
    expect(logs[0].message).toBe("event 304")
  })
})
