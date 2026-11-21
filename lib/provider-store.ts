import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { z } from "zod"

import {
  type ProviderKind,
  type ProviderModel,
} from "@/lib/providers/models"

// Domain types live in lib/providers/models so server adapters can share
// them without importing client state. Re-exported here for UI consumers.
export {
  GOOGLE_PROVIDER_LABEL,
  PROVIDER_KIND_LABELS,
  inferCapabilities,
  type ModelCapability,
  type ProviderKind,
  type ProviderModel,
} from "@/lib/providers/models"

export type ProviderConfig = {
  id: string
  kind: ProviderKind
  label: string
  /** Endpoint root for OpenAI-compatible providers, e.g. https://host/v1. */
  baseUrl?: string
  apiKey: string
  /** Multimodal model: brainstorming, chat, reading reference images. */
  multimodalModel?: string
  /** Image generation model: produces the assets. */
  imageModel?: string
  /** Models the key can access, as reported by the provider. */
  models?: ProviderModel[]
  createdAt: string
}

export type ProviderRole = "consultation" | "generation"

export type RoleSelection = {
  providerId: string
  model: string
}

export const googleFormSchema = z.object({
  apiKey: z.string().trim().min(1, "A Gemini API key is required"),
})

export const openAiCompatibleFormSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Give the provider a name")
    .max(60, "Keep the name under 60 characters"),
  baseUrl: z
    .string()
    .trim()
    .min(1, "A base URL is required")
    .url("Enter a full URL, e.g. https://api.example.com/v1")
    .refine(
      (value) => value.startsWith("http://") || value.startsWith("https://"),
      "Only http and https endpoints are supported"
    ),
  apiKey: z.string().trim().min(1, "An API key is required"),
})

export function collectFieldErrors(
  error: z.ZodError
): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === "string" && !(key in fieldErrors)) {
      fieldErrors[key] = issue.message
    }
  }
  return fieldErrors
}

export function maskApiKey(apiKey: string): string {
  const tail = apiKey.slice(-4)
  return `•••• ${tail}`
}

/**
 * Non-local HTTP endpoints transport the API key unencrypted; used for a
 * client-side caution without blocking self-hosted setups on trusted
 * networks. The server-side outbound policy makes the final call.
 */
export function isInsecureEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== "http:") return false
    const host = url.hostname.toLowerCase()
    return (
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      host !== "[::1]" &&
      host !== "::1"
    )
  } catch {
    return false
  }
}

type ProvidersState = {
  providers: ProviderConfig[]
  /**
   * Explicit role selections. Deliberately null by default: no provider is
   * activated implicitly, because doing so could silently spend credits on
   * an endpoint the user did not choose for that role.
   */
  selections: {
    consultation: RoleSelection | null
    generation: RoleSelection | null
  }
  addProvider: (provider: ProviderConfig) => void
  removeProvider: (id: string) => void
  setSelection: (role: ProviderRole, selection: RoleSelection | null) => void
}

/**
 * Provider credentials live in this browser only (localStorage via zustand
 * persist). They travel through the self-hosted Aestry server to the
 * configured provider on each proxied operation, and a removal deletes the
 * key outright.
 */
export const useProviders = create<ProvidersState>()(
  persist(
    (set) => ({
      providers: [],
      selections: { consultation: null, generation: null },
      addProvider: (provider) =>
        set((state) => ({ providers: [...state.providers, provider] })),
      removeProvider: (id) =>
        set((state) => {
          const selections = { ...state.selections }
          if (selections.consultation?.providerId === id) {
            selections.consultation = null
          }
          if (selections.generation?.providerId === id) {
            selections.generation = null
          }
          return {
            providers: state.providers.filter(
              (provider) => provider.id !== id
            ),
            selections,
          }
        }),
      setSelection: (role, selection) =>
        set((state) => ({
          selections: { ...state.selections, [role]: selection },
        })),
    }),
    {
      name: "aestry.providers.v1",
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        if (version >= 3) return persisted as ProvidersState
        const legacy = persisted as {
          providers?: Array<Record<string, unknown>>
        }
        return {
          providers: (legacy.providers ?? []).map((provider) => {
            const { model, ...rest } = provider
            return {
              ...rest,
              imageModel: typeof model === "string" ? model : undefined,
              // v1 model lists were plain ids; drop them so the record is
              // repopulated through discovery.
              models: undefined,
            } as ProviderConfig
          }),
          // v2 and earlier had no explicit role selections.
          selections: { consultation: null, generation: null },
        }
      },
    }
  )
)

/** Resolves a role selection against the current provider list. */
export function resolveSelection(
  providers: ProviderConfig[],
  selection: RoleSelection | null
): { provider: ProviderConfig; model: string } | null {
  if (!selection) return null
  const provider = providers.find((p) => p.id === selection.providerId)
  if (!provider) return null
  return { provider, model: selection.model }
}
