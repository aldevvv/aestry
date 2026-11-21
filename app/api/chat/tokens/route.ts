import { NextResponse } from "next/server"
import { z } from "zod"

import { buildConsultationSystemPrompt } from "@/lib/conversation/consultation"
import { countConsultationTokens } from "@/lib/providers/google"
import { ProviderRequestError } from "@/lib/providers/types"
import { requireAccess } from "@/lib/server/access"
import { readJsonBody } from "@/lib/server/limits"

/**
 * POST /api/chat/tokens — exact token count for a prospective consultation
 * request via the SDK's countTokens. Used as the confirmatory second stage
 * of the auto-compaction decision: the cheap client-side estimate decides
 * when to ask, and the exact count decides whether a billable compaction
 * round-trip is actually necessary. Absence of counting support is
 * reported honestly so the caller can fall back to the estimate.
 */

const bodySchema = z.object({
  providerId: z.enum(["gemini", "vertex"]),
  model: z.string().trim().min(1).max(120),
  skillId: z.enum(["app-icon", "logo", "og-image"]),
  brief: z
    .object({
      concept: z.string().min(1),
      style: z.string().min(1),
      palette: z.string().min(1),
      composition: z.string().min(1),
      symbolism: z.string().nullish(),
      typography: z.string().nullish(),
      headline: z.string().nullish(),
      subline: z.string().nullish(),
      constraints: z.array(z.string()).max(8).nullish(),
    })
    .nullish(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(8_000),
      })
    )
    .max(80),
  projectContext: z.string().max(8_000).optional(),
})

export async function POST(request: Request): Promise<NextResponse> {
  const denial = requireAccess(request)
  if (denial) return denial

  const body = await readJsonBody(request, 256 * 1024)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status })
  }
  const parsed = bodySchema.safeParse(body.data)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }
  const input = parsed.data

  try {
    const systemPrompt = buildConsultationSystemPrompt(
      input.skillId,
      input.brief ?? null,
      input.projectContext
    )
    const totalTokens = await countConsultationTokens({
      providerId: input.providerId,
      model: input.model,
      systemPrompt,
      turns: input.history,
    })
    return NextResponse.json(
      totalTokens === undefined
        ? { available: false }
        : { available: true, totalTokens }
    )
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status >= 400 && error.status < 500 ? error.status : 502 }
      )
    }
    return NextResponse.json(
      { error: "Could not count tokens for the next request." },
      { status: 502 }
    )
  }
}
