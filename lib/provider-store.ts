import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { z } from "zod"

export type ProviderKind = "google" | "openai-compatible"

export type ProviderConfig = {
  id: string
  kind: ProviderKind
  label: string
  /** Endpoint root for OpenAI-compatible providers, e.g. https://host/v1. */
  baseUrl?: string
  apiKey: string
  /** Model selected from the provider's own model list. */
  model?: string
  /** Model ids the key can access, as reported by the provider. */
  models?: string[]
  createdAt: string
}

export const GOOGLE_PROVIDER_LABEL = "Google Gemini"

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
      version: 1,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
