import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@google/genai"

import { classifyProviderModel, inferCapabilities } from "./models"
import {
  __resetGoogleProviderCachesForTests,
  assertModelAvailable,
  consultGoogle,
  generateImagesGoogle,
  listGoogleModels,
  streamGoogleConsult,
} from "./google"

/**
 * The SDK client is mocked at the module boundary: these tests pin the
 * adapter's contract (classification, thought filtering, server-side
 * message extraction, empty-response mapping, per-item image results)
 * without network access and without live credentials.
 */

const sdkState = vi.hoisted(() => ({
  models: {} as {
    list?: (params?: unknown) => Promise<unknown>
    get?: (params: unknown) => Promise<unknown>
    generateContent?: (params: unknown) => Promise<unknown>
    generateContentStream?: (params: unknown) => Promise<unknown>
    countTokens?: (params: unknown) => Promise<unknown>
  },
}))

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    get models() {
      return sdkState.models
    }
  },
  ApiError: class extends Error {
    status: number
    constructor(info: { message: string; status: number }) {
      super(info.message)
      this.status = info.status
    }
  },
}))

beforeEach(() => {
  vi.stubEnv("GOOGLE_API_KEY", "test-key-1234")
  __resetGoogleProviderCachesForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function geminiChunk(parts: unknown[], extra: Record<string, unknown> = {}) {
  return {
    candidates: [{ content: { role: "model", parts }, ...extra }],
  }
}

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

describe("listGoogleModels", () => {
  it("classifies SDK models and caches the listing", async () => {
    let listCalls = 0
    sdkState.models = {
      list: vi.fn(async () => {
        listCalls += 1
        return (async function* () {
          yield {
            name: "models/gemini-test-flash",
            displayName: "Gemini Test Flash",
            inputTokenLimit: 1_048_576,
            supportedActions: ["generateContent"],
          }
          yield {
            name: "models/gemini-test-image",
            displayName: "Gemini Test Image",
            supportedActions: ["generateContent"],
          }
          yield { name: "models/gemini-test-embedding", supportedActions: ["embedContent"] }
        })()
      }),
    }
    const models = await listGoogleModels("gemini")
    expect(models.map((model) => model.id)).toEqual([
      "gemini-test-flash",
      "gemini-test-image",
    ])
    expect(
      models.find((model) => model.id === "gemini-test-flash")?.contextWindow
    ).toBe(1_048_576)
    // Second call serves the cache without hitting discovery again.
    await listGoogleModels("gemini")
    expect(listCalls).toBe(1)
  })

  it("surfaces the upstream error message to the user", async () => {
    sdkState.models = {
      list: vi.fn(async () => {
        throw new ApiError({
          message: "API key not valid. Please pass a valid API key.",
          status: 401,
        })
      }),
    }
    await expect(listGoogleModels("gemini")).rejects.toThrow(
      /API key not valid\. Please pass a valid API key\./
    )
  })

  it("falls back to a category message when upstream text is oversized", async () => {
    sdkState.models = {
      list: vi.fn(async () => {
        throw new ApiError({ message: "x".repeat(500), status: 401 })
      }),
    }
    await expect(listGoogleModels("gemini")).rejects.toThrow(
      "Google rejected the server credentials."
    )
  })

  it("scrubs credential-shaped substrings from upstream messages", async () => {
    sdkState.models = {
      list: vi.fn(async () => {
        throw new ApiError({
          message:
            "Request failed for key AIzaSyD-1234567890abcdefGHIJKLmnopqrstu and token ya29.aBcDEF-1234567890abcdefGHIJKL",
          status: 400,
        })
      }),
    }
    let message = ""
    try {
      await listGoogleModels("gemini")
    } catch (caught) {
      message = (caught as Error).message
    }
    expect(message).toContain("[redacted]")
    expect(message).not.toContain("AIzaSyD")
    expect(message).not.toContain("ya29.aBcDEF")
  })

  it("classifies rate limits as retryable", async () => {
    sdkState.models = {
      list: vi.fn(async () => {
        throw new ApiError({ message: "Resource exhausted.", status: 429 })
      }),
    }
    await expect(listGoogleModels("gemini")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    })
  })
})

describe("consultGoogle", () => {
  it("extracts answer text and skips thought parts", async () => {
    sdkState.models = {
      generateContent: vi.fn(async () =>
        geminiChunk([
          { text: "internal reasoning", thought: true },
          { text: '{"message": "Hello.", "phase": "clarifying"}' },
        ])
      ),
    }
    const reply = await consultGoogle({
      providerId: "gemini",
      model: "gemini-test-flash",
      systemPrompt: "system",
      turns: [{ role: "user", text: "hi" }],
    })
    expect(reply.text).toBe('{"message": "Hello.", "phase": "clarifying"}')
    expect(reply.usage).toBeUndefined()
  })

  it("surfaces empty responses with their finish reason", async () => {
    sdkState.models = {
      generateContent: vi.fn(async () => geminiChunk([], { finishReason: "STOP" })),
    }
    await expect(
      consultGoogle({
        providerId: "gemini",
        model: "gemini-test-flash",
        systemPrompt: "system",
        turns: [{ role: "user", text: "hi" }],
      })
    ).rejects.toMatchObject({
      status: 502,
      message: "The model returned no text (finishReason: STOP).",
    })
  })

  it("reports safety-blocked prompts distinctly", async () => {
    sdkState.models = {
      generateContent: vi.fn(async () => ({
        promptFeedback: { blockReason: "SAFETY" },
        candidates: [],
      })),
    }
    await expect(
      consultGoogle({
        providerId: "gemini",
        model: "gemini-test-flash",
        systemPrompt: "system",
        turns: [{ role: "user", text: "hi" }],
      })
    ).rejects.toMatchObject({ status: 422 })
  })

  it("attaches reference images to the latest user turn", async () => {
    let captured: unknown
    sdkState.models = {
      generateContent: vi.fn(async (params: unknown) => {
        captured = params
        return geminiChunk([{ text: '{"message": "ok"}' }])
      }),
    }
    await consultGoogle({
      providerId: "gemini",
      model: "gemini-test-flash",
      systemPrompt: "system",
      turns: [
        { role: "user", text: "first" },
        { role: "assistant", text: "reply" },
        { role: "user", text: "second" },
      ],
      referenceImages: [{ mimeType: "image/png", data: "QUJD" }],
    })
    const contents = (
      captured as { contents: Array<{ role: string; parts: unknown[] }> }
    ).contents
    const lastUser = contents[contents.length - 1]
    expect(lastUser.role).toBe("user")
    expect(
      lastUser.parts.some((part) => "inlineData" in (part as Record<string, unknown>))
    ).toBe(true)
  })
})

describe("streamGoogleConsult", () => {
  it("emits server-extracted message deltas, never raw JSON", async () => {
    sdkState.models = {
      generateContentStream: vi.fn(async () =>
        (async function* () {
          yield geminiChunk([{ text: '{"message": "Hel' }])
          yield geminiChunk([{ text: 'lo there", "phase"' }])
          yield geminiChunk([{ text: ': "clarifying"}' }])
        })()
      ),
    }
    const deltas: string[] = []
    const reply = await streamGoogleConsult(
      {
        providerId: "gemini",
        model: "gemini-test-flash",
        systemPrompt: "system",
        turns: [{ role: "user", text: "hi" }],
      },
      (delta) => deltas.push(delta)
    )
    expect(deltas.join("")).toBe("Hello there")
    expect(deltas.every((delta) => !delta.includes('"'))).toBe(true)
    expect(reply.text).toBe('{"message": "Hello there", "phase": "clarifying"}')
  })

  it("never forwards thought parts to deltas", async () => {
    sdkState.models = {
      generateContentStream: vi.fn(async () =>
        (async function* () {
          yield geminiChunk([{ text: "thinking…", thought: true }])
          yield geminiChunk([{ text: '{"message": "Answer"}' }])
        })()
      ),
    }
    const deltas: string[] = []
    await streamGoogleConsult(
      {
        providerId: "gemini",
        model: "gemini-test-flash",
        systemPrompt: "system",
        turns: [{ role: "user", text: "hi" }],
      },
      (delta) => deltas.push(delta)
    )
    expect(deltas.join("")).toBe("Answer")
  })

  it("collects usage metadata and finish reasons from the stream", async () => {
    sdkState.models = {
      generateContentStream: vi.fn(async () =>
        (async function* () {
          yield geminiChunk([{ text: '{"message": "Hi"}' }])
          yield {
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: {
              promptTokenCount: 120,
              candidatesTokenCount: 8,
              totalTokenCount: 128,
            },
          }
        })()
      ),
    }
    const reply = await streamGoogleConsult({
      providerId: "gemini",
      model: "gemini-test-flash",
      systemPrompt: "system",
      turns: [{ role: "user", text: "hi" }],
    })
    expect(reply.finishReason).toBe("STOP")
    expect(reply.usage).toMatchObject({
      promptTokens: 120,
      outputTokens: 8,
      totalTokens: 128,
    })
  })
})

describe("generateImagesGoogle", () => {
  const basePayload = {
    providerId: "gemini" as const,
    model: "gemini-test-image",
    prompts: ["test prompt", "test prompt"],
    count: 2,
  }

  it("collects one image per successful call", async () => {
    sdkState.models = {
      generateContent: vi.fn(async () =>
        geminiChunk([
          { text: "Here is your icon." },
          { inlineData: { mimeType: "image/png", data: "QUJD" } },
        ])
      ),
    }
    const results = await generateImagesGoogle(basePayload)
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.mimeType).toBe("image/png")
    }
  })

  it("reports per-call failures without hiding successes", async () => {
    let call = 0
    sdkState.models = {
      generateContent: vi.fn(async () => {
        call += 1
        if (call === 1) {
          return geminiChunk([{ inlineData: { mimeType: "image/png", data: "QUJD" } }])
        }
        throw new ApiError({
          message: "Quota exceeded for images per day.",
          status: 429,
        })
      }),
    }
    const results = await generateImagesGoogle(basePayload)
    expect(results).toHaveLength(2)
    expect(results[0].ok).toBe(true)
    expect(results[1]).toEqual({
      ok: false,
      error:
        "Rate limited by Google — try again shortly. Provider said: Quota exceeded for images per day.",
    })
  })

  it("surfaces model refusals as errors, not successes", async () => {
    sdkState.models = {
      generateContent: vi.fn(async () =>
        geminiChunk([{ text: "I cannot create that content." }])
      ),
    }
    const results = await generateImagesGoogle({ ...basePayload, count: 1 })
    expect(results[0]).toEqual({
      ok: false,
      error: "I cannot create that content.",
    })
  })
})

describe("assertModelAvailable", () => {
  it("allows operator-pinned models with matching authoritative capability", async () => {
    vi.stubEnv("AESTRY_GEMINI_CHAT_MODEL", "pinned-model")
    sdkState.models = {
      get: vi.fn(async () => ({
        name: "models/pinned-model",
        supportedActions: ["generateContent"],
      })),
    }
    await expect(
      assertModelAvailable("gemini", "pinned-model", "chat")
    ).resolves.toBeUndefined()
  })

  it("rejects pinned models whose capability mismatches the role", async () => {
    vi.stubEnv("AESTRY_GEMINI_CHAT_MODEL", "pinned-image-model")
    sdkState.models = {
      get: vi.fn(async () => ({
        name: "models/pinned-image-model",
        supportedActions: ["generateContent"],
      })),
    }
    // classifyProviderModel treats a generateContent-capable unknown id as
    // multimodal, so pin a genuinely image-classified id instead.
    sdkState.models = {
      get: vi.fn(async () => ({
        name: "models/pinned-image-model",
        supportedActions: ["predictLongRunning"],
      })),
    }
    await expect(
      assertModelAvailable("gemini", "pinned-image-model", "chat")
    ).rejects.toMatchObject({ status: 400, code: "MODEL_NOT_FOUND" })
  })

  it("rejects pinned models that do not exist (typoed env override)", async () => {
    vi.stubEnv("AESTRY_GEMINI_CHAT_MODEL", "typo-model")
    sdkState.models = {
      get: vi.fn(async () => {
        throw new ApiError({ message: "not found", status: 404 })
      }),
    }
    await expect(
      assertModelAvailable("gemini", "typo-model", "chat")
    ).rejects.toMatchObject({ status: 400, code: "MODEL_NOT_FOUND" })
  })

  it("allows pinned models when metadata is merely unavailable", async () => {
    vi.stubEnv("AESTRY_GEMINI_CHAT_MODEL", "pinned-model")
    sdkState.models = {
      get: vi.fn(async () => {
        throw new Error("network unreachable")
      }),
    }
    await expect(
      assertModelAvailable("gemini", "pinned-model", "chat")
    ).resolves.toBeUndefined()
  })

  it("rejects models the provider does not expose", async () => {
    sdkState.models = {
      list: vi.fn(async () =>
        (async function* () {
          yield {
            name: "models/gemini-test-flash",
            supportedActions: ["generateContent"],
          }
        })()
      ),
    }
    await expect(
      assertModelAvailable("gemini", "not-a-real-model", "chat")
    ).rejects.toMatchObject({ status: 400 })
  })

  it("rejects role-incompatible models from the discovery list", async () => {
    sdkState.models = {
      list: vi.fn(async () =>
        (async function* () {
          yield {
            name: "models/gemini-test-flash",
            supportedActions: ["generateContent"],
          }
        })()
      ),
    }
    await expect(
      assertModelAvailable("gemini", "gemini-test-flash", "image")
    ).rejects.toMatchObject({ status: 400, code: "MODEL_NOT_FOUND" })
  })
})
