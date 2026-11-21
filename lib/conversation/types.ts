import type { DesignBrief, SkillId } from "@/lib/skills/registry"

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
  warning?: string
  createdAt: string
}

export type MessageContent =
  | { type: "text"; text: string; references?: StoredImageRef[] }
  | { type: "assistant-text"; text: string }
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

export type Conversation = {
  id: string
  title: string
  skillId: SkillId
  quantity: 1 | 2 | 4
  phase: ConversationPhase
  messages: Message[]
  brief: DesignBrief | null
  generations: Record<string, GenerationRecord>
  /** Bounded public project context, when a GitHub reference was resolved. */
  projectContext?: {
    url: string
    name: string
    summary: string
  }
  createdAt: string
  updatedAt: string
}

export function conversationTitleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim()
  if (!compact) return "New conversation"
  return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact
}
