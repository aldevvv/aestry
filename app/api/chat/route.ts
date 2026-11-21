import { NextResponse } from "next/server"

import {
  chatRequestSchema,
  type ChatApiResponse,
  type ChatRequestBody,
} from "@/lib/conversation/schema"
import {
  buildCompactionSystemPrompt,
  parseCompactionReply,
} from "@/lib/conversation/compaction"
import {
  buildConsultationSystemPrompt,
  parseConsultationReply,
} from "@/lib/conversation/consultation"
import {
  consultGoogle,
  streamGoogleConsult,
} from "@/lib/providers/google"
import {
  consultOpenAiCompatible,
  streamOpenAiCompatibleConsult,
} from "@/lib/providers/openai-compatible"
import { ProviderRequestError } from "@/lib/providers/types"

/**
 * POST /api/chat — multimodal consultation through the user's configured
 * provider. Consultation streams over SSE by default (native Gemini
 * streamGenerateContent / OpenAI-compatible chat completions); compaction
 * runs as a single JSON round-trip. The key travels browser -> this
 * self-hosted server -> provider exactly once and is never logged or
 * persisted.
 */

function errorStatus(error: unknown): { status: number; message: string } {
  if (error instanceof ProviderRequestError) {
    return {
      status: error.status >= 400 && error.status < 500 ? error.status : 502,
      message: error.message,
    }
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { status: 504, message: "The provider took too long to respond." }
  }
  return { status: 502, message: "Could not reach the provider endpoint." }
}

function buildConsultStream(input: ChatRequestBody): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        const systemPrompt = buildConsultationSystemPrompt(
          input.skillId,
          input.brief ?? null,
          input.projectContext
        )
        const adapterPayload = {
          apiKey: input.apiKey,
          model: input.model,
          baseUrl: input.baseUrl,
          systemPrompt,
          turns: input.history,
          referenceImages: input.referenceImages,
        }
        const onDelta = (text: string) => {
          send({ type: "delta", text })
        }
        const reply =
          input.kind === "google"
            ? await streamGoogleConsult(adapterPayload, onDelta)
            : await streamOpenAiCompatibleConsult(adapterPayload, onDelta)

        if (typeof reply.usage?.promptTokens === "number") {
          send({ type: "usage", usage: reply.usage })
        }
        const outcome = parseConsultationReply(reply.text)
        send({
          type: "outcome",
          outcome,
          ...(reply.warning ? { warning: reply.warning } : {}),
        })
      } catch (error) {
        const mapped = errorStatus(error)
        send({ type: "error", error: mapped.message, status: mapped.status })
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })
}

export async function POST(request: Request): Promise<NextResponse | Response> {
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
    mode,
    stream,
  } = parsed.data

  // Compaction is a single JSON round-trip; consultation streams.
  if (mode === "consult" && stream) {
    return new Response(buildConsultStream(parsed.data), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  }

  const systemPrompt =
    mode === "compact"
      ? buildCompactionSystemPrompt()
      : buildConsultationSystemPrompt(
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
      referenceImages: mode === "consult" ? referenceImages : undefined,
    }
    const reply =
      kind === "google"
        ? await consultGoogle(adapterPayload)
        : await consultOpenAiCompatible(adapterPayload)

    const payload: ChatApiResponse = {}
    if (typeof reply.usage?.promptTokens === "number") {
      payload.usage = { promptTokens: reply.usage.promptTokens }
    }
    if (typeof reply.warning === "string") {
      payload.warning = reply.warning
    }

    if (mode === "compact") {
      const compaction = parseCompactionReply(reply.text)
      if (!compaction) {
        return NextResponse.json(
          {
            error: "Compaction could not produce a reliable summary.",
            usage: payload.usage,
          },
          { status: 502 }
        )
      }
      payload.compaction = compaction
      return NextResponse.json(payload)
    }

    payload.outcome = parseConsultationReply(reply.text)
    return NextResponse.json(payload)
  } catch (error) {
    const mapped = errorStatus(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
