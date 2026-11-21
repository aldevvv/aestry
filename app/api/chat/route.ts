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
  assertModelAvailable,
  consultGoogle,
  streamGoogleConsult,
} from "@/lib/providers/google"
import { ProviderRequestError } from "@/lib/providers/types"
import { requireAccess } from "@/lib/server/access"
import { readJsonBody, releaseSlot, tryAcquireSlot } from "@/lib/server/limits"

/**
 * POST /api/chat — multimodal consultation through a configured built-in
 * provider. Credentials resolve server-side from the environment; the
 * browser never sends or stores them. Consultation streams over SSE by
 * default (deltas are server-extracted message text); compaction runs as a
 * single JSON round-trip. Operator-access gated and concurrency bounded.
 */

const MAX_BODY_BYTES = 48 * 1024 * 1024
const MAX_CONCURRENT_PROVIDER_OPS = 4

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

function buildConsultStream(
  input: ChatRequestBody,
  systemPrompt: string
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        const requestId = crypto.randomUUID()
        const onDelta = (text: string) => {
          send({ type: "delta", text })
        }
        const reply = await streamGoogleConsult(
          {
            providerId: input.providerId,
            model: input.model,
            systemPrompt,
            turns: input.history,
            referenceImages: input.referenceImages,
            requestId,
          },
          onDelta
        )

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
      } finally {
        // The concurrency slot is held for the whole stream, not just the
        // moment the response headers are sent.
        releaseSlot("provider-ops")
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })
}

export async function POST(request: Request): Promise<NextResponse | Response> {
  const denial = requireAccess(request)
  if (denial) return denial

  const body = await readJsonBody(request, MAX_BODY_BYTES)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status })
  }
  const parsed = chatRequestSchema.safeParse(body.data)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid consultation request." }, { status: 400 })
  }
  const input = parsed.data

  if (!tryAcquireSlot("provider-ops", MAX_CONCURRENT_PROVIDER_OPS)) {
    return NextResponse.json(
      { error: "The server is busy with existing provider requests. Try again shortly." },
      { status: 503 }
    )
  }

  try {
    const systemPrompt =
      input.mode === "compact"
        ? buildCompactionSystemPrompt()
        : buildConsultationSystemPrompt(
            input.skillId,
            input.brief ?? null,
            input.projectContext
          )

    // The chosen model must actually exist on the configured provider —
    // availability is validated server-side, never silently rerouted.
    await assertModelAvailable(input.providerId, input.model, "chat")

    // Compaction is a single JSON round-trip; consultation streams.
    if (input.mode === "consult" && input.stream) {
      // The stream owns the concurrency slot and releases it on completion.
      return new Response(buildConsultStream(input, systemPrompt), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      })
    }

    const reply = await consultGoogle({
      providerId: input.providerId,
      model: input.model,
      systemPrompt,
      turns: input.history,
      referenceImages:
        input.mode === "consult" ? input.referenceImages : undefined,
    })

    const payload: ChatApiResponse = {}
    if (typeof reply.usage?.promptTokens === "number") {
      payload.usage = { promptTokens: reply.usage.promptTokens }
    }
    if (typeof reply.warning === "string") {
      payload.warning = reply.warning
    }

    if (input.mode === "compact") {
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
  } finally {
    releaseSlot("provider-ops")
  }
}
