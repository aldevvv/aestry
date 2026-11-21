import { classifyProviderModel } from "./models"
import {
  type DiscoveredModel,
  ProviderRequestError,
  isRecord,
  providerErrorFromResponse,
  safeFetchJson,
} from "./types"

const GOOGLE_LIST_URL =
  "https://generativelanguage.googleapis.com/v1beta/models"
const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
const REQUEST_TIMEOUT_MS = 120_000

/**
 * Google provider adapters. Every call goes through the server-side outbound
 * policy; API keys are sent only in headers to Google's fixed endpoints.
 */

function googleModelsEndpoint(): string {
  return GOOGLE_LIST_URL
}

export async function listGoogleModels(
  apiKey: string
): Promise<DiscoveredModel[]> {
  const models: DiscoveredModel[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(googleModelsEndpoint())
    url.searchParams.set("pageSize", "200")
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken)
    }
    const result = await safeFetchJson<{
      models?: unknown
      nextPageToken?: unknown
    }>(url.toString(), {
      headers: { "x-goog-api-key": apiKey },
      timeoutMs: 30_000,
    })
    if (!result.ok) {
      throw await providerErrorFromResponse(
        result.response,
        "Google model discovery failed"
      )
    }
    const data = result.data
    const rawModels = isRecord(data) && Array.isArray(data.models) ? data.models : []
    for (const item of rawModels) {
      if (!isRecord(item) || typeof item.name !== "string") continue
      const id = item.name.replace(/^models\//, "")
      const methods = Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods.filter(
            (method): method is string => typeof method === "string"
          )
        : undefined
      const capability = classifyProviderModel("google", id, methods)
      if (!capability) continue
      models.push({
        id,
        capability,
        label:
          typeof item.displayName === "string" ? item.displayName : undefined,
      })
    }
    pageToken =
      isRecord(data) && typeof data.nextPageToken === "string"
        ? data.nextPageToken
        : undefined
  } while (pageToken)

  if (models.length === 0) {
    throw new ProviderRequestError(502, "Google returned no usable models for this key.")
  }
  return models
}

export async function consultGoogle(
  payload: {
    apiKey: string
    model: string
    systemPrompt: string
    turns: Array<{ role: "user" | "assistant"; text: string }>
    referenceImages?: Array<{ mimeType: string; data: string }>
  }
): Promise<{ text: string; structured: boolean; warning?: undefined }> {
  const contents: Array<{
    role: "user" | "model"
    parts: Array<Record<string, unknown>>
  }> = payload.turns.map((turn) => ({
    role: turn.role === "user" ? "user" : "model",
    parts: [{ text: turn.text }],
  }))
  if (contents.length === 0) {
    throw new ProviderRequestError(400, "The conversation is empty.")
  }
  // Reference images belong to the latest user turn.
  if (payload.referenceImages && payload.referenceImages.length > 0) {
    const lastUser = [...contents].reverse().find((c) => c.role === "user")
    if (lastUser) {
      for (const image of payload.referenceImages) {
        lastUser.parts.push({
          inlineData: { mimeType: image.mimeType, data: image.data },
        })
      }
    }
  }

  const result = await safeFetchJson<{
    candidates?: unknown
    error?: unknown
  }>(
    `${GOOGLE_BASE_URL}/models/${encodeURIComponent(payload.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": payload.apiKey,
      },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: payload.systemPrompt }] },
        generationConfig: { responseMimeType: "application/json" },
      }),
      timeoutMs: REQUEST_TIMEOUT_MS,
    }
  )
  if (!result.ok) {
    throw await providerErrorFromResponse(result.response, "Google consultation failed")
  }

  const data = result.data
  const candidate =
    isRecord(data) && Array.isArray(data.candidates) && isRecord(data.candidates[0])
      ? data.candidates[0]
      : null
  const parts =
    candidate && isRecord(candidate.content) && Array.isArray(candidate.content.parts)
      ? candidate.content.parts
      : []
  let text: string | undefined
  for (const part of parts) {
    if (isRecord(part) && typeof part.text === "string" && part.text.trim()) {
      text = part.text.trim()
      break
    }
  }
  if (!text) {
    throw new ProviderRequestError(502, "The model returned an empty response.")
  }
  return { text, structured: true }
}

export async function generateImagesGoogle(payload: {
  apiKey: string
  model: string
  prompt: string
  count: number
  referenceImages?: Array<{ mimeType: string; data: string }>
}): Promise<
  Array<{ ok: true; mimeType: string; data: string } | { ok: false; error: string }>
> {
  const parts: Array<Record<string, unknown>> = [{ text: payload.prompt }]
  for (const image of payload.referenceImages ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
  }
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  })

  const calls = Array.from({ length: payload.count }, () =>
    fetch(
      `${GOOGLE_BASE_URL}/models/${encodeURIComponent(payload.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": payload.apiKey,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )
  )
  const settled = await Promise.allSettled(calls)
  return Promise.all(
    settled.map(async (item): Promise<{ ok: true; mimeType: string; data: string } | { ok: false; error: string }> => {
      if (item.status === "rejected") {
        const reason: unknown = item.reason
        return {
          ok: false,
          error:
            reason instanceof DOMException && reason.name === "TimeoutError"
              ? "Google took too long to respond."
              : "The request to Google failed.",
        }
      }
      const response = item.value
      if (!response.ok) {
        const error = await providerErrorFromResponse(response, "Google generation failed")
        return { ok: false, error: error.message }
      }
      const data: unknown = await response.json().catch(() => null)
      const candidate =
        isRecord(data) &&
        Array.isArray(data.candidates) &&
        isRecord(data.candidates[0])
          ? data.candidates[0]
          : null
      const responseParts =
        candidate &&
        isRecord(candidate.content) &&
        Array.isArray(candidate.content.parts)
          ? candidate.content.parts
          : []
      let text: string | undefined
      for (const part of responseParts) {
        if (!isRecord(part)) continue
        const inline = isRecord(part.inlineData) ? part.inlineData : null
        if (
          inline &&
          typeof inline.mimeType === "string" &&
          typeof inline.data === "string"
        ) {
          return {
            ok: true,
            mimeType: inline.mimeType,
            data: inline.data,
          }
        }
        if (typeof part.text === "string" && part.text.trim()) {
          text = part.text.trim()
        }
      }
      return {
        ok: false,
        error: text ?? "The model did not return an image.",
      }
    })
  )
}
