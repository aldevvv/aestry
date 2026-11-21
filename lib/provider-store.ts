import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { z } from "zod"

import {
  GOOGLE_PROVIDER_LABEL,
  type ModelCapability,
  type ProviderModel,
} from "@/lib/providers/models"

// Domain types live in lib/providers/models so server adapters can share
// them without importing client state. Re-exported here for UI consumers.
export {
  GOOGLE_PROVIDER_LABEL,
  type ModelCapability,
  type ProviderModel,
} from "@/lib/providers/models"

/**
 * Built-in first-party providers. The browser only ever sees these static
 * descriptors plus sanitized statuses fetched from the server — provider
 * credentials resolve exclusively server-side.
 */
export type BuiltinProviderId = "gemini" | "vertex"

export const BUILTIN_PROVIDERS: Array<{
  id: BuiltinProviderId
  label: string
}> = [
  { id: "gemini", label: GOOGLE_PROVIDER_LABEL },
  { id: "vertex", label: "Google Vertex AI" },
]

export function providerLabel(providerId: BuiltinProviderId): string {
  return (
    BUILTIN_PROVIDERS.find((provider) => provider.id === providerId)?.label ??
    providerId
  )
}

/** Sanitized provider status as served by GET /api/providers. */
export type ProviderStatus = {
  id: BuiltinProviderId
  label: string
  connectionMode: "api-key" | "application-default-credentials"
  configured: boolean
  configDetail: string[]
  setupHint: string
  chatModelOverride?: string
  imageModelOverride?: string
}

export type RoleSelection = {
  providerId: BuiltinProviderId
  model: string
}

export type ProviderRole = "consultation" | "generation"

export function isBuiltinProviderId(value: string): value is BuiltinProviderId {
  return value === "gemini" || value === "vertex"
}

/** Kept for the model-id inputs' client-side validation shape. */
export const modelFormSchema = z.object({
  model: z.string().trim().min(1).max(120),
})

type ProvidersState = {
  /** Discovered models per provider, cached from the server (non-secret). */
  modelsCache: Partial<Record<BuiltinProviderId, ProviderModel[]>>
  /**
   * Explicit role selections. Deliberately null by default: nothing is
   * activated implicitly, because doing so could silently spend credits on
   * a provider the user did not choose for that role.
   */
  selections: {
    consultation: RoleSelection | null
    generation: RoleSelection | null
  }
  /** Set when the v4 migration stripped browser-stored API keys. */
  legacyCredentialsRemoved: boolean

  // Session state (not persisted).
  statuses: ProviderStatus[] | null
  statusError: string | null
  configErrors: string[]
  loadingModels: Partial<Record<BuiltinProviderId, boolean>>
  modelErrors: Partial<Record<BuiltinProviderId, string>>
  verifying: Partial<Record<BuiltinProviderId, boolean>>
  verification: Partial<
    Record<BuiltinProviderId, { verified: boolean; at: number; error?: string }>
  >

  refreshStatus: () => Promise<void>
  loadModels: (providerId: BuiltinProviderId) => Promise<void>
  verifyProvider: (providerId: BuiltinProviderId) => Promise<void>
  setSelection: (role: "consultation" | "generation", selection: RoleSelection | null) => void
  acknowledgeLegacyNotice: () => void
}

let statusInFlight: Promise<void> | null = null

export const useProviders = create<ProvidersState>()(
  persist(
    (set, get) => ({
      modelsCache: {},
      selections: { consultation: null, generation: null },
      legacyCredentialsRemoved: false,

      statuses: null,
      statusError: null,
      configErrors: [],
      loadingModels: {},
      modelErrors: {},
      verifying: {},
      verification: {},

      refreshStatus: async () => {
        if (statusInFlight) return statusInFlight
        statusInFlight = (async () => {
          try {
            const response = await fetch("/api/providers", { cache: "no-store" })
            const data: unknown = await response.json().catch(() => null)
            if (
              data &&
              typeof data === "object" &&
              Array.isArray((data as { providers?: unknown }).providers)
            ) {
              const record = data as {
                providers: ProviderStatus[]
                configErrors?: unknown
              }
              set({
                statuses: record.providers,
                statusError: null,
                configErrors: Array.isArray(record.configErrors)
                  ? record.configErrors.filter(
                      (entry): entry is string => typeof entry === "string"
                    )
                  : [],
              })
              // Operator-pinned models (AESTRY_*_MODEL) are explicit server
              // configuration, not an implicit choice: preselect them for
              // roles the user has not decided on yet.
              const pinned = (provider: ProviderStatus, role: "chat" | "image") =>
                role === "chat"
                  ? provider.chatModelOverride
                  : provider.imageModelOverride
              const configuredChat = record.providers.find(
                (provider) => provider.configured && pinned(provider, "chat")
              )
              const configuredImage = record.providers.find(
                (provider) => provider.configured && pinned(provider, "image")
              )
              set((state) => ({
                selections: {
                  consultation:
                    state.selections.consultation ??
                    (configuredChat?.chatModelOverride
                      ? {
                          providerId: configuredChat.id,
                          model: configuredChat.chatModelOverride,
                        }
                      : null),
                  generation:
                    state.selections.generation ??
                    (configuredImage?.imageModelOverride
                      ? {
                          providerId: configuredImage.id,
                          model: configuredImage.imageModelOverride,
                        }
                      : null),
                },
              }))
            } else {
              set({
                statusError:
                  response.status === 401
                    ? "Operator sign-in required to read provider status."
                    : "Provider status could not be read from the server.",
              })
            }
          } catch {
            set({
              statusError: "Could not reach the Aestry server for provider status.",
            })
          } finally {
            statusInFlight = null
          }
        })()
        return statusInFlight
      },

      loadModels: async (providerId) => {
        if (get().loadingModels[providerId]) return
        set((state) => ({
          loadingModels: { ...state.loadingModels, [providerId]: true },
          modelErrors: { ...state.modelErrors, [providerId]: undefined },
        }))
        try {
          const response = await fetch("/api/providers/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerId }),
          })
          const data: unknown = await response.json().catch(() => null)
          if (!response.ok) {
            const error =
              data &&
              typeof data === "object" &&
              typeof (data as { error?: unknown }).error === "string"
                ? (data as { error: string }).error
                : "Could not load models."
            set((state) => ({
              modelErrors: { ...state.modelErrors, [providerId]: error },
            }))
            return
          }
          if (
            !data ||
            typeof data !== "object" ||
            !Array.isArray((data as { models?: unknown }).models)
          ) {
            set((state) => ({
              modelErrors: {
                ...state.modelErrors,
                [providerId]: "The provider response could not be read.",
              },
            }))
            return
          }
          const models: ProviderModel[] = []
          for (const item of (data as { models: unknown[] }).models) {
            if (
              item &&
              typeof item === "object" &&
              typeof (item as { id?: unknown }).id === "string" &&
              ((item as { capability?: unknown }).capability === "multimodal" ||
                (item as { capability?: unknown }).capability === "image")
            ) {
              const record = item as {
                id: string
                capability: ModelCapability
                label?: unknown
                contextWindow?: unknown
              }
              models.push({
                id: record.id,
                capability: record.capability,
                label:
                  typeof record.label === "string" ? record.label : undefined,
                contextWindow:
                  typeof record.contextWindow === "number"
                    ? record.contextWindow
                    : undefined,
              })
            }
          }
          set((state) => ({
            modelsCache: { ...state.modelsCache, [providerId]: models },
          }))
        } catch {
          set((state) => ({
            modelErrors: {
              ...state.modelErrors,
              [providerId]: "Could not reach the Aestry server.",
            },
          }))
        } finally {
          set((state) => ({
            loadingModels: { ...state.loadingModels, [providerId]: false },
          }))
        }
      },

      verifyProvider: async (providerId) => {
        if (get().verifying[providerId]) return
        set((state) => ({
          verifying: { ...state.verifying, [providerId]: true },
        }))
        try {
          const response = await fetch("/api/providers/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerId }),
          })
          const data: unknown = await response.json().catch(() => null)
          const verified =
            data &&
            typeof data === "object" &&
            (data as { verified?: unknown }).verified === true
          const error =
            data &&
            typeof data === "object" &&
            typeof (data as { error?: unknown }).error === "string"
              ? (data as { error: string }).error
              : undefined
          set((state) => ({
            verification: {
              ...state.verification,
              [providerId]: {
                verified: verified === true,
                at: Date.now(),
                error,
              },
            },
          }))
          // A verified connection implies a working discovery path — prime
          // the model cache while we are here.
          if (verified === true) {
            void get().loadModels(providerId)
          }
        } catch {
          set((state) => ({
            verification: {
              ...state.verification,
              [providerId]: {
                verified: false,
                at: Date.now(),
                error: "Could not reach the Aestry server.",
              },
            },
          }))
        } finally {
          set((state) => ({
            verifying: { ...state.verifying, [providerId]: false },
          }))
        }
      },

      setSelection: (role, selection) =>
        set((state) => ({
          selections: { ...state.selections, [role]: selection },
        })),

      acknowledgeLegacyNotice: () =>
        set({ legacyCredentialsRemoved: false }),
    }),
    {
      name: "aestry.providers.v1",
      version: 4,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        modelsCache: state.modelsCache,
        selections: state.selections,
        legacyCredentialsRemoved: state.legacyCredentialsRemoved,
      }),
      migrate: migratePersistedProviders,
    }
  )
)

type PersistedProviders = {
  modelsCache: Partial<Record<BuiltinProviderId, ProviderModel[]>>
  selections: {
    consultation: RoleSelection | null
    generation: RoleSelection | null
  }
  legacyCredentialsRemoved: boolean
}

/**
 * Persisted-state migration. v3 and earlier held browser-stored provider
 * credentials: they are no longer read for any operation, and dropping the
 * records here is the safe cleanup — nothing is transmitted anywhere
 * first. Model preferences from Google-provider selections carry over;
 * non-Google selections are dropped rather than rerouted to another
 * billable provider.
 */
export function migratePersistedProviders(
  persisted: unknown,
  version: number
): Partial<ProvidersState> {
  const base: PersistedProviders = {
    modelsCache: {},
    selections: { consultation: null, generation: null },
    legacyCredentialsRemoved: false,
  }
  if (version >= 4) return persisted as Partial<ProvidersState>
  const legacy = persisted as {
    providers?: Array<{
      id?: unknown
      kind?: string
      apiKey?: string
    }>
    selections?: {
      consultation?: { providerId: string; model: string } | null
      generation?: { providerId: string; model: string } | null
    }
  }
  const hadCredentials = (legacy.providers ?? []).some(
    (provider) => typeof provider.apiKey === "string" && provider.apiKey.length > 0
  )
  const legacySelection = (
    selection: { providerId: string; model: string } | null | undefined
  ): RoleSelection | null => {
    if (!selection) return null
    const provider = (legacy.providers ?? []).find(
      (candidate) =>
        typeof candidate?.id === "string" && candidate.id === selection.providerId
    )
    // Only Google selections map onto the built-in registry.
    if (!provider || provider.kind !== "google") return null
    return { providerId: "gemini", model: selection.model }
  }
  return {
    ...base,
    legacyCredentialsRemoved: hadCredentials,
    selections: {
      consultation: legacySelection(legacy.selections?.consultation),
      generation: legacySelection(legacy.selections?.generation),
    },
  }
}

/** Resolves the current selection for a role (validated shapes only). */
export function selectRoleSelection(
  state: ProvidersState,
  role: "consultation" | "generation"
): RoleSelection | null {
  return state.selections[role]
}

/**
 * The selected model's context window when discovery metadata is available.
 * Returns undefined rather than inventing a limit.
 */
export function selectedModelContextWindow(
  state: ProvidersState,
  role: "consultation" | "generation"
): number | undefined {
  const selection = state.selections[role]
  if (!selection) return undefined
  const models = state.modelsCache[selection.providerId] ?? []
  return models.find((model) => model.id === selection.model)?.contextWindow
}
