import type { ModelCapability, ProviderModel } from "./models"
import { readBytesBounded } from "@/lib/server/outbound"

export type ProviderKind = "google" | "openai-compatible"

export type DiscoveredModel = {
  id: string
  label?: string
  capability: ModelCapability
  /** Reported context window in tokens, when the provider exposes it. */
  contextWindow?: number
}

export type ImageGenerationItem =
  | { ok: true; mimeType: string; data: string }
  | { ok: false; error: string }

export type ImageGenerationResult = {
  items: ImageGenerationItem[]
  warning?: string
}

/**
 * Stable application error categories for provider failures. The client
 * receives the code plus a sanitized description; raw upstream detail
 * stays in server-side diagnostics.
 */
export type ProviderErrorCode =
  | "AUTH_FAILED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "MODEL_NOT_FOUND"
  | "SAFETY_BLOCKED"
  | "TIMEOUT"
  | "BAD_REQUEST"
  | "UPSTREAM"
  | "NETWORK"

export class ProviderRequestError extends Error {
  readonly status: number
  readonly code: ProviderErrorCode
  /** True when the same request may succeed after a backoff. */
  readonly retryable: boolean

  constructor(
    status: number,
    message: string,
    options?: { code?: ProviderErrorCode; retryable?: boolean }
  ) {
    super(message)
    this.status = status
    this.code = options?.code ?? defaultErrorCode(status)
    this.retryable = options?.retryable ?? (status === 429 || status === 503)
  }
}

function defaultErrorCode(status: number): ProviderErrorCode {
  if (status === 401) return "AUTH_FAILED"
  if (status === 403) return "PERMISSION_DENIED"
  if (status === 404) return "MODEL_NOT_FOUND"
  if (status === 429) return "RATE_LIMITED"
  if (status === 422) return "SAFETY_BLOCKED"
  if (status === 504) return "TIMEOUT"
  if (status === 400) return "BAD_REQUEST"
  return "UPSTREAM"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Maps an upstream non-2xx response to a ProviderRequestError with a
 * user-safe message. The error body is read with a size bound; credential
 * values are never included and upstream detail is bounded.
 */
export async function providerErrorFromResponse(
  response: Response,
  fallback: string
): Promise<ProviderRequestError> {
  let detail: string | undefined
  try {
    const bytes = await readBytesBounded(response, 256 * 1024)
    if (bytes !== null) {
      const body: unknown = JSON.parse(bytes.toString("utf8"))
      if (isRecord(body) && isRecord(body.error)) {
        if (typeof body.error.message === "string") detail = body.error.message
      } else if (isRecord(body) && typeof body.message === "string") {
        detail = body.message
      }
    }
  } catch {
    // Non-JSON error body.
  }
  if (detail && detail.length > 500) {
    detail = `${detail.slice(0, 500)}…`
  }
  if (response.status === 401 || response.status === 403) {
    return new ProviderRequestError(401, detail ?? "The API key was rejected by the provider.")
  }
  if (response.status === 429) {
    return new ProviderRequestError(429, detail ?? "Rate limited by the provider — try fewer images.")
  }
  if (response.status === 404) {
    return new ProviderRequestError(404, detail ?? "The provider does not expose this operation.")
  }
  return new ProviderRequestError(
    502,
    detail ?? `${fallback} (status ${response.status})`
  )
}

export { isRecord }
export { safeFetchJson } from "@/lib/server/outbound"
export type { ProviderModel }

