import type { GoogleProviderConfig } from "@/lib/server/provider-env"
import { readGoogleProviderConfigs } from "@/lib/server/provider-env"

/**
 * Typed first-party provider registry. Aestry ships two native Google
 * connection modes; future first-party providers register here the same
 * way. Browser-configured custom endpoints are an explicit future
 * capability and are never falsely presented as available.
 */

export const BUILTIN_PROVIDER_IDS = ["gemini", "vertex"] as const

export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number]

export function isBuiltinProviderId(value: string): value is BuiltinProviderId {
  return (BUILTIN_PROVIDER_IDS as readonly string[]).includes(value)
}

export type ProviderSummary = {
  id: BuiltinProviderId
  label: string
  /** How the provider authenticates when configured. */
  connectionMode: "api-key" | "application-default-credentials"
  configured: boolean
  /**
   * Non-secret configuration detail, e.g. which env variables were found.
   * Never contains values.
   */
  configDetail: string[]
  /** Setup guidance when not configured. */
  setupHint: string
  /** Server-pinned default models, when the operator set them. */
  chatModelOverride?: string
  imageModelOverride?: string
}

const GEMINI_SETUP_HINT =
  "Set GOOGLE_API_KEY in the server environment (a Google AI Studio API key), then restart the server."
const VERTEX_SETUP_HINT =
  "Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION in the server environment and provide Application Default Credentials or workload identity, then restart the server."

function summarizeConfigs(): ProviderSummary[] {
  const reading = readGoogleProviderConfigs()
  const summaries: ProviderSummary[] = []
  if (reading.gemini) {
    summaries.push({
      id: "gemini",
      label: "Google Gemini Developer API",
      connectionMode: "api-key",
      configured: true,
      configDetail: ["GOOGLE_API_KEY is set"],
      setupHint: GEMINI_SETUP_HINT,
      chatModelOverride: reading.gemini.chatModelOverride,
      imageModelOverride: reading.gemini.imageModelOverride,
    })
  } else {
    summaries.push({
      id: "gemini",
      label: "Google Gemini Developer API",
      connectionMode: "api-key",
      configured: false,
      configDetail: [],
      setupHint: GEMINI_SETUP_HINT,
    })
  }
  if (reading.vertex) {
    summaries.push({
      id: "vertex",
      label: "Google Vertex AI",
      connectionMode: "application-default-credentials",
      configured: true,
      configDetail: [
        "GOOGLE_CLOUD_PROJECT is set",
        "GOOGLE_CLOUD_LOCATION is set",
      ],
      setupHint: VERTEX_SETUP_HINT,
      chatModelOverride: reading.vertex.chatModelOverride,
      imageModelOverride: reading.vertex.imageModelOverride,
    })
  } else {
    summaries.push({
      id: "vertex",
      label: "Google Vertex AI",
      connectionMode: "application-default-credentials",
      configured: false,
      configDetail: [],
      setupHint: VERTEX_SETUP_HINT,
    })
  }
  return summaries
}

/**
 * Sanitized provider statuses for the browser. Environment values never
 * cross this boundary — only presence/configuration states.
 */
export function listProviderSummaries(): ProviderSummary[] {
  return summarizeConfigs()
}

export function getProviderSummariesWithErrors(): {
  summaries: ProviderSummary[]
  configErrors: string[]
} {
  const reading = readGoogleProviderConfigs()
  return { summaries: summarizeConfigs(), configErrors: reading.errors }
}

/** Resolves the server-side config for a built-in provider, or null. */
export function getBuiltinProviderConfig(
  providerId: BuiltinProviderId
): GoogleProviderConfig | null {
  const reading = readGoogleProviderConfigs()
  if (providerId === "gemini") return reading.gemini ?? null
  return reading.vertex ?? null
}
