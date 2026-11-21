import type { SkillId } from "@/lib/skills/registry"

/**
 * Provider/model domain types and capability classification. Pure data —
 * shared by the client store, the provider adapters, and the API routes
 * without pulling any state management or UI into server bundles.
 */

export type ProviderKind = "google" | "openai-compatible"

export type ModelCapability = "multimodal" | "image"

export type ProviderModel = {
  id: string
  /** Friendly name as reported by the provider, when available. */
  label?: string
  capability: ModelCapability
}

export const GOOGLE_PROVIDER_LABEL = "Google Gemini"

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  google: "Built-in · Google Gemini",
  "openai-compatible": "OpenAI-compatible",
}

/** Realtime voice, embeddings, and video models fit neither selector role. */
const EXCLUDED_MODEL_PATTERN = /embed|whisper|moderation|tts|veo|live|aqa/i
const OPENAI_IMAGE_PATTERN =
  /image|imagen|dall-e|flux|stable-diffusion|sd[0-9]/i

/**
 * Buckets a discovered model into the two roles Aestry needs. Returns null
 * for models that fit neither role. This is discovery-classification only —
 * a heuristic, never a verified capability guarantee (see capabilities.ts).
 */
export function classifyProviderModel(
  kind: ProviderKind,
  id: string,
  methods?: readonly string[]
): ModelCapability | null {
  if (EXCLUDED_MODEL_PATTERN.test(id)) return null
  if (kind === "google") {
    if (/^imagen/i.test(id) || /image/i.test(id)) return "image"
    if (methods && !methods.includes("generateContent")) {
      if (
        methods.includes("predictLongRunning") ||
        methods.includes("predict")
      ) {
        return "image"
      }
      return null
    }
    return "multimodal"
  }
  if (OPENAI_IMAGE_PATTERN.test(id)) return "image"
  return "multimodal"
}

/**
 * Heuristic capability contract. Conservative by default: an OpenAI-
 * compatible model's features are inferred from its id and are never
 * "verified" — the UI reports them as inferred, not guaranteed.
 */
export type InferredCapabilities = {
  /** The model accepts image input alongside text. */
  vision: boolean
  /** The model reliably returns JSON when instructed to. */
  structuredJson: boolean
  /** The endpoint's image route accepts input images (editing-style). */
  imageEditing: boolean
  /** The model id / endpoint natively streams tokens. */
  streaming: boolean
  verified: boolean
}

const VISION_MODEL_PATTERN =
  /gpt-4o|gpt-4\.1|gpt-5|o[0-9]|gemini|claude|llava|qwen.*vl|glm-4v|pixtral|vision/i
const JSON_MODE_PATTERN = /gpt-4o|gpt-4\.1|gpt-5|o[0-9]|gemini|claude|deepseek/i

export function inferCapabilities(
  kind: ProviderKind,
  modelId: string
): InferredCapabilities {
  if (kind === "google") {
    return {
      vision: true,
      structuredJson: true,
      // Google image models are conditioned by reference images.
      imageEditing: true,
      streaming: true,
      verified: false,
    }
  }
  return {
    vision: VISION_MODEL_PATTERN.test(modelId),
    structuredJson: JSON_MODE_PATTERN.test(modelId),
    imageEditing: false,
    streaming: true,
    verified: false,
  }
}

export type ConsultationTurn = {
  role: "user" | "assistant"
  text: string
}

export type ConsultationPayload = {
  apiKey: string
  model: string
  baseUrl?: string
  systemPrompt: string
  turns: ConsultationTurn[]
  /** Image references attached to the latest user turn. */
  referenceImages?: Array<{ mimeType: string; data: string }>
  /** True when the model was asked for and returned structured JSON. */
  expectStructuredJson: boolean
}

export type ConsultationRawResult = {
  text: string
  structured: boolean
}

export type ImageGenerationPayload = {
  apiKey: string
  model: string
  baseUrl?: string
  prompt: string
  count: number
  referenceImages?: Array<{ mimeType: string; data: string }>
  /** Preferred output geometry, honored when the endpoint supports sizes. */
  size?: string
}

export type GenerationSkillContext = {
  skillId: SkillId
}
