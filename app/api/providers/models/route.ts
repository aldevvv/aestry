import { NextResponse } from "next/server"
import { z } from "zod"

import { listGoogleModels } from "@/lib/providers/google"
import { listOpenAiCompatibleModels } from "@/lib/providers/openai-compatible"
import { ProviderRequestError } from "@/lib/providers/types"

// Same-origin proxy for provider model discovery. The API key travels from
// the user's browser to their own self-hosted Aestry server and is used
// exactly once, against the endpoint it belongs to. Keys are never logged
// or forwarded anywhere else.

const bodySchema = z.object({
  kind: z.enum(["google", "openai-compatible"]),
  apiKey: z.string().trim().min(1),
  baseUrl: z.string().trim().optional(),
})

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }
  const { kind, apiKey, baseUrl } = parsed.data

  try {
    const models =
      kind === "google"
        ? await listGoogleModels(apiKey)
        : await listOpenAiCompatibleModels(apiKey, baseUrl)
    // Presentation order: image-capable models first, then alphabetical.
    models.sort(
      (a, b) =>
        Number(b.capability === "image") - Number(a.capability === "image") ||
        a.id.localeCompare(b.id)
    )
    return NextResponse.json({ models })
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status >= 400 && error.status < 500 ? error.status : 502 }
      )
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "The provider took too long to respond." },
        { status: 504 }
      )
    }
    return NextResponse.json(
      { error: "Could not reach the provider endpoint." },
      { status: 502 }
    )
  }
}
