import { fetchImageBounded } from "@/lib/server/outbound"
import { createUpstreamSseParser } from "@/lib/server/sse"
import { logProvider } from "@/lib/server/logs"

import { inferCapabilities } from "./models"
import {
  type DiscoveredModel,
  ProviderRequestError,
  isRecord,
  providerErrorFromResponse,
  safeFetchJson,
} from "./types"

const REQUEST_TIMEOUT_MS = 120_000

/**
 * OpenAI-compatible provider adapters. The base URL is user-configured, so
 * every request goes through the server-side outbound policy (protocol,
 * private-address, and redirect validation). Endpoint compatibility varies:
 * model discovery and chat are treated as best-effort with explicit errors.
 */

function apiRoot(baseUrl: string | undefined): URL {
  if (!baseUrl) {
    throw new ProviderRequestError(400, "This provider has no base URL configured.")
  }
  let root: URL
  try {
    root = new URL(baseUrl)
  } catch {
    throw new ProviderRequestError(400, "The provider base URL is invalid.")
  }
  if (root.protocol !== "http:" && root.protocol !== "https:") {
    throw new ProviderRequestError(400, "Only http and https endpoints are supported.")
  }
  return root
}

function endpointUrl(root: URL, path: string, search = ""): string {
  return `${root.origin}${root.pathname.replace(/\/+$/, "")}${path}${search}`
}

export async function listOpenAiCompatibleModels(
  apiKey: string,
  baseUrl: string | undefined
): Promise<DiscoveredModel[]> {
  const root = apiRoot(baseUrl)
  const result = await safeFetchJson<{ data?: unknown }>(
    endpointUrl(root, "/models"),
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 30_000,
    }
  )
  if (!result.ok) {
    throw await providerErrorFromResponse(result.response, "Model discovery failed")
  }
  const data = result.data
  const rawModels = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.data)
      ? data.data
      : []
  const models: DiscoveredModel[] = []
  for (const item of rawModels) {
    if (typeof item === "string") {
      const capability = inferOpenAiCapability(item)
      if (capability) models.push({ id: item, capability })
    } else if (isRecord(item) && typeof item.id === "string") {
      const capability = inferOpenAiCapability(item.id)
      if (!capability) continue
      models.push({
        id: item.id,
        capability,
        label:
          typeof item.displayName === "string" ? item.displayName : undefined,
      })
    }
  }
  if (models.length === 0) {
    throw new ProviderRequestError(502, "The endpoint returned no usable models.")
  }
  return models
}

// Local import keeps classification next to its consumer; models.ts stays
// free of adapter concerns.
import { classifyProviderModel } from "./models"

function inferOpenAiCapability(id: string): DiscoveredModel["capability"] | null {
  return classifyProviderModel("openai-compatible", id)
}

export async function consultOpenAiCompatible(payload: {
  apiKey: string
  model: string
  baseUrl?: string
  systemPrompt: string
  turns: Array<{ role: "user" | "assistant"; text: string }>
  referenceImages?: Array<{ mimeType: string; data: string }>
}): Promise<{
  text: string
  structured: boolean
  warning?: string
  usage?: { promptTokens?: number }
}> {
  const root = apiRoot(payload.baseUrl)
  const capabilities = inferCapabilities("openai-compatible", payload.model)
  let warning: string | undefined

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: payload.systemPrompt },
  ]
  for (const turn of payload.turns) {
    if (
      turn.role === "user" &&
      payload.referenceImages &&
      payload.referenceImages.length > 0 &&
      turn === payload.turns[payload.turns.length - 1]
    ) {
      // Vision support is inferred, not verified: only send images when the
      // heuristic says the model accepts them.
      if (capabilities.vision) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: turn.text },
            ...payload.referenceImages.map((image) => ({
              type: "image_url",
              image_url: { url: `data:${image.mimeType};base64,${image.data}` },
            })),
          ],
        })
      } else {
        messages.push({ role: "user", content: turn.text })
        if (payload.referenceImages.length > 0) {
          warning =
            "This multimodal model may not support image input — reference images were not sent."
        }
      }
    } else {
      messages.push({ role: turn.role, content: turn.text })
    }
  }

  const body: Record<string, unknown> = {
    model: payload.model,
    messages,
  }
  if (capabilities.structuredJson) {
    body.response_format = { type: "json_object" }
  }

  const result = await safeFetchJson<{
    choices?: unknown
    usage?: unknown
  }>(
    endpointUrl(root, "/chat/completions"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${payload.apiKey}`,
      },
      body: JSON.stringify(body),
      timeoutMs: REQUEST_TIMEOUT_MS,
    }
  )
  if (!result.ok) {
    throw await providerErrorFromResponse(result.response, "Consultation failed")
  }
  const data = result.data
  const choice =
    isRecord(data) && Array.isArray(data.choices) && isRecord(data.choices[0])
      ? data.choices[0]
      : null
  const message = choice && isRecord(choice.message) ? choice.message : null
  const text =
    message && typeof message.content === "string" ? message.content : undefined
  if (!text || !text.trim()) {
    throw new ProviderRequestError(502, "The model returned an empty response.")
  }
  const usage = isRecord(data) && isRecord(data.usage) ? data.usage : null
  const promptTokens =
    usage && typeof usage.prompt_tokens === "number"
      ? usage.prompt_tokens
      : undefined
  return {
    text: text.trim(),
    structured: capabilities.structuredJson,
    warning,
    usage: { promptTokens },
  }
}

export async function generateImagesOpenAiCompatible(payload: {
  apiKey: string
  model: string
  baseUrl?: string
  prompt: string
  count: number
  size?: string
}): Promise<
  Array<{ ok: true; mimeType: string; data: string } | { ok: false; error: string }>
> {
  const root = apiRoot(payload.baseUrl)
  const response = await fetch(endpointUrl(root, "/images/generations"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${payload.apiKey}`,
    },
    body: JSON.stringify({
      model: payload.model,
      prompt: payload.prompt,
      n: payload.count,
      response_format: "b64_json",
      ...(payload.size ? { size: payload.size } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw await providerErrorFromResponse(response, "Image generation failed")
  }

  const data: unknown = await response.json().catch(() => null)
  const rawImages = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.data)
      ? data.data
      : []
  const results: Array<
    { ok: true; mimeType: string; data: string } | { ok: false; error: string }
  > = []
  for (const item of rawImages.slice(0, payload.count)) {
    if (!isRecord(item)) continue
    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      results.push({
        ok: true,
        mimeType: "image/png",
        data: item.b64_json,
      })
      continue
    }
    if (typeof item.url === "string" && item.url.length > 0) {
      // Temporary URLs are downloaded through the bounded, policy-checked
      // fetcher: content type and size are enforced server-side.
      try {
        const image = await fetchImageBounded(item.url)
        results.push({ ok: true, mimeType: image.mimeType, data: image.base64 })
      } catch {
        results.push({
          ok: false,
          error: "Could not download a generated image.",
        })
      }
    }
  }
  if (results.length === 0) {
    return [{ ok: false, error: "The endpoint returned no images." }]
  }
  return results
}

export async function streamOpenAiCompatibleConsult(
  payload: {
    apiKey: string
    model: string
    baseUrl?: string
    systemPrompt: string
    turns: Array<{ role: "user" | "assistant"; text: string }>
    referenceImages?: Array<{ mimeType: string; data: string }>
  },
  onDelta?: (text: string) => void
): Promise<{
  text: string
  structured: boolean
  warning?: string
  usage?: { promptTokens?: number }
}> {
  const root = apiRoot(payload.baseUrl)
  const capabilities = inferCapabilities("openai-compatible", payload.model)

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: payload.systemPrompt },
  ]
  for (const turn of payload.turns) {
    if (
      turn.role === "user" &&
      payload.referenceImages &&
      payload.referenceImages.length > 0 &&
      turn === payload.turns[payload.turns.length - 1] &&
      capabilities.vision
    ) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: turn.text },
          ...payload.referenceImages.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mimeType};base64,${image.data}` },
          })),
        ],
      })
    } else {
      messages.push({ role: turn.role, content: turn.text })
    }
  }

  const body: Record<string, unknown> = {
    model: payload.model,
    messages,
    stream: true,
  }
  if (capabilities.structuredJson) {
    body.response_format = { type: "json_object" }
  }

  logProvider({
    scope: "openai.chat.stream",
    message: `POST /chat/completions (stream) · model ${payload.model}`,
    detail: JSON.stringify({
      model: payload.model,
      turns: payload.turns,
      systemPromptChars: payload.systemPrompt.length,
      vision: capabilities.vision,
    }),
    secret: payload.apiKey,
  })

  const response = await fetch(endpointUrl(root, "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${payload.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  logProvider({
    scope: "openai.chat.stream",
    level: response.ok ? "info" : "error",
    message: `upstream responded ${response.status}`,
  })
  if (!response.ok) {
    throw await providerErrorFromResponse(response, "Consultation failed")
  }
  if (!response.body) {
    throw new ProviderRequestError(502, "The consultation stream was empty.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let streamError: string | undefined
  const rawSseLines: string[] = []
  let rawSseTruncated = false
  const parser = createUpstreamSseParser((data) => {
    if (rawSseLines.length < 16) {
      rawSseLines.push(data.length > 300 ? `${data.slice(0, 300)}…` : data)
    } else if (!rawSseTruncated) {
      rawSseTruncated = true
      rawSseLines.push("… more events omitted …")
    }
    if (data === "[DONE]") return
    try {
      const chunk: unknown = JSON.parse(data)
      if (isRecord(chunk) && isRecord(chunk.error)) {
        streamError =
          typeof chunk.error.message === "string"
            ? chunk.error.message
            : "The endpoint rejected the streaming request."
        return
      }
      const choice =
        isRecord(chunk) &&
        Array.isArray(chunk.choices) &&
        isRecord(chunk.choices[0])
          ? chunk.choices[0]
          : null
      const delta = choice && isRecord(choice.delta) ? choice.delta : null
      const deltaText =
        delta && typeof delta.content === "string" ? delta.content : undefined
      if (deltaText) {
        text += deltaText
        onDelta?.(deltaText)
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
  const rawExcerpt = `${rawSseLines.join("\n")}${rawSseTruncated ? "\n… more events omitted …" : ""}`
  logProvider({
    scope: "openai.chat.stream",
    level: streamError || !text.trim() ? "error" : "info",
    message: `stream finished · ${text.length.toString()} chars`,
    detail: rawExcerpt,
    secret: payload.apiKey,
  })
  if (streamError) {
    throw new ProviderRequestError(502, streamError)
  }
  if (!text.trim()) {
    throw new ProviderRequestError(502, "The model returned an empty response.")
  }
  return { text, structured: capabilities.structuredJson }
}
