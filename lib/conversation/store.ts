import { create } from "zustand"

import {
  deleteConversationRecord,
  flushPendingWrites,
  listConversations,
  loadConversation,
  saveConversation,
} from "./persistence"
import {
  conversationTitleFromPrompt,
  type Conversation,
  type ConversationPhase,
  type ConversationTitleSource,
  type GenerationItem,
  type GenerationRecord,
  type Message,
  type MessageContent,
} from "./types"
import type { SkillId } from "@/lib/skills/registry"
import type { DesignBrief } from "@/lib/skills/registry"

/** Compact sidebar entry; the full record loads on open. */
export type ConversationSummary = {
  id: string
  title: string
  titleSource?: ConversationTitleSource
  updatedAt: string
}

type ConversationsState = {
  conversations: Record<string, Conversation>
  activeId: string | null
  hydrated: boolean
  /** Conversation ids that were requested but not found in storage. */
  notFoundIds: string[]
  /** Set when a persistence write fails; data stays in memory. */
  storageWarning: string | null
  /** Sidebar Recent entries, newest activity first. */
  summaryList: ConversationSummary[] | null
  createConversation: (skillId: SkillId) => Conversation
  setActive: (id: string | null) => void
  restoreFromStorage: (id: string) => Promise<Conversation | undefined>
  refreshSummaryList: () => Promise<void>
  forgetConversation: (id: string) => void
  deleteConversation: (id: string) => Promise<void>
  setTitle: (
    conversationId: string,
    title: string,
    source: ConversationTitleSource
  ) => void
  appendMessage: (conversationId: string, message: Message) => void
  updateMessage: (
    conversationId: string,
    messageId: string,
    content: MessageContent
  ) => void
  setPhase: (conversationId: string, phase: ConversationPhase) => void
  setBrief: (conversationId: string, brief: DesignBrief) => void
  setGenerationPlan: (
    conversationId: string,
    plan: import("./types").GenerationPlan | null
  ) => void
  setSkill: (conversationId: string, skillId: SkillId) => void
  setProjectContext: (
    conversationId: string,
    context: NonNullable<Conversation["projectContext"]>
  ) => void
  setContextTokens: (conversationId: string, tokens: number | null) => void
  setCompaction: (
    conversationId: string,
    compaction: NonNullable<Conversation["compaction"]>
  ) => void
  addGeneration: (
    conversationId: string,
    record: GenerationRecord
  ) => void
  updateGeneration: (
    conversationId: string,
    generationId: string,
    patch: Partial<Omit<GenerationRecord, "items">>
  ) => void
  updateGenerationItem: (
    conversationId: string,
    generationId: string,
    itemId: string,
    patch: Partial<GenerationItem>
  ) => void
}

export const useConversations = create<ConversationsState>()((set, get) => {
  function persistConversationRecord(conversation: Conversation) {
    void saveConversation(conversation).catch(() => {
      useConversations.setState({
        storageWarning:
          "Browser storage failed — this conversation is only in memory for now.",
      })
    })
  }

  function refreshSummaries(): void {
    void get()
      .refreshSummaryList()
      .catch(() => undefined)
  }

  let refreshInFlight: Promise<void> | null = null
  let refreshQueued = false

  function updateConversation(
    conversationId: string,
    updater: (conversation: Conversation) => Conversation
  ): Conversation | undefined {
    const existing = get().conversations[conversationId]
    if (!existing) return undefined
    const updated: Conversation = {
      ...updater(existing),
      updatedAt: new Date().toISOString(),
    }
    set((state) => ({
      conversations: {
        ...state.conversations,
        [conversationId]: updated,
      },
    }))
    persistConversationRecord(updated)
    return updated
  }

  return {
    conversations: {},
    activeId: null,
    hydrated: false,
    notFoundIds: [],
    storageWarning: null,
    summaryList: null,

    refreshSummaryList: async () => {
      // One refresh at a time, with a trailing re-run: a refresh triggered
      // while another is in flight must not serve a snapshot older than
      // the writes that prompted it.
      if (refreshInFlight) {
        refreshQueued = true
        return refreshInFlight
      }
      refreshInFlight = (async () => {
        try {
          for (;;) {
            refreshQueued = false
            await flushPendingWrites()
            const records = await listConversations()
            set({
              summaryList: records.map((record) => ({
                id: record.id,
                title: record.title,
                titleSource: record.titleSource,
                updatedAt: record.updatedAt,
              })),
            })
            if (!refreshQueued) break
          }
        } catch {
          set({ summaryList: [] })
        } finally {
          refreshInFlight = null
        }
      })()
      return refreshInFlight
    },

    createConversation: (skillId) => {
      const now = new Date().toISOString()
      const conversation: Conversation = {
        id: crypto.randomUUID(),
        title: "New conversation",
        titleSource: "fallback",
        skillId,
        phase: "idle",
        messages: [],
        brief: null,
        generations: {},
        createdAt: now,
        updatedAt: now,
      }
      set((state) => ({
        conversations: {
          ...state.conversations,
          [conversation.id]: conversation,
        },
        activeId: conversation.id,
      }))
      persistConversationRecord(conversation)
      refreshSummaries()
      return conversation
    },

    setActive: (id) => set({ activeId: id }),

    setTitle: (conversationId, title, source) => {
      const existing = get().conversations[conversationId]
      // A user-set title is authoritative: automatic titles never overwrite it.
      if (existing && existing.titleSource === "user" && source !== "user") {
        return
      }
      const trimmed = title.trim()
      if (!trimmed) return
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        title: trimmed,
        titleSource: source,
      }))
      refreshSummaries()
    },

    restoreFromStorage: async (id) => {
      const existing = get().conversations[id]
      if (existing) return existing
      try {
        const restored = await loadConversation(id)
        if (!restored) {
          set((state) => ({
            notFoundIds: state.notFoundIds.includes(id)
              ? state.notFoundIds
              : [...state.notFoundIds, id],
          }))
          return undefined
        }
        // An interrupted run must never look successful: normalize any
        // generation that was persisted while still in flight.
        const normalized: Conversation = {
          ...restored,
          generations: Object.fromEntries(
            Object.entries(restored.generations).map(([generationId, generation]) => [
              generationId,
              generation.status === "running"
                ? {
                    ...generation,
                    status: "done" as const,
                    items: generation.items.map((item) =>
                      item.status === "pending"
                        ? {
                            ...item,
                            status: "failed" as const,
                            error: "Generation was interrupted before it finished.",
                          }
                        : item
                    ),
                  }
                : generation,
            ])
          ),
        }
        set((state) => ({
          conversations: { ...state.conversations, [id]: normalized },
          activeId: id,
        }))
        return normalized
      } catch {
        return undefined
      }
    },

    forgetConversation: (id) =>
      set((state) => {
        const next = { ...state.conversations }
        delete next[id]
        return {
          conversations: next,
          activeId: state.activeId === id ? null : state.activeId,
        }
      }),

    deleteConversation: async (id) => {
      // Persistence first, memory second: deletion success must mean the
      // persistent operation actually succeeded. On failure the conversation
      // stays in memory and Recent — no ghosts that reappear after refresh.
      try {
        await deleteConversationRecord(id)
      } catch (error) {
        useConversations.setState({
          storageWarning:
            "The conversation could not be deleted from storage. It remains in your list — try again.",
        })
        throw error instanceof Error
          ? error
          : new Error("The conversation could not be deleted from storage.")
      }
      get().forgetConversation(id)
      void get().refreshSummaryList()
    },

    appendMessage: (conversationId, message) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        title:
          (conversation.titleSource ?? "fallback") === "fallback" &&
          message.role === "user" &&
          message.content.type === "text"
            ? conversationTitleFromPrompt(message.content.text)
            : conversation.title,
        messages: [...conversation.messages, message],
      }))
      refreshSummaries()
    },

    updateMessage: (conversationId, messageId, content) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === messageId ? { ...message, content } : message
        ),
      }))
    },

    setPhase: (conversationId, phase) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        phase,
      }))
    },

    setBrief: (conversationId, brief) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        brief,
      }))
    },

    setGenerationPlan: (conversationId, plan) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        generationPlan: plan ?? undefined,
      }))
    },

    setSkill: (conversationId, skillId) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        skillId,
      }))
    },

    setProjectContext: (conversationId, context) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        projectContext: context,
      }))
    },

    setContextTokens: (conversationId, tokens) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        contextTokens: tokens ?? undefined,
      }))
    },

    setCompaction: (conversationId, compaction) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        compaction,
      }))
    },

    addGeneration: (conversationId, record) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        generations: {
          ...conversation.generations,
          [record.id]: record,
        },
      }))
    },

    updateGeneration: (conversationId, generationId, patch) => {
      updateConversation(conversationId, (conversation) => {
        const generation = conversation.generations[generationId]
        if (!generation) return conversation
        return {
          ...conversation,
          generations: {
            ...conversation.generations,
            [generationId]: { ...generation, ...patch },
          },
        }
      })
    },

    updateGenerationItem: (conversationId, generationId, itemId, patch) => {
      updateConversation(conversationId, (conversation) => {
        const generation = conversation.generations[generationId]
        if (!generation) return conversation
        return {
          ...conversation,
          generations: {
            ...conversation.generations,
            [generationId]: {
              ...generation,
              items: generation.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item
              ),
            },
          },
        }
      })
    },
  }
})

// Convenience selectors.
export function selectActiveConversation(
  state: ConversationsState
): Conversation | null {
  return state.activeId ? state.conversations[state.activeId] ?? null : null
}
