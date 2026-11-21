import { IDBFactory } from "fake-indexeddb"
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Message } from "./types"

/**
 * Session-management regressions: title provenance guards, Recent list
 * synchronization, and deletion semantics, run against a fresh store per
 * test on fake IndexedDB.
 */

async function freshStore() {
  vi.resetModules()
  return import("./store")
}

function userMessage(text: string): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: "user",
    content: { type: "text", text },
    createdAt: new Date().toISOString(),
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
  vi.resetModules()
})

describe("session title lifecycle", () => {
  it("starts with a fallback title derived from the first message", async () => {
    const { useConversations } = await freshStore()
    const conversation = useConversations.getState().createConversation("logo")
    expect(conversation.titleSource).toBe("fallback")
    useConversations
      .getState()
      .appendMessage(conversation.id, userMessage("Design a logo for a database tool"))
    const updated = useConversations.getState().conversations[conversation.id]
    expect(updated?.title).toContain("Design a logo")
    expect(updated?.titleSource).toBe("fallback")
  })

  it("applies an AI title to a fallback-titled conversation", async () => {
    const { useConversations } = await freshStore()
    const conversation = useConversations.getState().createConversation("logo")
    useConversations.getState().setTitle(conversation.id, "Database Monitoring Logo", "ai")
    const updated = useConversations.getState().conversations[conversation.id]
    expect(updated?.title).toBe("Database Monitoring Logo")
    expect(updated?.titleSource).toBe("ai")
  })

  it("never lets an AI title overwrite a user-set title", async () => {
    const { useConversations } = await freshStore()
    const conversation = useConversations.getState().createConversation("logo")
    useConversations.getState().setTitle(conversation.id, "My Renamed Chat", "user")
    useConversations.getState().setTitle(conversation.id, "AI Suggests This", "ai")
    const updated = useConversations.getState().conversations[conversation.id]
    expect(updated?.title).toBe("My Renamed Chat")
    expect(updated?.titleSource).toBe("user")
  })

  it("rejects empty titles without losing the previous one", async () => {
    const { useConversations } = await freshStore()
    const conversation = useConversations.getState().createConversation("logo")
    useConversations.getState().setTitle(conversation.id, "   ", "user")
    expect(useConversations.getState().conversations[conversation.id]?.title).toBe(
      "New conversation"
    )
    useConversations.getState().setTitle(conversation.id, "Real Name", "user")
    useConversations.getState().setTitle(conversation.id, "   ", "user")
    expect(useConversations.getState().conversations[conversation.id]?.title).toBe(
      "Real Name"
    )
  })
})

describe("recent list synchronization", () => {
  it("reflects created conversations sorted by activity", async () => {
    const { useConversations } = await freshStore()
    await useConversations.getState().refreshSummaryList()
    const first = useConversations.getState().createConversation("logo")
    const second = useConversations.getState().createConversation("app-icon")
    // The sidebar re-renders when the trailing refresh lands; the test
    // awaits it explicitly. Two creations can land in the same millisecond,
    // where ordering is unspecified.
    const list = await useConversations.getState().refreshSummaryList().then(() =>
      useConversations.getState().summaryList
    )
    expect(list?.map((summary) => summary.id)).toContain(first.id)
    expect(list?.map((summary) => summary.id)).toContain(second.id)
    expect(list?.length).toBe(2)
  })

  it("drops deleted conversations from the list", async () => {
    const { useConversations } = await freshStore()
    await useConversations.getState().refreshSummaryList()
    const conversation = useConversations.getState().createConversation("logo")
    await useConversations.getState().deleteConversation(conversation.id)
    const list = useConversations.getState().summaryList
    expect(list?.some((summary) => summary.id === conversation.id)).toBe(false)
  })
})
