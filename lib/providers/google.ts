import { ApiError, GoogleGenAI } from "@google/genai"

import { extractPartialMessage } from "@/lib/conversation/partial-json"
import { logDiagnostic } from "@/lib/server/logs"
import { classifyProviderModel } from "./models"
import { getBuiltinProviderConfig, type BuiltinProviderId } from "./registry"
import {
  type DiscoveredModel,
  ProviderRequestError,
} from "./types"

/**
 * Native Google provider adapters on the official @google/genai SDK. Both
 * connection modes (Gemini Developer API and Vertex AI) resolve their
 * credentials from the server environment through the provider registry —
 * no API key ever arrives in a request body. Model discovery, consultation
 * (streaming and single-shot), token counting, and image generation all go
 * through SDK-native APIs; there is no parallel hand-written REST/SSE
 * implementation.
 */

const REQUEST_TIMEOUT_MS = 120_000
const MODEL_CACHE_TTL_MS = 60_000

type CacheEntry = { models: DiscoveredModel[]; at: number }
const modelCache = new Map<BuiltinProviderId, CacheEntry>()

/** Test isolation hook: clears discovery and client caches. */
export function __resetGoogleProviderCachesForTests(): void {
  modelCache.clear()
  clientCache.clear()
}

type ClientEntry = { fingerprint: string; client: GoogleGenAI }
const clientCache = new Map<BuiltinProviderId, ClientEntry>()

function clientFingerprint(providerId: BuiltinProviderId): string | null {
  const config = getBuiltinProviderConfig(providerId)
  if (!config) return null
  return config.providerId === "gemini"
    ? `gemini:${config.apiKey.length}:${config.apiKey.slice(-4)}`
    : `vertex:${config.project}:${config.location}`
}

function clientFor(providerId: BuiltinProviderId): {
  client: GoogleGenAI
  config: NonNullable<ReturnType<typeof getBuiltinProviderConfig>>
} {
  const config = getBuiltinProviderConfig(providerId)
  if (!config) {
    throw new ProviderRequestError(
      400,
      providerId === "gemini"
        ? "The Google Gemini Developer API is not configured on this server."
        : "Google Vertex AI is not configured on this server."
    )
  }
  const fingerprint = clientFingerprint(providerId) ?? ""
  const cached = clientCache.get(providerId)
  if (cached && cached.fingerprint === fingerprint) {
    return { client: cached.client, config }
  }
  const client =
    config.providerId === "gemini"
      ? new GoogleGenAI({ apiKey: config.apiKey })
      : new GoogleGenAI({
          vertexai: true,
          project: config.project,
          location: config.location,
        })
  clientCache.set(providerId, { fingerprint, client })
  return { client, config }
}

/**
 * Scrubs credential-shaped substrings from upstream error text before it
 * reaches the client. API keys (Google "AIza…", OAuth "ya29.…") and long
 * opaque mixed-case tokens are replaced; everything else is bounded.
 */
function sanitizeUpstreamDetail(message: string): string {
  const scrubbed = message
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted]")
    .replace(/ya29\.[0-9A-Za-z_-]{10,}/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, (match) =>
      /[A-Z]/.test(match) && /[0-9]/.test(match) && /[a-z]/.test(match)
        ? "[redacted]"
        : match
    )
    .replace(/\s+/g, " ")
    .trim()
  return scrubbed.length > 300 ? `${scrubbed.slice(0, 300)}…` : scrubbed
}

/**
 * Maps SDK errors to a bounded, categorized user-facing contract: stable
 * error code, safe description, and retryability. Upstream text is
 * sanitized (credential-shaped strings scrubbed, length bounded) because
 * SDK messages are useful but never fully trusted; structured events and
 * raw excerpts live in the Terminal diagnostics.
 */
function mapSdkError(error: unknown, fallback: string): ProviderRequestError {
  if (error instanceof ApiError) {
    const status =
      error.status >= 400 && error.status < 500 ? error.status : 502
    const upstreamDetail = sanitizeUpstreamDetail(
      typeof error.message === "string" ? error.message : ""
    )
    const category =
      status === 401 || status === 403
        ? { code: "AUTH_FAILED" as const, description: "Google rejected the server credentials." }
        : status === 429
          ? { code: "RATE_LIMITED" as const, description: "Rate limited by Google — try again shortly." }
          : status === 404
            ? { code: "MODEL_NOT_FOUND" as const, description: "Google does not expose this operation or model." }
            : null
    const description = category
      ? upstreamDetail
        ? `${category.description} Provider said: ${upstreamDetail}`
        : category.description
      : upstreamDetail || `${fallback} (status ${error.status.toString()})`
    return new ProviderRequestError(status, description, {
      code: category?.code,
      retryable: status === 429,
    })
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ProviderRequestError(504, "The provider took too long to respond.", {
      code: "TIMEOUT",
      retryable: true,
    })
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderRequestError(504, "The provider request was cancelled.", {
      code: "TIMEOUT",
      retryable: true,
    })
  }
  return new ProviderRequestError(502, fallback, { code: "NETWORK" })
}

function modelActions(model: unknown): string[] {
  if (typeof model !== "object" || model === null) return []
  const record = model as Record<string, unknown>
  const actions =
    record.supportedActions ?? record.supportedGenerationMethods
  return Array.isArray(actions)
    ? actions.filter((action): action is string => typeof action === "string")
    : []
}

/**
 * Lists models the configured provider can actually access, bucketed into
 * the two roles Aestry uses. Results are cached briefly so the UI and the
 * request validators do not hammer discovery.
 */
export async function listGoogleModels(
  providerId: BuiltinProviderId
): Promise<DiscoveredModel[]> {
  const cached = modelCache.get(providerId)
  if (cached && Date.now() - cached.at < MODEL_CACHE_TTL_MS) {
    return cached.models
  }
  const { client } = clientFor(providerId)
  const requestId = crypto.randomUUID()
  const startedAt = Date.now()
  logDiagnostic({
    provider: providerId,
    operation: "models.list",
    requestId,
    message: "listing models via SDK",
  })
  try {
    const pager = await client.models.list({ config: { pageSize: 200 } })
    const models: DiscoveredModel[] = []
    for await (const model of pager) {
      if (typeof model.name !== "string") continue
      const id = model.name.replace(/^models\//, "")
      const capability = classifyProviderModel(
        "google",
        id,
        modelActions(model)
      )
      if (!capability) continue
      models.push({
        id,
        capability,
        label: typeof model.displayName === "string" ? model.displayName : undefined,
        contextWindow:
          typeof model.inputTokenLimit === "number"
            ? model.inputTokenLimit
            : undefined,
      })
    }
    if (models.length === 0) {
      logDiagnostic({
        provider: providerId,
        operation: "models.list",
        requestId,
        level: "error",
        durationMs: Date.now() - startedAt,
        message: "no usable models for this configuration",
        errorCategory: "empty_response",
      })
      throw new ProviderRequestError(
        502,
        "Google returned no usable models for this configuration."
      )
    }
    modelCache.set(providerId, { models, at: Date.now() })
    logDiagnostic({
      provider: providerId,
      operation: "models.list",
      requestId,
      durationMs: Date.now() - startedAt,
      eventCount: models.length,
      message: `listed ${models.length.toString()} models`,
    })
    return models
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error
    logDiagnostic({
      provider: providerId,
      operation: "models.list",
      requestId,
      level: "error",
      durationMs: Date.now() - startedAt,
      message: "model discovery failed",
      errorCategory: error instanceof ApiError ? "upstream" : "network",
    })
    throw mapSdkError(error, "Google model discovery failed")
  }
}

/**
 * Validates a client-chosen model against the provider's actual discovery
 * list AND the requested role's capability: appearing in a discovery list
 * does not mean the model supports the requested operation. Operator-pinned
 * models (AESTRY_*_MODEL) are explicitly honored, but even they are checked
 * against authoritative metadata when it is retrievable — an explicit pin
 * is a reason to bypass availability, not capability. Deliberately no
 * silent rerouting: an unavailable or incompatible model is an error.
 */
export async function assertModelAvailable(
  providerId: BuiltinProviderId,
  model: string,
  role: "chat" | "image"
): Promise<void> {
  const requiredCapability = role === "chat" ? "multimodal" : "image"
  const config = getBuiltinProviderConfig(providerId)
  const pinned =
    config && config.providerId === "gemini"
      ? role === "chat"
        ? config.chatModelOverride
        : config.imageModelOverride
      : config
        ? role === "chat"
          ? config.chatModelOverride
          : config.imageModelOverride
        : undefined

  // Capability check for exact-model metadata. A 404 rejects (typoed pin,
  // removed model); a clean classification must match the requested role;
  // other metadata failures are the operator pin's documented escape hatch.
  const checkTargetedMetadata = async (): Promise<void> => {
    try {
      const { client } = clientFor(providerId)
      const details = await client.models.get({ model })
      const capability = classifyProviderModel("google", model, modelActions(details))
      if (capability && capability !== requiredCapability) {
        throw new ProviderRequestError(
          400,
          `"${model}" is not a ${requiredCapability} model. Choose a model with the right capability for this operation.`,
          { code: "MODEL_NOT_FOUND" }
        )
      }
      return
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error
      if (error instanceof ApiError && error.status === 404) {
        throw new ProviderRequestError(
          400,
          "The selected model is not available on the configured provider. Refresh the model list and choose again.",
          { code: "MODEL_NOT_FOUND" }
        )
      }
      if (pinned === model) return
      throw new ProviderRequestError(
        400,
        "The selected model is not available on the configured provider. Refresh the model list and choose again."
      )
    }
  }

  // Operator-pinned models validate against targeted metadata only — they
  // must keep working when the discovery list is unavailable.
  if (pinned === model) {
    await checkTargetedMetadata()
    return
  }

  const models = await listGoogleModels(providerId)
  const discovered = models.find((entry) => entry.id === model)

  if (discovered) {
    if (discovered.capability !== requiredCapability) {
      throw new ProviderRequestError(
        400,
        `"${model}" is not a ${requiredCapability} model on the configured provider. Choose a model with the right capability for this operation.`,
        { code: "MODEL_NOT_FOUND" }
      )
    }
    return
  }

  // Unpinned and undiscovered: verify the exact model exists and fits the
  // role before any billable operation.
  await checkTargetedMetadata()
}

type ConsultationTurn = { role: "user" | "assistant"; text: string }

type ConsultationContent = {
  role: "user" | "model"
  parts: Array<Record<string, unknown>>
}

/** Builds SDK contents; reference images attach to the latest user turn. */
function buildContents(
  turns: ConsultationTurn[],
  referenceImages?: Array<{ mimeType: string; data: string }>
): ConsultationContent[] {
  const contents: ConsultationContent[] = turns.map((turn) => ({
    role: turn.role === "user" ? "user" : "model",
    parts: [{ text: turn.text }],
  }))
  if (contents.length === 0) {
    throw new ProviderRequestError(400, "The conversation is empty.")
  }
  if (referenceImages && referenceImages.length > 0) {
    const lastUser = [...contents].reverse().find((c) => c.role === "user")
    if (lastUser) {
      for (const image of referenceImages) {
        lastUser.parts.push({
          inlineData: { mimeType: image.mimeType, data: image.data },
        })
      }
    }
  }
  return contents
}

type UsageReport = {
  promptTokens?: number
  outputTokens?: number
  thoughtsTokens?: number
  totalTokens?: number
}

function readUsage(chunk: unknown): UsageReport | undefined {
  if (typeof chunk !== "object" || chunk === null) return undefined
  const usage = (chunk as Record<string, unknown>).usageMetadata
  if (typeof usage !== "object" || usage === null) return undefined
  const record = usage as Record<string, unknown>
  const numberOrNull = (value: unknown) =>
    typeof value === "number" ? value : undefined
  const usageReport: UsageReport = {
    promptTokens: numberOrNull(record.promptTokenCount),
    outputTokens: numberOrNull(record.candidatesTokenCount),
    thoughtsTokens: numberOrNull(record.thoughtsTokenCount),
    totalTokens: numberOrNull(record.totalTokenCount),
  }
  return Object.values(usageReport).some((value) => value !== undefined)
    ? usageReport
    : undefined
}

function readFinishReason(chunk: unknown): string | undefined {
  if (typeof chunk !== "object" || chunk === null) return undefined
  const candidates = (chunk as Record<string, unknown>).candidates
  if (!Array.isArray(candidates)) return undefined
  const first = candidates[0]
  if (typeof first !== "object" || first === null) return undefined
  const finishReason = (first as Record<string, unknown>).finishReason
  return typeof finishReason === "string" ? finishReason : undefined
}

/** Prompt-level blocking (safety) surfaces before any candidate exists. */
function readPromptBlockReason(chunk: unknown): string | undefined {
  if (typeof chunk !== "object" || chunk === null) return undefined
  const promptFeedback = (chunk as Record<string, unknown>).promptFeedback
  if (typeof promptFeedback !== "object" || promptFeedback === null) {
    return undefined
  }
  const blockReason = (promptFeedback as Record<string, unknown>).blockReason
  return typeof blockReason === "string" ? blockReason : undefined
}

export type ConsultationReply = {
  text: string
  structured: boolean
  warning?: string
  usage?: UsageReport
  finishReason?: string
}

export async function consultGoogle(payload: {
  providerId: BuiltinProviderId
  model: string
  systemPrompt: string
  turns: ConsultationTurn[]
  referenceImages?: Array<{ mimeType: string; data: string }>
  requestId?: string
}): Promise<ConsultationReply> {
  const { client } = clientFor(payload.providerId)
  const requestId = payload.requestId ?? crypto.randomUUID()
  const startedAt = Date.now()
  const contents = buildContents(payload.turns, payload.referenceImages)
  logDiagnostic({
    provider: payload.providerId,
    operation: "chat.generate",
    requestId,
    model: payload.model,
    message: "consultation started",
    detail: `turns: ${payload.turns.length.toString()} · images: ${(payload.referenceImages?.length ?? 0).toString()}`,
  })
  try {
    const response = await client.models.generateContent({
      model: payload.model,
      contents,
      config: {
        systemInstruction: payload.systemPrompt,
        responseMimeType: "application/json",
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    })
    const usage = readUsage(response)
    const finishReason = readFinishReason(response)
    // Thought parts are model-internal reasoning, never the answer; the
    // same extractor is used for streams and single-shot replies.
    const text = extractTextParts(response).trim()
    if (!text) {
      const blockReason = readPromptBlockReason(response)
      logDiagnostic({
        provider: payload.providerId,
        operation: "chat.generate",
        requestId,
        model: payload.model,
        level: "error",
        durationMs: Date.now() - startedAt,
        usage,
        finishReason,
        message: "no text in response",
        errorCategory: blockReason ? "blocked" : "empty_response",
        detail: blockReason ? `promptFeedback.blockReason: ${blockReason}` : undefined,
      })
      throw emptyResponseError(blockReason, finishReason)
    }
    logDiagnostic({
      provider: payload.providerId,
      operation: "chat.generate",
      requestId,
      model: payload.model,
      durationMs: Date.now() - startedAt,
      usage,
      finishReason,
      message: `consultation ok · ${text.length.toString()} chars`,
    })
    return {
      text,
      structured: true,
      usage,
      finishReason,
    }
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error
    logDiagnostic({
      provider: payload.providerId,
      operation: "chat.generate",
      requestId,
      model: payload.model,
      level: "error",
      durationMs: Date.now() - startedAt,
      message: "consultation failed",
      errorCategory: error instanceof ApiError ? "upstream" : "network",
    })
    throw mapSdkError(error, "Google consultation failed")
  }
}

function emptyResponseError(
  blockReason: string | undefined,
  finishReason: string | undefined
): ProviderRequestError {
  if (blockReason) {
    return new ProviderRequestError(
      422,
      `The model declined this request (blockReason: ${blockReason}). Try rephrasing or removing reference images.`
    )
  }
  if (finishReason === "SAFETY") {
    return new ProviderRequestError(
      422,
      "The model response was blocked by safety filters. Try rephrasing the request."
    )
  }
  if (finishReason === "MAX_TOKENS") {
    return new ProviderRequestError(
      502,
      "The model hit its output token limit before producing a response. Ask for a shorter reply."
    )
  }
  return new ProviderRequestError(
    502,
    `The model returned no text${finishReason ? ` (finishReason: ${finishReason})` : ""}.`
  )
}

/**
 * Streams a consultation. `onMessageDelta` receives ONLY the growing
 * user-facing message extracted server-side from the consultant's JSON
 * reply — raw JSON scaffolding never reaches the client, and thought parts
 * never reach either.
 */
export async function streamGoogleConsult(
  payload: {
    providerId: BuiltinProviderId
    model: string
    systemPrompt: string
    turns: ConsultationTurn[]
    referenceImages?: Array<{ mimeType: string; data: string }>
    requestId?: string
    /** Client-disconnect signal; aborts the upstream request. */
    signal?: AbortSignal
  },
  onMessageDelta?: (text: string) => void
): Promise<ConsultationReply> {
  const { client } = clientFor(payload.providerId)
  const requestId = payload.requestId ?? crypto.randomUUID()
  const startedAt = Date.now()
  const contents = buildContents(payload.turns, payload.referenceImages)
  logDiagnostic({
    provider: payload.providerId,
    operation: "chat.stream",
    requestId,
    model: payload.model,
    message: "streaming consultation started",
    detail: `turns: ${payload.turns.length.toString()} · images: ${(payload.referenceImages?.length ?? 0).toString()}`,
  })
  try {
    const abortSignals: AbortSignal[] = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)]
    if (payload.signal) abortSignals.push(payload.signal)
    const stream = await client.models.generateContentStream({
      model: payload.model,
      contents,
      config: {
        systemInstruction: payload.systemPrompt,
        // No responseMimeType here: some current models reject JSON mode in
        // streaming, and the reply parser handles fenced/plain JSON anyway.
        abortSignal: AbortSignal.any(abortSignals),
      },
    })
    let raw = ""
    let deliveredMessage = ""
    let textParts = 0
    let chunkCount = 0
    let usage: UsageReport | undefined
    let finishReason: string | undefined
    let blockReason: string | undefined
    for await (const chunk of stream) {
      chunkCount += 1
      const chunkUsage = readUsage(chunk)
      if (chunkUsage) usage = chunkUsage
      const chunkFinish = readFinishReason(chunk)
      if (chunkFinish) finishReason = chunkFinish
      const chunkBlock = readPromptBlockReason(chunk)
      if (chunkBlock) blockReason = chunkBlock
      const chunkText = extractTextParts(chunk)
      if (chunkText) {
        textParts += 1
        raw += chunkText
        if (onMessageDelta) {
          // The consultant is instructed to emit `message` first, so the
          // partial extraction renders the message as it arrives.
          const partial = extractPartialMessage(raw)
          if (partial && partial.length > deliveredMessage.length) {
            onMessageDelta(partial.slice(deliveredMessage.length))
            deliveredMessage = partial
          }
        }
      }
    }
    const text = raw.trim()
    logDiagnostic({
      provider: payload.providerId,
      operation: "chat.stream",
      requestId,
      model: payload.model,
      level: text ? "info" : "error",
      durationMs: Date.now() - startedAt,
      usage,
      finishReason,
      eventCount: chunkCount,
      message: `stream finished · ${textParts.toString()} text parts · ${text.length.toString()} chars`,
      errorCategory: blockReason
        ? "blocked"
        : text
          ? undefined
          : "empty_response",
    })
    if (!text) {
      throw emptyResponseError(blockReason, finishReason)
    }
    return { text, structured: true, usage, finishReason }
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error
    logDiagnostic({
      provider: payload.providerId,
      operation: "chat.stream",
      requestId,
      model: payload.model,
      level: "error",
      durationMs: Date.now() - startedAt,
      message: "streaming consultation failed",
      errorCategory: error instanceof ApiError ? "upstream" : "network",
    })
    throw mapSdkError(error, "Google consultation failed")
  }
}

/** Concatenates non-thought text parts of a response chunk. */
function extractTextParts(chunk: unknown): string {
  if (typeof chunk !== "object" || chunk === null) return ""
  const candidates = (chunk as Record<string, unknown>).candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return ""
  const first = candidates[0]
  if (typeof first !== "object" || first === null) return ""
  const content = (first as Record<string, unknown>).content
  if (typeof content !== "object" || content === null) return ""
  const parts = (content as Record<string, unknown>).parts
  if (!Array.isArray(parts)) return ""
  let text = ""
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue
    const record = part as Record<string, unknown>
    if (record.thought === true) continue
    if (typeof record.text === "string") {
      text += record.text
    }
  }
  return text
}

export type GeneratedImageResult =
  | { ok: true; mimeType: string; data: string }
  | { ok: false; error: string }

export async function generateImagesGoogle(payload: {
  providerId: BuiltinProviderId
  model: string
  /** One prompt per image slot, in request order. */
  prompts: string[]
  count: number
  referenceImages?: Array<{ mimeType: string; data: string }>
  requestId?: string
}): Promise<GeneratedImageResult[]> {
  const { client } = clientFor(payload.providerId)
  const requestId = payload.requestId ?? crypto.randomUUID()
  const startedAt = Date.now()
  logDiagnostic({
    provider: payload.providerId,
    operation: "images.generate",
    requestId,
    model: payload.model,
    message: `generation started · count ${payload.count.toString()}`,
  })
  const calls = payload.prompts.slice(0, payload.count).map((prompt) => {
    const contents = buildContents(
      [{ role: "user", text: prompt }],
      payload.referenceImages
    )
    return client.models.generateContent({
      model: payload.model,
      contents,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    })
  })
  const settled = await Promise.allSettled(calls)
  const results = await Promise.all(
    settled.map(async (item): Promise<GeneratedImageResult> => {
      if (item.status === "rejected") {
        const mapped = mapSdkError(item.reason, "The request to Google failed.")
        return { ok: false, error: mapped.message }
      }
      const response = item.value
      const candidate = response.candidates?.[0]
      const parts = candidate?.content?.parts ?? []
      let text: string | undefined
      for (const part of parts) {
        if (part.thought === true) continue
        const inline = part.inlineData
        if (inline && typeof inline.mimeType === "string" && typeof inline.data === "string") {
          return { ok: true, mimeType: inline.mimeType, data: inline.data }
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
  logDiagnostic({
    provider: payload.providerId,
    operation: "images.generate",
    requestId,
    model: payload.model,
    level: results.every((result) => result.ok)
      ? "info"
      : results.some((result) => result.ok)
        ? "warn"
        : "error",
    durationMs: Date.now() - startedAt,
    eventCount: results.length,
    message: `generation finished · ${results.filter((result) => result.ok).length.toString()}/${payload.count.toString()} ok`,
    errorCategory: results.some((result) => result.ok) ? undefined : "empty_response",
  })
  return results
}

/**
 * Exact token count for the next consultation request, via the SDK's
 * countTokens. The system prompt is included; images are counted
 * conservatively by the caller (countTokens only sees text here).
 */
export async function countConsultationTokens(payload: {
  providerId: BuiltinProviderId
  model: string
  systemPrompt: string
  turns: ConsultationTurn[]
}): Promise<number | undefined> {
  const { client } = clientFor(payload.providerId)
  try {
    const response = await client.models.countTokens({
      model: payload.model,
      contents: payload.turns.map((turn) => ({
        role: turn.role === "user" ? "user" : "model",
        parts: [{ text: turn.text }],
      })),
      config: { systemInstruction: payload.systemPrompt },
    })
    return typeof response.totalTokens === "number"
      ? response.totalTokens
      : undefined
  } catch {
    // Token counting is an enhancement; its absence degrades to estimates.
    return undefined
  }
}

/**
 * Input token limit for the selected model, from discovery metadata (with a
 * targeted lookup for operator-pinned models missing from the list).
 */
export async function getModelInputLimit(
  providerId: BuiltinProviderId,
  model: string
): Promise<number | undefined> {
  const models = await listGoogleModels(providerId)
  const found = models.find((entry) => entry.id === model)
  if (found?.contextWindow) return found.contextWindow
  try {
    const { client } = clientFor(providerId)
    const details = await client.models.get({ model })
    return typeof details.inputTokenLimit === "number"
      ? details.inputTokenLimit
      : undefined
  } catch {
    return undefined
  }
}
