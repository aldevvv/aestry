import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { classifyProviderModel, inferCapabilities } from "./models"
import { generateImagesGoogle } from "./google"

describe("classifyProviderModel", () => {
  it("buckets Google image models and filters unusable ones", () => {
    expect(classifyProviderModel("google", "gemini-2.5-flash-image")).toBe("image")
    expect(classifyProviderModel("google", "imagen-4.0-generate-001")).toBe("image")
    expect(classifyProviderModel("google", "gemini-2.5-flash")).toBe("multimodal")
    expect(classifyProviderModel("google", "gemini-embedding-001")).toBeNull()
    expect(classifyProviderModel("google", "veo-3.0-generate")).toBeNull()
    expect(classifyProviderModel("google", "gemini-2.5-flash-preview-tts")).toBeNull()
  })

  it("uses supportedGenerationMethods for ambiguous ids", () => {
    expect(
      classifyProviderModel("google", "custom-model", ["predictLongRunning"])
    ).toBe("image")
    expect(classifyProviderModel("google", "custom-model", ["embed"])).toBeNull()
    expect(
      classifyProviderModel("google", "custom-model", ["generateContent"])
    ).toBe("multimodal")
  })

  it("heuristically classifies OpenAI-compatible ids", () => {
    expect(classifyProviderModel("openai-compatible", "gpt-image-1")).toBe("image")
    expect(classifyProviderModel("openai-compatible", "flux.1-schnell")).toBe("image")
    expect(classifyProviderModel("openai-compatible", "llama-3.1-8b")).toBe("multimodal")
    expect(classifyProviderModel("openai-compatible", "text-embedding-3")).toBeNull()
  })
})

describe("inferCapabilities", () => {
  it("is conservative for OpenAI-compatible endpoints", () => {
    const vision = inferCapabilities("openai-compatible", "gpt-4o")
    expect(vision.vision).toBe(true)
    expect(vision.verified).toBe(false)
    const plain = inferCapabilities("openai-compatible", "some-local-model")
    expect(plain.vision).toBe(false)
    expect(plain.imageEditing).toBe(false)
    expect(plain.verified).toBe(false)
  })

  it("treats Google image models as reference-conditioned", () => {
    expect(inferCapabilities("google", "gemini-2.5-flash-image").imageEditing).toBe(true)
  })
})

describe("generateImagesGoogle", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const basePayload = {
    apiKey: "test-key",
    model: "gemini-2.5-flash-image",
    prompt: "test prompt",
    count: 2,
  }

  function geminiResponse(parts: unknown[]): unknown {
    return {
      candidates: [{ content: { role: "model", parts } }],
    }
  }

  it("collects one image per successful call", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify(
          geminiResponse([
            { text: "Here is your icon." },
            { inlineData: { mimeType: "image/png", data: "QUJD" } },
          ])
        ),
        { headers: { "Content-Type": "application/json" } }
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    const results = await generateImagesGoogle(basePayload)
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.mimeType).toBe("image/png")
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("reports per-call failures without hiding successes", async () => {
    let call = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1
        if (call === 1) {
          return new Response(
            JSON.stringify(
              geminiResponse([{ inlineData: { mimeType: "image/png", data: "QUJD" } }])
            ),
            { headers: { "Content-Type": "application/json" } }
          )
        }
        return new Response(
          JSON.stringify({ error: { message: "quota exceeded" } }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        )
      })
    )
    const results = await generateImagesGoogle(basePayload)
    expect(results).toHaveLength(2)
    expect(results[0].ok).toBe(true)
    expect(results[1]).toEqual({ ok: false, error: "quota exceeded" })
  })

  it("surfaces model refusals as errors, not successes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(geminiResponse([{ text: "I cannot create that content." }])),
          { headers: { "Content-Type": "application/json" } }
        )
      )
    )
    const results = await generateImagesGoogle({ ...basePayload, count: 1 })
    expect(results[0]).toEqual({
      ok: false,
      error: "I cannot create that content.",
    })
  })

  it("sends reference images as inlineData parts on every call", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(geminiResponse([{ inlineData: { mimeType: "image/png", data: "QQ" } }])), {
        headers: { "Content-Type": "application/json" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    await generateImagesGoogle({
      ...basePayload,
      count: 1,
      referenceImages: [{ mimeType: "image/png", data: "QUJD" }],
    })
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    )
    const parts = body.contents[0].parts as Array<Record<string, unknown>>
    expect(parts.some((part) => "inlineData" in part)).toBe(true)
  })
})
