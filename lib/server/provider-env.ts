import { z } from "zod"

/**
 * Server-only Google provider configuration. Credentials live exclusively
 * in the server environment; this module reads and validates them without
 * ever exposing values — callers receive structured configs, and errors
 * describe what is wrong without echoing the offending values.
 */

const nonEmpty = z.string().trim().min(1)

const geminiDevSchema = z.object({
  GOOGLE_API_KEY: nonEmpty,
  AESTRY_GEMINI_CHAT_MODEL: nonEmpty.optional(),
  AESTRY_GEMINI_IMAGE_MODEL: nonEmpty.optional(),
})

const vertexSchema = z.object({
  GOOGLE_CLOUD_PROJECT: nonEmpty.regex(
    /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/,
    "a Google Cloud project id looks like 'my-project-id'"
  ),
  GOOGLE_CLOUD_LOCATION: nonEmpty.regex(
    /^[a-z0-9-]+$/,
    "a location looks like 'us-central1' or 'global'"
  ),
  AESTRY_VERTEX_CHAT_MODEL: nonEmpty.optional(),
  AESTRY_VERTEX_IMAGE_MODEL: nonEmpty.optional(),
})

export type GeminiDevConfig = {
  providerId: "gemini"
  apiKey: string
  chatModelOverride?: string
  imageModelOverride?: string
}

export type VertexConfig = {
  providerId: "vertex"
  project: string
  location: string
  chatModelOverride?: string
  imageModelOverride?: string
}

export type GoogleProviderConfig = GeminiDevConfig | VertexConfig

export type ProviderEnvReading = {
  gemini?: GeminiDevConfig
  vertex?: VertexConfig
  /**
   * Human-readable configuration problems for values that were present but
   * invalid. Missing variables are NOT errors — unset providers are simply
   * not configured.
   */
  errors: string[]
}

function readGeminiDev(errors: string[]): GeminiDevConfig | undefined {
  const parsed = geminiDevSchema.safeParse({
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    AESTRY_GEMINI_CHAT_MODEL: process.env.AESTRY_GEMINI_CHAT_MODEL || undefined,
    AESTRY_GEMINI_IMAGE_MODEL:
      process.env.AESTRY_GEMINI_IMAGE_MODEL || undefined,
  })
  if (!parsed.success) {
    // A partially present config (e.g. an empty GOOGLE_API_KEY value) reads
    // as unconfigured rather than broken; only genuinely malformed values
    // are reported.
    const apiKey = process.env.GOOGLE_API_KEY?.trim()
    if (apiKey) {
      errors.push(
        "Google Gemini Developer API configuration is invalid — check GOOGLE_API_KEY and the AESTRY_GEMINI_* variables."
      )
    }
    return undefined
  }
  return {
    providerId: "gemini",
    apiKey: parsed.data.GOOGLE_API_KEY,
    chatModelOverride: parsed.data.AESTRY_GEMINI_CHAT_MODEL,
    imageModelOverride: parsed.data.AESTRY_GEMINI_IMAGE_MODEL,
  }
}

function readVertex(errors: string[]): VertexConfig | undefined {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim()
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim()
  if (!project && !location) return undefined
  const parsed = vertexSchema.safeParse({
    GOOGLE_CLOUD_PROJECT: project,
    GOOGLE_CLOUD_LOCATION: location,
    AESTRY_VERTEX_CHAT_MODEL: process.env.AESTRY_VERTEX_CHAT_MODEL || undefined,
    AESTRY_VERTEX_IMAGE_MODEL:
      process.env.AESTRY_VERTEX_IMAGE_MODEL || undefined,
  })
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) =>
        issue.path[0] === "GOOGLE_CLOUD_PROJECT"
          ? "GOOGLE_CLOUD_PROJECT"
          : "GOOGLE_CLOUD_LOCATION"
      )
      .filter((value, index, all) => all.indexOf(value) === index)
    errors.push(
      `Google Vertex AI configuration is incomplete or invalid — check ${issues.join(" and ")}.`
    )
    return undefined
  }
  return {
    providerId: "vertex",
    project: parsed.data.GOOGLE_CLOUD_PROJECT,
    location: parsed.data.GOOGLE_CLOUD_LOCATION,
    chatModelOverride: parsed.data.AESTRY_VERTEX_CHAT_MODEL,
    imageModelOverride: parsed.data.AESTRY_VERTEX_IMAGE_MODEL,
  }
}

/**
 * Reads the current Google provider configuration. Called per operation so
 * environment changes are picked up without a process restart in dev; the
 * read is cheap and never logs values.
 */
export function readGoogleProviderConfigs(): ProviderEnvReading {
  const errors: string[] = []
  return {
    gemini: readGeminiDev(errors),
    vertex: readVertex(errors),
    errors,
  }
}
