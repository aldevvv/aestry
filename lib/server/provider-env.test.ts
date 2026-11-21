import { afterEach, describe, expect, it, vi } from "vitest"

import { readGoogleProviderConfigs } from "./provider-env"

afterEach(() => {
  vi.unstubAllEnvs()
})

function clearProviderEnv(): void {
  for (const key of [
    "GOOGLE_API_KEY",
    "AESTRY_GEMINI_CHAT_MODEL",
    "AESTRY_GEMINI_IMAGE_MODEL",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    "AESTRY_VERTEX_CHAT_MODEL",
    "AESTRY_VERTEX_IMAGE_MODEL",
  ]) {
    vi.stubEnv(key, "")
  }
}

describe("readGoogleProviderConfigs", () => {
  it("reports nothing configured without environment variables", () => {
    clearProviderEnv()
    const reading = readGoogleProviderConfigs()
    expect(reading.gemini).toBeUndefined()
    expect(reading.vertex).toBeUndefined()
    expect(reading.errors).toEqual([])
  })

  it("detects a complete Gemini Developer API configuration", () => {
    clearProviderEnv()
    vi.stubEnv("GOOGLE_API_KEY", "AIza-test")
    vi.stubEnv("AESTRY_GEMINI_CHAT_MODEL", "gemini-test-flash")
    const reading = readGoogleProviderConfigs()
    expect(reading.gemini).toMatchObject({
      providerId: "gemini",
      chatModelOverride: "gemini-test-flash",
    })
    expect(reading.errors).toEqual([])
  })

  it("treats a blank key as unconfigured, not broken", () => {
    clearProviderEnv()
    vi.stubEnv("GOOGLE_API_KEY", "   ")
    const reading = readGoogleProviderConfigs()
    expect(reading.gemini).toBeUndefined()
    expect(reading.errors).toEqual([])
  })

  it("detects a complete Vertex configuration", () => {
    clearProviderEnv()
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "my-project")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1")
    const reading = readGoogleProviderConfigs()
    expect(reading.vertex).toMatchObject({
      providerId: "vertex",
      project: "my-project",
      location: "us-central1",
    })
    expect(reading.errors).toEqual([])
  })

  it("reports a malformed Vertex configuration without echoing values", () => {
    clearProviderEnv()
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "my project with spaces!")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1")
    const reading = readGoogleProviderConfigs()
    expect(reading.vertex).toBeUndefined()
    expect(reading.errors.length).toBe(1)
    expect(reading.errors[0]).toContain("GOOGLE_CLOUD_PROJECT")
    expect(reading.errors[0]).not.toContain("spaces")
  })

  it("supports both providers configured side by side", () => {
    clearProviderEnv()
    vi.stubEnv("GOOGLE_API_KEY", "AIza-test")
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "my-project")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "global")
    const reading = readGoogleProviderConfigs()
    expect(reading.gemini).toBeDefined()
    expect(reading.vertex).toBeDefined()
  })
})
