import { create } from "zustand"

/**
 * Live consultation transport state, keyed by conversation and held at
 * module level on purpose: the first message navigates from the Dashboard
 * to /chat/[id], which remounts the workspace component — local component
 * state would be orphaned mid-stream, hiding the thinking orbs and live
 * text for that first turn. This store survives the remount.
 */

type StreamState = {
  /** Conversation ids with an in-flight consultation. */
  busyIds: Record<string, true>
  /** Live streamed assistant text per conversation. */
  streaming: Record<string, string>
  setBusy: (conversationId: string, busy: boolean) => void
  appendDelta: (conversationId: string, delta: string) => void
  clearStreaming: (conversationId: string) => void
}

export const useStreamState = create<StreamState>()((set) => ({
  busyIds: {},
  streaming: {},
  setBusy: (conversationId, busy) =>
    set((state) => {
      const busyIds = { ...state.busyIds }
      if (busy) {
        busyIds[conversationId] = true
      } else {
        delete busyIds[conversationId]
      }
      return { busyIds }
    }),
  appendDelta: (conversationId, delta) =>
    set((state) => ({
      streaming: {
        ...state.streaming,
        [conversationId]: (state.streaming[conversationId] ?? "") + delta,
      },
    })),
  clearStreaming: (conversationId) =>
    set((state) => {
      const streaming = { ...state.streaming }
      delete streaming[conversationId]
      return { streaming }
    }),
}))
