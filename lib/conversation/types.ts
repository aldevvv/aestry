import type { DesignBrief, SkillId } from "@/lib/skills/registry"
import type {
  ConsultationIntent,
  InteractionBlock,
  GenerationPlan,
} from "./schema"

export type { GenerationPlan } from "./schema"

/**
 * Typed conversation content. Messages are not plain strings: the renderer
 * and the orchestrator both branch on content type.
 */
export type ConversationPhase =
  | "idle"
  | "consulting"
  | "awaiting_user"
  | "ready_for_generation"
  | "generating"
  | "reviewing"
  | "error"

export type StoredImageRef = {
  imageId: string
  mimeType: string
}

export type GenerationItem = {
  id: string
  status: "pending" | "done" | "failed"
  imageId?: string
  mimeType?: string
  error?: string
  /** The prompt actually sent for this slot (metadata, no secrets). */
  prompt?: string
  /**
   * Distinguishes "generated and durably stored" from "generated but only
   * viewable this session" — persistence failures must not read as the
   * same durable success as normal images.
   */
  persistence?: "persisted" | "session-only"
}

export type GenerationRecord = {
  id: string
  skillId: SkillId
  /** The compiled prompt used for this generation (metadata only). */
  prompt: string
  imageModel: string
  providerLabel: string
  count: number
  status: "running" | "done"
  items: GenerationItem[]
  /** Reference images used, so retries do not silently drop them. */
  referenceImageIds?: StoredImageRef[]
  warning?: string
  createdAt: string
}

export type MessageContent =
  | { type: "text"; text: string; references?: StoredImageRef[] }
  | {
      type: "assistant-text"
      text: string
      /** The validated interaction plan that produced this reply. */
      plan?: { intent: ConsultationIntent; blocks: InteractionBlock[] }
    }
  | { type: "clarification"; question: string; suggestions?: string[] }
  | { type: "brief"; brief: DesignBrief }
  | { type: "generation"; generationId: string }
  | { type: "error"; error: string; scope: "consultation" | "generation" }
  | { type: "context"; title: string; summary: string }

export type MessageRole = "user" | "assistant"

export type Message = {
  id: string
  role: MessageRole
  content: MessageContent
  createdAt: string
}

/**
 * Title provenance: "fallback" titles may be replaced by an AI-generated
 * or user-set title; "ai" titles may still be replaced by the user;
 * "user" titles are authoritative and never overwritten automatically.
 */
export type ConversationTitleSource = "fallback" | "ai" | "user"

export type Conversation = {
  id: string
  title: string
  titleSource?: ConversationTitleSource
  skillId: SkillId
  phase: ConversationPhase
  messages: Message[]
  brief: DesignBrief | null
  generations: Record<string, GenerationRecord>
  /**
   * Auto-compaction state: the summarized continuation context and the last
   * message it covers. Rendered history is never rewritten.
   */
  compaction?: {
    summary: string
    decisions?: string[]
    upToMessageId: string
    at: string
  }
  /** Prompt tokens measured by the provider after the last consultation. */
  contextTokens?: number
  /** The consultant's proposed multi-image generation strategy, if any. */
  generationPlan?: GenerationPlan
  /** Bounded public project context, when a GitHub reference was resolved. */
  projectContext?: {
    url: string
    name: string
    summary: string
  }
  createdAt: string
  updatedAt: string
}

export const SESSION_TITLE_FALLBACK_MAX = 48

export function conversationTitleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim()
  if (!compact) return "New conversation"
  return compact.length > SESSION_TITLE_FALLBACK_MAX
    ? `${compact.slice(0, SESSION_TITLE_FALLBACK_MAX)}…`
    : compact
}
