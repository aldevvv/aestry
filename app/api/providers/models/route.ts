import { NextResponse } from "next/server"
import { z } from "zod"

import {
  assertModelAvailable,
  listGoogleModels,
} from "@/lib/providers/google"
import { isBuiltinProviderId } from "@/lib/providers/registry"
import { ProviderRequestError } from "@/lib/providers/types"
import { requireAccess } from "@/lib/server/access"
import { readJsonBody } from "@/lib/server/limits"

// POST /api/providers/models — model discovery for a configured built-in
// provider. Credentials resolve server-side; the browser never sends them.
// Operator-access gated. An optional `model` + `role` validates a specific
// selection instead of listing.

const bodySchema = z.object({
  providerId: z.enum(["gemini", "vertex"]),
  model: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["chat", "image"]).optional(),
})

export async function POST(request: Request): Promise<NextResponse> {
  const denial = requireAccess(request)
  if (denial) return denial

  const body = await readJsonBody(request, 4_096)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status })
  }
  const parsed = bodySchema.safeParse(body.data)
  if (!parsed.success || !isBuiltinProviderId(parsed.data.providerId)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }
  const { providerId, model, role } = parsed.data

  try {
    if (model && role) {
      await assertModelAvailable(providerId, model, role)
      return NextResponse.json({ available: true })
    }
    const models = await listGoogleModels(providerId)
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
