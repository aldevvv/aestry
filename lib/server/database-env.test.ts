import { afterEach, describe, expect, it, vi } from "vitest"

import { readDatabaseProviderConfigs } from "./database-env"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

function clearDatabaseEnv(): void {
  for (const key of [
    "AESTRY_DATABASE_PROVIDER",
    "SUPABASE_DATABASE_URL",
    "NEON_DATABASE_URL",
    "DATABASE_URL",
  ]) {
    vi.stubEnv(key, "")
  }
}

describe("readDatabaseProviderConfigs", () => {
  it("reports nothing configured without environment variables", () => {
    clearDatabaseEnv()
    const reading = readDatabaseProviderConfigs()
    expect(reading.providers.every((provider) => !provider.configured)).toBe(true)
    expect(reading.activeProvider).toBeUndefined()
    expect(reading.errors).toEqual([])
  })

  it("activates a single detected provider", () => {
    clearDatabaseEnv()
    vi.stubEnv("NEON_DATABASE_URL", "postgresql://neon.example/db")
    const reading = readDatabaseProviderConfigs()
    expect(reading.activeProvider).toBe("neon")
    expect(reading.errors).toEqual([])
  })

  it("refuses to pick silently among multiple configurations", () => {
    clearDatabaseEnv()
    vi.stubEnv("SUPABASE_DATABASE_URL", "postgresql://supabase.example/db")
    vi.stubEnv("NEON_DATABASE_URL", "postgresql://neon.example/db")
    const reading = readDatabaseProviderConfigs()
    expect(reading.activeProvider).toBeUndefined()
    expect(reading.ambiguous).toEqual(["supabase", "neon"])
    expect(reading.errors.length).toBe(1)
  })

  it("honors an explicit provider selection among several", () => {
    clearDatabaseEnv()
    vi.stubEnv("SUPABASE_DATABASE_URL", "postgresql://supabase.example/db")
    vi.stubEnv("NEON_DATABASE_URL", "postgresql://neon.example/db")
    vi.stubEnv("AESTRY_DATABASE_PROVIDER", "supabase")
    const reading = readDatabaseProviderConfigs()
    expect(reading.activeProvider).toBe("supabase")
    expect(reading.errors).toEqual([])
  })

  it("rejects an unknown selection without echoing values", () => {
    clearDatabaseEnv()
    vi.stubEnv("AESTRY_DATABASE_PROVIDER", "mongodb")
    const reading = readDatabaseProviderConfigs()
    expect(reading.errors.length).toBe(1)
    expect(reading.errors[0]).toContain("AESTRY_DATABASE_PROVIDER")
  })

  it("reports a selection whose connection string is missing", () => {
    clearDatabaseEnv()
    vi.stubEnv("AESTRY_DATABASE_PROVIDER", "supabase")
    const reading = readDatabaseProviderConfigs()
    expect(reading.activeProvider).toBeUndefined()
    expect(
      reading.errors.some((error) => error.includes("supabase"))
    ).toBe(true)
  })
})

describe("checkDatabaseHealth", () => {
  it("reports a successful read-only check", async () => {
    vi.doMock("postgres", () => {
      const sql = Object.assign(
        async () => [{ version: "PostgreSQL 16.2 (Debian) on x86_64" }],
        {
          end: async () => undefined,
        }
      )
      const factory = (() => sql) as unknown
      return { default: factory }
    })
    const { checkDatabaseHealth: checkFresh } = await import("./database-health")
    const result = await checkFresh("postgresql://user:pass@db.example:5432/app")
    expect(result.verified).toBe(true)
    if (result.verified) {
      expect(result.serverVersion).toBe("PostgreSQL 16.2")
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    }
  })

  it("maps connection failures to sanitized errors", async () => {
    const failing = Object.assign(async () => {
      throw new Error("connect timeout expired")
    }, { end: async () => undefined })
    vi.doMock("postgres", () => ({ default: () => failing }))
    vi.resetModules()
    const { checkDatabaseHealth: checkFailing } = await import("./database-health")
    const result = await checkFailing("postgresql://user:pass@db.example:5432/app")
    expect(result.verified).toBe(false)
    if (!result.verified) {
      expect(result.errorCategory).toBe("network")
      // The raw provider error text never reaches the UI.
      expect(result.error).not.toContain("timeout expired")
    }
  })
})
