import { NextResponse } from "next/server"

import {
  generationRequestSchema,
  type GenerationApiResponse,
  type GenerationResult,
} from "@/lib/generation"

// Same-origin generation proxy. The API key travels from the user's browser
// to their own self-hosted Aestry server and is used exactly once, against
// the provider endpoint it belongs to. Keys are never logged or persisted.

const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

const REQUEST_TIMEOUT_MS = 180_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function upstreamDetail(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json()
    if (isRecord(body) && isRecord(body.error)) {
      if (typeof body.error.message === "string") return body.error.message
    }
    if (isRecord(body) && typeof body.message === "string") {
      return body.message
    }
  } catch {
    // Non-JSON error body.
  }
  return undefined
}

function fetchTimeout(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS)
}

function requestLevelError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

// Google: N independent generateContent calls (one image each).
async function generateWithGoogle(
  apiKey: string,
  model: string,
  prompt: string,
  referenceImages: Array<{ mimeType: string; data: string }> | undefined,
  count: number
): Promise<GenerationResult[]> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }]
  for (const image of referenceImages ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
  }

  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  })

  const calls = Array.from({ length: count }, () =>
    fetch(
      `${GOOGLE_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body,
        signal: fetchTimeout(),
      }
    )
  )

  const settled = await Promise.allSettled(calls)
  return Promise.all(
    settled.map(async (item): Promise<GenerationResult> => {
      if (item.status === "rejected") {
        return {
          ok: false,
          error:
            item.reason instanceof DOMException &&
            item.reason.name === "TimeoutError"
              ? "Google took too long to respond."
              : "The request to Google failed.",
        }
      }
      const response = item.value
      if (!response.ok) {
        const detail = await upstreamDetail(response)
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            error: detail ?? "The API key was rejected by Google.",
          }
        }
        if (response.status === 429) {
          return {
            ok: false,
            error: detail ?? "Rate limited by Google — try fewer images.",
          }
        }
        return {
          ok: false,
          error: detail ?? `Google responded with ${response.status}.`,
        }
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
            image: { mimeType: inline.mimeType, data: inline.data },
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

// OpenAI-compatible: one images/generations call returning N images.
async function generateWithOpenAiCompatible(
  apiKey: string,
  model: string,
  baseUrl: string | undefined,
  prompt: string,
  count: number
): Promise<GenerationResult[]> {
  if (!baseUrl) {
    return [{ ok: false, error: "This provider has no base URL configured." }]
  }
  let root: URL
  try {
    root = new URL(baseUrl)
  } catch {
    return [{ ok: false, error: "The provider base URL is invalid." }]
  }
  if (root.protocol !== "http:" && root.protocol !== "https:") {
    return [{ ok: false, error: "Only http and https endpoints are supported." }]
  }

  const response = await fetch(
    `${root.origin}${root.pathname.replace(/\/+$/, "")}/images/generations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: count,
        response_format: "b64_json",
      }),
      signal: fetchTimeout(),
    }
  ).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return null
    }
    throw error
  })
  if (response === null) {
    return [{ ok: false, error: "The endpoint took too long to respond." }]
  }
  if (!response.ok) {
    const detail = await upstreamDetail(response)
    if (response.status === 401 || response.status === 403) {
      return [
        {
          ok: false,
          error: detail ?? "The API key was rejected by the endpoint.",
        },
      ]
    }
    if (response.status === 429) {
      return [
        {
          ok: false,
          error: detail ?? "Rate limited by the endpoint — try fewer images.",
        },
      ]
    }
    return [
      {
        ok: false,
        error: detail ?? `The endpoint responded with ${response.status}.`,
      },
    ]
  }

  const data: unknown = await response.json().catch(() => null)
  const rawImages = isRecord(data) && Array.isArray(data.data) ? data.data : []
  const results: GenerationResult[] = []
  for (const item of rawImages.slice(0, count)) {
    if (!isRecord(item)) continue
    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      results.push({
        ok: true,
        image: { mimeType: "image/png", data: item.b64_json },
      })
      continue
    }
    if (typeof item.url === "string" && item.url.length > 0) {
      // Some endpoints return temporary URLs instead of inline base64.
      const fetched = await fetch(item.url, { signal: fetchTimeout() }).catch(
        () => null
      )
      if (!fetched || !fetched.ok) {
        results.push({ ok: false, error: "Could not download a generated image." })
        continue
      }
      const buffer = Buffer.from(await fetched.arrayBuffer())
      const mimeType = fetched.headers.get("content-type") ?? "image/png"
      results.push({
        ok: true,
        image: {
          mimeType: mimeType.startsWith("image/") ? mimeType : "image/png",
          data: buffer.toString("base64"),
        },
      })
    }
  }
  if (results.length === 0) {
    return [{ ok: false, error: "The endpoint returned no images." }]
  }
  return results
}

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null)
  const parsed = generationRequestSchema.safeParse(body)
  if (!parsed.success) {
    return requestLevelError(400, "Invalid generation request.")
  }
  const { kind, apiKey, model, baseUrl, prompt, count, referenceImages } =
    parsed.data

  try {
    if (kind === "google") {
      const results = await generateWithGoogle(
        apiKey,
        model,
        prompt,
        referenceImages,
        count
      )
      const payload: GenerationApiResponse = { results }
      return NextResponse.json(payload)
    }

    const results = await generateWithOpenAiCompatible(
      apiKey,
      model,
      baseUrl,
      prompt,
      count
    )
    const payload: GenerationApiResponse = { results }
    if (referenceImages && referenceImages.length > 0) {
      payload.warning =
        "Reference images are only used with the Google provider right now."
    }
    return NextResponse.json(payload)
  } catch {
    return requestLevelError(502, "Could not reach the provider endpoint.")
  }
}
