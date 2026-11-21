import { afterEach, describe, expect, it, vi } from "vitest"

import {
  consultOpenAiCompatible,
  generateImagesOpenAiCompatible,
} from "./openai-compatible"

describe("consultOpenAiCompatible", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const basePayload = {
    apiKey: "test-key",
    model: "some-local-model",
    baseUrl: "https://api.example.com/v1",
    systemPrompt: "system",
    turns: [{ role: "user" as const, text: "hello" }],
  }

  it("returns unstructured text for models without verified JSON support", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Sure, tell me more." } }],
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      )
    )
    const reply = await consultOpenAiCompatible(basePayload)
    expect(reply.structured).toBe(false)
    expect(reply.text).toBe("Sure, tell me more.")
  })

  it("requests JSON mode only for models with verified-style JSON support", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "{\"message\":\"hi\",\"phase\":\"clarifying\",\"brief\":null,\"clarification\":null}" } }],
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    const reply = await consultOpenAiCompatible({
      ...basePayload,
      model: "gpt-4o",
    })
    expect(reply.structured).toBe(true)
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    )
    expect(body.response_format).toEqual({ type: "json_object" })
  })

  it("omits reference images for models without vision and reports it", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "noted" } }],
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    const reply = await consultOpenAiCompatible({
      ...basePayload,
      referenceImages: [{ mimeType: "image/png", data: "QUJD" }],
    })
    expect(reply.warning).toContain("image input")
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    )
    const userContent = body.messages.at(-1).content
    expect(typeof userContent).toBe("string")
  })

  it("sends image_url parts for vision-capable models", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "seen" } }],
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    await consultOpenAiCompatible({
      ...basePayload,
      model: "gpt-4o",
      referenceImages: [{ mimeType: "image/png", data: "QUJD" }],
    })
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    )
    const userContent = body.messages.at(-1).content as Array<Record<string, unknown>>
    expect(Array.isArray(userContent)).toBe(true)
    expect(userContent.some((part) => part.type === "image_url")).toBe(true)
  })
})

describe("generateImagesOpenAiCompatible", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("collects b64 images and prefers the requested size", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: "QUJD" }, { b64_json: "REVG" }],
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    const results = await generateImagesOpenAiCompatible({
      apiKey: "test-key",
      model: "gpt-image-1",
      baseUrl: "https://api.example.com/v1",
      prompt: "test",
      count: 2,
      size: "1536x1024",
    })
    expect(results).toHaveLength(2)
    expect(results.every((result) => result.ok)).toBe(true)
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    )
    expect(body.size).toBe("1536x1024")
    expect(body.n).toBe(2)
  })

  it("keeps generated-image URL downloads within policy bounds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/images/generations")) {
          return new Response(
            JSON.stringify({
              data: [{ url: "https://cdn.example.com/pic.png" }],
            }),
            { headers: { "Content-Type": "application/json" } }
          )
        }
        if (url === "https://cdn.example.com/pic.png") {
          return new Response(new Uint8Array([9, 9, 9]), {
            headers: { "Content-Type": "image/png" },
          })
        }
        return new Response(null, { status: 404 })
      })
    )
    const results = await generateImagesOpenAiCompatible({
      apiKey: "test-key",
      model: "dall-e-3",
      baseUrl: "https://api.example.com/v1",
      prompt: "test",
      count: 1,
    })
    expect(results).toEqual([
      { ok: true, mimeType: "image/png", data: "CQkJ" },
    ])
  })

  it("maps auth failures to a user-safe error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "bad key" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      )
    )
    await expect(
      generateImagesOpenAiCompatible({
        apiKey: "test-key",
        model: "gpt-image-1",
        baseUrl: "https://api.example.com/v1",
        prompt: "test",
        count: 1,
      })
    ).rejects.toThrow("bad key")
  })
})
