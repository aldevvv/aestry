import { NextResponse } from "next/server"
import { z } from "zod"

// Same-origin proxy for provider model discovery. The API key travels from
// the user's browser to their own self-hosted Aestry server and is then used
// exactly once, against the endpoint it belongs to. Keys are never logged or
// forwarded anywhere else.

const GOOGLE_LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models"

const bodySchema = z.object({
  kind: z.enum(["google", "openai-compatible"]),
  apiKey: z.string().trim().min(1),
  baseUrl: z.string().trim().optional(),
})

type FetchedModel = { id: string; label?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// Surface image-capable models first; the rest follows alphabetically. This
// is presentation order only — the full list the key can access is returned.
function sortModels(models: FetchedModel[]): FetchedModel[] {
  const isImageLike = (model: FetchedModel) =>
    /image|imagen/i.test(`${model.id} ${model.label ?? ""}`)
  return [...models].sort(
    (a, b) =>
      Number(isImageLike(b)) - Number(isImageLike(a)) ||
      a.id.localeCompare(b.id)
  )
}

function upstreamErrorResponse(
  status: number,
  detail?: string
): NextResponse {
  if (status === 401 || status === 403) {
    return NextResponse.json(
      { error: detail ?? "The API key was rejected by the provider." },
      { status: 401 }
    )
  }
  if (status === 404) {
    return NextResponse.json(
      { error: "This endpoint does not expose a model list." },
      { status: 404 }
    )
  }
  return NextResponse.json(
    {
      error:
        detail ?? `The provider responded with status ${status.toString()}.`,
    },
    { status: 502 }
  )
}

async function fetchGoogleModels(
  apiKey: string
): Promise<NextResponse> {
  const models: FetchedModel[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(GOOGLE_LIST_URL)
    url.searchParams.set("pageSize", "200")
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken)
    }
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return NextResponse.json(
          { error: "The request to Google timed out." },
          { status: 504 }
        )
      }
      throw error
    }
    if (!response.ok) {
      let detail: string | undefined
      try {
        const body: unknown = await response.json()
        if (
          isRecord(body) &&
          isRecord(body.error) &&
          typeof body.error.message === "string"
        ) {
          detail = body.error.message
        }
      } catch {
        // Non-JSON error body; fall back to the generic message.
      }
      return upstreamErrorResponse(response.status, detail)
    }
    const data: unknown = await response.json()
    const rawModels =
      isRecord(data) && Array.isArray(data.models) ? data.models : []
    for (const item of rawModels) {
      if (!isRecord(item) || typeof item.name !== "string") continue
      models.push({
        id: item.name.replace(/^models\//, ""),
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
    return NextResponse.json(
      { error: "Google returned no models for this key." },
      { status: 502 }
    )
  }
  return NextResponse.json({ models: sortModels(models) })
}

async function fetchOpenAiCompatibleModels(
  baseUrl: string,
  apiKey: string
): Promise<NextResponse> {
  let root: URL
  try {
    root = new URL(baseUrl)
  } catch {
    return NextResponse.json(
      { error: "Enter a valid base URL." },
      { status: 400 }
    )
  }
  if (root.protocol !== "http:" && root.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only http and https endpoints are supported." },
      { status: 400 }
    )
  }

  const listUrl = `${root.origin}${root.pathname.replace(/\/+$/, "")}/models${
    root.search
  }`
  let response: Response
  try {
    response = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "The request to the endpoint timed out." },
        { status: 504 }
      )
    }
    throw error
  }
  if (!response.ok) {
    let detail: string | undefined
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && isRecord(body.error)) {
        if (typeof body.error.message === "string") {
          detail = body.error.message
        }
      } else if (isRecord(body) && typeof body.message === "string") {
        detail = body.message
      }
    } catch {
      // Non-JSON error body; fall back to the generic message.
    }
    return upstreamErrorResponse(response.status, detail)
  }

  const data: unknown = await response.json()
  const rawModels = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.data)
      ? data.data
      : []
  const models: FetchedModel[] = []
  for (const item of rawModels) {
    if (typeof item === "string") {
      models.push({ id: item })
    } else if (isRecord(item) && typeof item.id === "string") {
      models.push({
        id: item.id,
        label: typeof item.displayName === "string" ? item.displayName : undefined,
      })
    }
  }
  if (models.length === 0) {
    return NextResponse.json(
      { error: "The endpoint returned no models." },
      { status: 502 }
    )
  }
  return NextResponse.json({ models: sortModels(models) })
}

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request." },
      { status: 400 }
    )
  }
  const { kind, apiKey } = parsed.data

  try {
    if (kind === "google") {
      return await fetchGoogleModels(apiKey)
    }
    if (!parsed.data.baseUrl) {
      return NextResponse.json(
        { error: "A base URL is required for OpenAI-compatible providers." },
        { status: 400 }
      )
    }
    return await fetchOpenAiCompatibleModels(parsed.data.baseUrl, apiKey)
  } catch {
    return NextResponse.json(
      { error: "Could not reach the provider endpoint." },
      { status: 502 }
    )
  }
}
