import { describe, expect, it } from "vitest"

import { migratePersistedProviders } from "./provider-store"

/**
 * Tests the actual persisted-state migration: v3 browser-held credentials
 * are stripped, Google selections carry over, and non-Google selections
 * are dropped rather than rerouted to a different billable provider.
 */

describe("provider store v3 -> v4 migration", () => {
  it("strips browser-held credentials and flags the removal", () => {
    const migrated = migratePersistedProviders(
      {
        providers: [
          { id: "p1", kind: "google", apiKey: "AIza-legacy" },
          { id: "p2", kind: "openai-compatible", apiKey: "sk-legacy" },
        ],
        selections: { consultation: null, generation: null },
      },
      3
    )
    expect(migrated.legacyCredentialsRemoved).toBe(true)
    expect(JSON.stringify(migrated)).not.toContain("AIza-legacy")
    expect(JSON.stringify(migrated)).not.toContain("sk-legacy")
    expect(migrated.selections?.consultation).toBeNull()
  })

  it("carries Google model preferences forward as gemini selections", () => {
    const migrated = migratePersistedProviders(
      {
        providers: [{ id: "p1", kind: "google", apiKey: "AIza-legacy" }],
        selections: {
          consultation: { providerId: "p1", model: "gemini-test-flash" },
          generation: { providerId: "p1", model: "gemini-test-image" },
        },
      },
      3
    )
    expect(migrated.selections?.consultation).toEqual({
      providerId: "gemini",
      model: "gemini-test-flash",
    })
    expect(migrated.selections?.generation).toEqual({
      providerId: "gemini",
      model: "gemini-test-image",
    })
  })

  it("drops non-Google selections instead of rerouting them", () => {
    const migrated = migratePersistedProviders(
      {
        providers: [{ id: "p2", kind: "openai-compatible", apiKey: "sk-legacy" }],
        selections: {
          consultation: { providerId: "p2", model: "gpt-4o" },
          generation: null,
        },
      },
      3
    )
    expect(migrated.selections?.consultation).toBeNull()
    expect(migrated.selections?.generation).toBeNull()
    expect(migrated.legacyCredentialsRemoved).toBe(true)
  })

  it("passes current-version state through untouched", () => {
    const current = {
      modelsCache: {},
      selections: {
        consultation: { providerId: "gemini", model: "gemini-test-flash" },
        generation: null,
      },
      legacyCredentialsRemoved: false,
    }
    expect(migratePersistedProviders(current, 4)).toBe(current)
  })

  it("reports no legacy credentials when none existed", () => {
    const migrated = migratePersistedProviders({}, 3)
    expect(migrated.legacyCredentialsRemoved).toBe(false)
  })
})
