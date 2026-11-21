import { NextResponse } from "next/server"

import { chatRequestSchema, type ChatApiResponse } from "@/lib/conversation/schema"
import {
  buildConsultationSystemPrompt,
  parseConsultationReply,
} from "@/lib/conversation/consultation"
import { consultGoogle } from "@/lib/providers/google"
import { consultOpenAiCompatible } from "@/lib/providers/openai-compatible"
import { ProviderRequestError } from "@/lib/providers/types"

/**
 * POST /api/chat — multimodal design consultation through the user's
 * configured provider. The key travels browser -> this self-hosted server ->
 * provider exactly once and is never logged or persisted.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null)
  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid consultation request." }, { status: 400 })
  }
  const {
    kind,
    apiKey,
    model,
    baseUrl,
    skillId,
    brief,
    history,
    referenceImages,
    projectContext,
  } = parsed.data

  const systemPrompt = buildConsultationSystemPrompt(
    skillId,
    brief ?? null,
    projectContext
  )

  try {
    const adapterPayload = {
      apiKey,
      model,
      baseUrl,
      systemPrompt,
      turns: history,
      referenceImages,
    }
    const reply =
      kind === "google"
        ? await consultGoogle(adapterPayload)
        : await consultOpenAiCompatible(adapterPayload)

    const outcome = parseConsultationReply(reply.text)
    const payload: ChatApiResponse = { outcome }
    if (typeof reply.warning === "string") {
      payload.warning = reply.warning
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
}
