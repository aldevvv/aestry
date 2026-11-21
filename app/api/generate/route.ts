import { NextResponse } from "next/server"
import { z } from "zod"

import { compileGenerationPrompt } from "@/lib/skills/registry"
import {
  assertModelAvailable,
  generateImagesGoogle,
} from "@/lib/providers/google"
import { ProviderRequestError } from "@/lib/providers/types"
import type { GenerationApiResponse } from "@/lib/generation"
import { requireAccess } from "@/lib/server/access"
import { readJsonBody, withSlot } from "@/lib/server/limits"

// POST /api/generate — the server compiles the generation prompt from the
// validated skill + design brief. Caller-supplied compiled prompts are not
// trusted: skill constraints are enforced here, server-side. Credentials
// resolve from the server environment. Operator-access gated and
// concurrency bounded: every call is billable inference.

const MAX_BODY_BYTES = 32 * 1024 * 1024
const MAX_CONCURRENT_GENERATIONS = 2

const referenceImageSchema = z.object({
  mimeType: z.string().regex(/^image\//),
  data: z
    .string()
    .min(1)
    .max(11_000_000, "A reference image is too large"),
})

const bodySchema = z.object({
  providerId: z.enum(["gemini", "vertex"]),
  model: z.string().trim().min(1).max(120),
  skillId: z.enum(["app-icon", "logo", "og-image"]),
  brief: z.object({
    concept: z.string().min(1),
    style: z.string().min(1),
    palette: z.string().min(1),
    composition: z.string().min(1),
    symbolism: z.string().nullish(),
    typography: z.string().nullish(),
    headline: z.string().nullish(),
    subline: z.string().nullish(),
    constraints: z.array(z.string()).max(8).nullish(),
  }),
  count: z.number().int().min(1).max(4),
  refinement: z.string().trim().max(4_000).optional(),
  referenceImages: z
    .array(referenceImageSchema)
    .max(4)
    .refine(
      (images) =>
        images.reduce((sum, image) => sum + image.data.length, 0) <=
        24_000_000,
      "Reference images are too large overall"
    )
    .optional(),
})

export async function POST(request: Request): Promise<NextResponse> {
  const denial = requireAccess(request)
  if (denial) return denial

  const body = await readJsonBody(request, MAX_BODY_BYTES)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status })
  }
  const parsed = bodySchema.safeParse(body.data)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid generation request." },
      { status: 400 }
    )
  }
  const { providerId, model, skillId, brief, count, refinement, referenceImages } =
    parsed.data

  let prompt: string
  try {
    prompt = compileGenerationPrompt(skillId, brief, refinement)
  } catch {
    return NextResponse.json(
      { error: "The design brief is incomplete." },
      { status: 400 }
    )
  }

  try {
    await assertModelAvailable(providerId, model, "image")
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: "Could not validate the selected model." },
      { status: 502 }
    )
  }

  const result = await withSlot("generation", MAX_CONCURRENT_GENERATIONS, async () => {
    try {
      const results = await generateImagesGoogle({
        providerId,
        model,
        prompt,
        count,
        referenceImages,
      })
      const payload: GenerationApiResponse & { prompt: string } = {
        results,
        prompt,
      }
      return NextResponse.json(payload)
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
  })

  return (
    result ??
    NextResponse.json(
      { error: "A generation is already running — wait for it to finish." },
      { status: 503 }
    )
  )
}
