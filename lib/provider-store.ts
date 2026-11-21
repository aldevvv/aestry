import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { z } from "zod"

export type ProviderKind = "google" | "openai-compatible"

export type ModelCapability = "multimodal" | "image"

export type ProviderModel = {
  id: string
  /** Friendly name as reported by the provider, when available. */
  label?: string
  capability: ModelCapability
}

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

export const GOOGLE_PROVIDER_LABEL = "Google Gemini"

// Realtime voice, embeddings, and video models are not usable for either
// selector, so they are filtered out of discovery entirely.
const EXCLUDED_MODEL_PATTERN = /embed|whisper|moderation|tts|veo|live|aqa/i
const OPENAI_IMAGE_PATTERN =
  /image|imagen|dall-e|flux|stable-diffusion|sd[0-9]/i

/**
 * Buckets a discovered model into the two roles Aestry needs. Returns null
 * for models that fit neither role. Classification is a heuristic: for
 * Google it uses the model id plus its reported generation methods, for
 * OpenAI-compatible endpoints only the id.
 */
export function classifyProviderModel(
  kind: ProviderKind,
  id: string,
  methods?: readonly string[]
): ModelCapability | null {
  if (EXCLUDED_MODEL_PATTERN.test(id)) return null
  if (kind === "google") {
    if (/^imagen/i.test(id) || /image/i.test(id)) return "image"
    if (methods && !methods.includes("generateContent")) {
      if (
        methods.includes("predictLongRunning") ||
        methods.includes("predict")
      ) {
        return "image"
      }
      return null
    }
    return "multimodal"
  }
  if (OPENAI_IMAGE_PATTERN.test(id)) return "image"
  return "multimodal"
}

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  google: "Built-in · Google Gemini",
  "openai-compatible": "OpenAI-compatible",
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

/**
 * Non-local HTTP endpoints transport the API key unencrypted; used to show
 * a caution without blocking self-hosted setups on trusted networks.
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

export function maskApiKey(apiKey: string): string {
  const tail = apiKey.slice(-4)
  return `•••• ${tail}`
}

type ProvidersState = {
  providers: ProviderConfig[]
  addProvider: (provider: ProviderConfig) => void
  removeProvider: (id: string) => void
}

/**
 * Provider credentials live in this browser only (localStorage via zustand
 * persist). They are never synced or sent anywhere except to the endpoint
 * the user configured, and a removal deletes the key outright.
 */
export const useProviders = create<ProvidersState>()(
  persist(
    (set) => ({
      providers: [],
      addProvider: (provider) =>
        set((state) => ({ providers: [...state.providers, provider] })),
      removeProvider: (id) =>
        set((state) => ({
          providers: state.providers.filter(
            (provider) => provider.id !== id
          ),
        })),
    }),
    {
      name: "aestry.providers.v1",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        if (version >= 2) return persisted as ProvidersState
        // v1 stored a single `model` string and `models` as string ids.
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
        }
      },
    }
  )
)
