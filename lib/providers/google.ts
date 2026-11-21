import { classifyProviderModel } from "./models"
import { createUpstreamSseParser } from "@/lib/server/sse"
import { logProvider } from "@/lib/server/logs"
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
 * Every upstream operation emits raw events to the Terminal log (redacted).
 */

function googleModelsEndpoint(): string {
  return GOOGLE_LIST_URL
}

export async function listGoogleModels(
  apiKey: string
): Promise<DiscoveredModel[]> {
  logProvider({
    scope: "google.models",
    message: "GET v1beta/models · listing models for key",
    secret: apiKey,
  })
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
      logProvider({
        scope: "google.models",
        level: "error",
        message: `listing failed · status ${result.response.status}`,
      })
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
        contextWindow:
          typeof item.inputTokenLimit === "number"
            ? item.inputTokenLimit
            : undefined,
      })
    }
    pageToken =
      isRecord(data) && typeof data.nextPageToken === "string"
        ? data.nextPageToken
        : undefined
  } while (pageToken)

  if (models.length === 0) {
    logProvider({
      scope: "google.models",
      level: "error",
      message: "no usable models for this key",
    })
    throw new ProviderRequestError(502, "Google returned no usable models for this key.")
  }
  logProvider({
    scope: "google.models",
    message: `listed ${models.length.toString()} models`,
  })
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
): Promise<{
  text: string
  structured: boolean
  warning?: undefined
  usage?: { promptTokens?: number }
}> {
  logProvider({
    scope: "google.chat",
    message: `POST :generateContent · model ${payload.model}`,
    detail: JSON.stringify({
      turns: payload.turns,
      systemPromptChars: payload.systemPrompt.length,
      referenceImages: payload.referenceImages?.length ?? 0,
    }),
    secret: payload.apiKey,
  })
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
    usageMetadata?: unknown
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
    logProvider({
      scope: "google.chat",
      level: "error",
      message: `consultation failed · status ${result.response.status}`,
      secret: payload.apiKey,
    })
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
    if (isRecord(part) && part.thought === true) continue
    if (isRecord(part) && typeof part.text === "string" && part.text.trim()) {
      text = part.text.trim()
      break
    }
  }
  if (!text) {
    logProvider({
      scope: "google.chat",
      level: "error",
      message: "no text in response",
      detail: JSON.stringify(data).slice(0, 1_200),
      secret: payload.apiKey,
    })
    throw new ProviderRequestError(502, "The model returned an empty response.")
  }
  const usageMetadata = isRecord(data) ? data.usageMetadata : undefined
  const promptTokens =
    isRecord(usageMetadata) && typeof usageMetadata.promptTokenCount === "number"
      ? usageMetadata.promptTokenCount
      : undefined
  logProvider({
    scope: "google.chat",
    message: `consultation ok · ${text.length.toString()} chars · ${promptTokens?.toString() ?? "?"} prompt tokens`,
    detail: JSON.stringify(data).slice(0, 1_200),
    secret: payload.apiKey,
  })
  return { text, structured: true, usage: { promptTokens } }
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
  logProvider({
    scope: "google.images",
    message: `POST :generateContent ×${payload.count.toString()} · model ${payload.model}`,
    detail: JSON.stringify({
      promptChars: payload.prompt.length,
      referenceImages: payload.referenceImages?.length ?? 0,
    }),
    secret: payload.apiKey,
  })
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
  const results = await Promise.all(
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
        logProvider({
          scope: "google.images",
          level: "error",
          message: `image failed · ${error.message}`,
          secret: payload.apiKey,
        })
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
        if (!isRecord(part) || part.thought === true) continue
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
      logProvider({
        scope: "google.images",
        level: "error",
        message: text
          ? `no image in response · text: ${text.slice(0, 200)}`
          : "no image in response",
        secret: payload.apiKey,
      })
      return {
        ok: false,
        error: text ?? "The model did not return an image.",
      }
    })
  )
  logProvider({
    scope: "google.images",
    level: results.every((result) => result.ok) ? "info" : "warn",
    message: `generation finished · ${results.filter((result) => result.ok).length.toString()}/${payload.count.toString()} ok`,
  })
  return results
}

export async function streamGoogleConsult(
  payload: {
    apiKey: string
    model: string
    systemPrompt: string
    turns: Array<{ role: "user" | "assistant"; text: string }>
    referenceImages?: Array<{ mimeType: string; data: string }>
  },
  onDelta?: (text: string) => void
): Promise<{
  text: string
  structured: true
  warning?: undefined
  usage?: { promptTokens?: number }
}> {
  logProvider({
    scope: "google.chat.stream",
    message: `POST :streamGenerateContent?alt=sse · model ${payload.model}`,
    detail: JSON.stringify({
      turns: payload.turns,
      systemPromptChars: payload.systemPrompt.length,
      referenceImages: payload.referenceImages?.length ?? 0,
    }),
    secret: payload.apiKey,
  })
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

  const response = await fetch(
    `${GOOGLE_BASE_URL}/models/${encodeURIComponent(payload.model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": payload.apiKey,
      },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: payload.systemPrompt }] },
        // No responseMimeType here: some current models reject JSON mode in
        // streaming, and the reply parser handles fenced/plain JSON anyway.
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  )
  logProvider({
    scope: "google.chat.stream",
    level: response.ok ? "info" : "error",
    message: `upstream responded ${response.status}`,
    detail: `content-type: ${response.headers.get("content-type") ?? "none"}`,
  })
  if (!response.ok) {
    throw await providerErrorFromResponse(response, "Google consultation failed")
  }
  if (!response.body) {
    throw new ProviderRequestError(502, "The consultation stream was empty.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let capturedPromptTokens: number | undefined
  let streamError: string | undefined
  let finishReason: string | undefined
  let lastRawChunk: string | undefined
  const rawSseLines: string[] = []
  let rawSseTruncated = false
  const textParts: string[] = []
  const parser = createUpstreamSseParser((data) => {
    if (rawSseLines.length < 16) {
      rawSseLines.push(data.length > 300 ? `${data.slice(0, 300)}…` : data)
    } else if (!rawSseTruncated) {
      rawSseTruncated = true
      rawSseLines.push("… more events omitted …")
    }
    try {
      lastRawChunk = data.length > 240 ? `${data.slice(0, 240)}…` : data
      const chunk: unknown = JSON.parse(data)
      const candidatesBlock = isRecord(chunk) ? chunk.candidates : undefined
      const firstCandidate =
        Array.isArray(candidatesBlock) && isRecord(candidatesBlock[0])
          ? candidatesBlock[0]
          : null
      if (
        firstCandidate &&
        typeof firstCandidate.finishReason === "string"
      ) {
        finishReason = firstCandidate.finishReason
      }
      // Upstream errors can arrive inside a 200 SSE stream — surface them
      // instead of reporting a generic "empty response".
      if (isRecord(chunk) && isRecord(chunk.error)) {
        streamError =
          typeof chunk.error.message === "string"
            ? chunk.error.message
            : "Google rejected the streaming request."
        return
      }
      const candidate =
        isRecord(chunk) &&
        Array.isArray(chunk.candidates) &&
        isRecord(chunk.candidates[0])
          ? chunk.candidates[0]
          : null
      const parts =
        candidate &&
        isRecord(candidate.content) &&
        Array.isArray(candidate.content.parts)
          ? candidate.content.parts
          : []
      for (const part of parts) {
        // Thinking models stream internal reasoning as thought parts; those
        // are not part of the answer.
        if (isRecord(part) && part.thought === true) continue
        if (isRecord(part) && typeof part.text === "string" && part.text) {
          textParts.push(part.text)
          onDelta?.(part.text)
        }
      }
      if (isRecord(chunk) && isRecord(chunk.usageMetadata)) {
        const promptTokenCount = chunk.usageMetadata.promptTokenCount
        if (typeof promptTokenCount === "number") {
          capturedPromptTokens = promptTokenCount
        }
      }
    } catch {
      // Skip malformed SSE payloads; deltas are additive only.
    }
  })
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.push(decoder.decode(value, { stream: true }))
  }
  parser.flush()
  const rawExcerpt = `${rawSseLines.join("\n")}${rawSseTruncated ? "\n… more events omitted …" : ""}`
  logProvider({
    scope: "google.chat.stream",
    level: streamError || !textParts.length ? "error" : "info",
    message: `stream finished · ${textParts.length.toString()} text parts${finishReason ? ` · finishReason ${finishReason}` : ""} · ${capturedPromptTokens?.toString() ?? "?"} prompt tokens`,
    detail: [rawExcerpt, lastRawChunk ? `last: ${lastRawChunk}` : ""]
      .filter(Boolean)
      .join("\n\nlast:\n"),
    secret: payload.apiKey,
  })
  if (streamError) {
    throw new ProviderRequestError(502, streamError)
  }
  const text = textParts.join("")
  if (!text.trim()) {
    throw new ProviderRequestError(
      502,
      `The model returned no text${finishReason ? ` (finishReason: ${finishReason})` : ""}. Raw SSE:\n${rawExcerpt.slice(0, 600)}`
    )
  }
  return { text, structured: true, usage: { promptTokens: capturedPromptTokens } }
}
