import { create } from "zustand"

import {
  deleteProjectRecord,
  flushPendingWrites,
  listProjects,
  loadConversation,
  saveConversation,
  saveProject,
} from "@/lib/conversation/persistence"
import { useConversations } from "@/lib/conversation/store"
import {
  sanitizeProjectName,
  sanitizeProjectText,
  type DesignProject,
} from "./types"

/**
 * Projects store: local-first project management. Deletion never cascades —
 * conversations return to the global unassigned collection with messages
 * and generated assets fully intact.
 */

type ProjectsState = {
  /** All projects, most recently updated first. */
  projects: DesignProject[] | null
  /** Set when the list cannot be read from storage. */
  listError: string | null
  refresh: () => Promise<void>
  createProject: (input: {
    name: string
    description?: string
    instructions?: string
  }) => Promise<DesignProject>
  renameProject: (
    id: string,
    input: { name: string; description?: string; instructions?: string }
  ) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  /** Assign or unassign a conversation; never touches messages or assets. */
  moveConversation: (
    conversationId: string,
    projectId: string | null
  ) => Promise<void>
}

let refreshInFlight: Promise<void> | null = null

export const useProjects = create<ProjectsState>()((set, get) => ({
  projects: null,
  listError: null,

  refresh: async () => {
    if (refreshInFlight) return refreshInFlight
    refreshInFlight = (async () => {
      try {
        const records = await listProjects()
        set({ projects: records, listError: null })
      } catch {
        set({
          projects: [],
          listError: "Browser storage is unavailable — projects cannot be read.",
        })
      } finally {
        refreshInFlight = null
      }
    })()
    return refreshInFlight
  },

  createProject: async (input) => {
    const now = new Date().toISOString()
    const project: DesignProject = {
      id: crypto.randomUUID(),
      name: sanitizeProjectName(input.name) ?? "Untitled project",
      description: sanitizeProjectText(
        input.description,
        300
      ),
      instructions: sanitizeProjectText(input.instructions, 2_000),
      createdAt: now,
      updatedAt: now,
    }
    await saveProject(project)
    await get().refresh()
    return project
  },

  renameProject: async (id, input) => {
    const previous = get().projects?.find((project) => project.id === id)
    const now = new Date().toISOString()
    const updated: DesignProject = {
      id,
      name: sanitizeProjectName(input.name) ?? previous?.name ?? "Untitled project",
      description: sanitizeProjectText(input.description, 300),
      instructions: sanitizeProjectText(input.instructions, 2_000),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    await saveProject(updated)
    await get().refresh()
  },

  deleteProject: async (id) => {
    // Conversations return to unassigned; generated assets are untouched.
    await deleteProjectRecord(id)
    // The in-memory conversation cache may hold now-unassigned records.
    for (const [conversationId, conversation] of Object.entries(
      useConversations.getState().conversations
    )) {
      if (conversation.projectId === id) {
        useConversations.setState((state) => ({
          conversations: {
            ...state.conversations,
            [conversationId]: { ...conversation, projectId: undefined },
          },
        }))
      }
    }
    await useConversations.getState().refreshSummaryList()
    await get().refresh()
  },

  moveConversation: async (conversationId, projectId) => {
    // Load the full record (it may not be in memory), reassign, persist.
    // Flush first: a freshly created conversation's write may still be
    // queued behind the per-conversation write chain.
    await flushPendingWrites()
    const stored = await loadConversation(conversationId)
    if (!stored) {
      throw new Error("That conversation could not be found in storage.")
    }
    await saveConversation({ ...stored, projectId: projectId ?? undefined })
    const inMemory = useConversations.getState().conversations[conversationId]
    if (inMemory) {
      useConversations.setState((state) => ({
        conversations: {
          ...state.conversations,
          [conversationId]: { ...inMemory, projectId: projectId ?? undefined },
        },
      }))
    }
    await useConversations.getState().refreshSummaryList()
  },
}))
