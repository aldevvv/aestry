import { NextResponse } from "next/server"
import { z } from "zod"

import { listGoogleModels } from "@/lib/providers/google"
import { isBuiltinProviderId } from "@/lib/providers/registry"
import { ProviderRequestError } from "@/lib/providers/types"
import { requireAccess } from "@/lib/server/access"
import { readJsonBody, withSlot } from "@/lib/server/limits"

/**
 * POST /api/providers/verify — an explicit, bounded connection check for a
 * configured built-in provider. Verification performs model discovery only:
 * it never triggers billable generation, and its outcome (verified /
 * verification failed) is reported to the caller without credential detail.
 */

const bodySchema = z.object({
  providerId: z.enum(["gemini", "vertex"]),
})

export async function POST(request: Request): Promise<NextResponse> {
  const denial = requireAccess(request)
  if (denial) return denial

  const body = await readJsonBody(request, 4_096)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status })
  }
  const parsedBody = bodySchema.safeParse(body.data)
  if (!parsedBody.success || !isBuiltinProviderId(parsedBody.data.providerId)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }
  const { providerId } = parsedBody.data

  const result = await withSlot("provider-verify", 1, async () => {
    const startedAt = Date.now()
    try {
      const models = await listGoogleModels(providerId)
      return NextResponse.json({
        verified: true,
        modelCount: models.length,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      if (error instanceof ProviderRequestError) {
        return NextResponse.json(
          {
            verified: false,
            error: error.message,
            durationMs: Date.now() - startedAt,
          },
          { status: 200 }
        )
      }
      return NextResponse.json(
        {
          verified: false,
          error: "The provider could not be reached.",
          durationMs: Date.now() - startedAt,
        },
        { status: 200 }
      )
    }
  })

  return (
    result ??
    NextResponse.json(
      { verified: false, error: "A verification attempt is already running." },
      { status: 503 }
    )
  )
}
