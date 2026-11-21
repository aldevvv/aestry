import { IDBFactory } from "fake-indexeddb"
import "fake-indexeddb/auto"
import { openDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Conversation } from "./types"

/**
 * Persistence regressions run against fake-indexeddb. Each test starts a
 * fresh module instance on a fresh database factory; migration tests seed a
 * real v1 database first so the v2 upgrade path is exercised end to end.
 */

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const now = new Date().toISOString()
  return {
    id: "conv-1",
    title: "Test conversation",
    skillId: "logo",
    phase: "idle",
    messages: [],
    brief: null,
    generations: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function freshPersistence() {
  // Fresh module instance against the CURRENT factory: migration tests seed
  // the factory first and rely on the lazy open happening on first use.
  vi.resetModules()
  return import("./persistence")
}

async function seedV1Database(records: {
  conversations?: Conversation[]
  blobs?: Array<{
    id: string
    conversationId: string
    role: "generated" | "reference"
    mimeType: string
    blob: Blob
    createdAt: number
  }>
}): Promise<void> {
  const db = await openDB("aestry", 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("conversations")) {
        const conversations = database.createObjectStore("conversations", {
          keyPath: "id",
        })
        conversations.createIndex("by-updated", "updatedAt")
      }
      if (!database.objectStoreNames.contains("blobs")) {
        const blobs = database.createObjectStore("blobs", { keyPath: "id" })
        blobs.createIndex("by-conversation", "conversationId")
      }
    },
  })
  for (const conversation of records.conversations ?? []) {
    await db.put("conversations", conversation)
  }
  for (const blob of records.blobs ?? []) {
    await db.put("blobs", blob)
  }
  db.close()
}

function imageBlob(): Blob {
  return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
  vi.resetModules()
})

describe("v1 -> v2 migration", () => {
  it("backfills assets from generated blobs and preserves all data", async () => {
    const conversation = makeConversation({
      generations: {
        gen1: {
          id: "gen1",
          skillId: "logo",
          prompt: "p",
          imageModel: "image-model-1",
          providerLabel: "Google",
          count: 1,
          status: "done",
          items: [
            { id: "item-1", status: "done", imageId: "img-1", mimeType: "image/png" },
          ],
          createdAt: new Date().toISOString(),
        },
      },
    })
    await seedV1Database({
      conversations: [conversation],
      blobs: [
        {
          id: "img-1",
          conversationId: "conv-1",
          role: "generated",
          mimeType: "image/png",
          blob: imageBlob(),
          createdAt: 1_000,
        },
        {
          id: "img-2",
          conversationId: "conv-1",
          role: "reference",
          mimeType: "image/png",
          blob: imageBlob(),
          createdAt: 1_100,
        },
      ],
    })
    const persistence = await freshPersistence()

    const assets = await persistence.listGeneratedAssets()
    expect(assets.length).toBe(1)
    expect(assets[0]).toMatchObject({
      id: "img-1",
      conversationId: "conv-1",
      skillId: "logo",
      imageModel: "image-model-1",
      generationId: "gen1",
      mimeType: "image/png",
    })
    // Conversations and both blobs survive untouched.
    expect((await persistence.loadConversation("conv-1"))?.title).toBe(
      "Test conversation"
    )
    expect(await persistence.loadImageBlob("img-1")).toBeDefined()
    expect(await persistence.loadImageBlob("img-2")).toBeDefined()
  })

  it("does not duplicate assets when the database reopens", async () => {
    await seedV1Database({
      conversations: [makeConversation()],
      blobs: [
        {
          id: "img-1",
          conversationId: "conv-1",
          role: "generated",
          mimeType: "image/png",
          blob: imageBlob(),
          createdAt: 1_000,
        },
      ],
    })
    await freshPersistence()
    // Second module instance against the same (now v2) database.
    const persistence = await freshPersistence()
    const assets = await persistence.listGeneratedAssets()
    expect(assets.length).toBe(1)
  })

  it("backfills unresolvable provenance gracefully", async () => {
    await seedV1Database({
      blobs: [
        {
          id: "img-orphan",
          conversationId: "conv-gone",
          role: "generated",
          mimeType: "image/png",
          blob: imageBlob(),
          createdAt: 2_000,
        },
      ],
    })
    const persistence = await freshPersistence()
    const assets = await persistence.listGeneratedAssets()
    expect(assets.length).toBe(1)
    expect(assets[0]).toMatchObject({
      id: "img-orphan",
      conversationId: "conv-gone",
      skillId: undefined,
      imageModel: undefined,
    })
  })
})

describe("write ordering", () => {
  it("persists concurrent updates in application order", async () => {
    const persistence = await freshPersistence()
    const first = makeConversation({ id: "conv-order", messages: [] })
    const second = makeConversation({
      id: "conv-order",
      messages: [
        {
          id: "m1",
          role: "user",
          content: { type: "text", text: "second write wins" },
          createdAt: new Date().toISOString(),
        },
      ],
    })
    // Fire both without awaiting the first: ordering must hold.
    const write1 = persistence.saveConversation(first)
    const write2 = persistence.saveConversation(second)
    await Promise.all([write1, write2])
    const stored = await persistence.loadConversation("conv-order")
    expect(stored?.messages.length).toBe(1)
    expect(
      stored?.messages[0]?.content.type === "text" &&
        stored?.messages[0]?.content.text
    ).toBe("second write wins")
  })

  it("a failed write does not poison the queue", async () => {
    globalThis.indexedDB = undefined as unknown as IDBFactory
    const broken = await freshPersistence()
    await expect(
      broken.saveConversation(makeConversation({ id: "conv-x" }))
    ).rejects.toThrow("Browser storage is unavailable.")

    globalThis.indexedDB = new IDBFactory()
    vi.resetModules()
    const working = await import("./persistence")
    await working.saveConversation(makeConversation({ id: "conv-y" }))
    expect(await working.loadConversation("conv-y")).toBeDefined()
  })
})

describe("atomic image persistence", () => {
  it("stores the blob and the asset record together", async () => {
    const persistence = await freshPersistence()
    await persistence.saveGeneratedAsset({
      id: "asset-1",
      conversationId: "conv-1",
      generationId: "gen-1",
      skillId: "app-icon",
      imageModel: "model-9",
      mimeType: "image/png",
      blob: imageBlob(),
    })
    const stored = await persistence.loadImageBlob("asset-1")
    expect(stored?.mimeType).toBe("image/png")
    const assets = await persistence.listGeneratedAssets()
    expect(assets[0]).toMatchObject({
      id: "asset-1",
      skillId: "app-icon",
      imageModel: "model-9",
    })
  })

  it("persists conversation records together with their images", async () => {
    const persistence = await freshPersistence()
    await persistence.persistConversation(makeConversation({ id: "conv-atomic" }), [
      {
        id: "ref-1",
        role: "reference",
        mimeType: "image/png",
        blob: imageBlob(),
      },
    ])
    expect(await persistence.loadConversation("conv-atomic")).toBeDefined()
    expect(await persistence.loadImageBlob("ref-1")).toBeDefined()
  })
})

describe("deletion semantics", () => {
  it("deleting a conversation preserves generated assets", async () => {
    const persistence = await freshPersistence()
    await persistence.saveConversation(makeConversation({ id: "conv-del" }))
    await persistence.saveGeneratedAsset({
      id: "asset-keep",
      conversationId: "conv-del",
      generationId: "gen-1",
      skillId: "logo",
      imageModel: "model-9",
      mimeType: "image/png",
      blob: imageBlob(),
    })
    await persistence.saveImageBlob({
      id: "ref-drop",
      conversationId: "conv-del",
      role: "reference",
      mimeType: "image/png",
      blob: imageBlob(),
    })

    await persistence.deleteConversationRecord("conv-del")

    expect(await persistence.loadConversation("conv-del")).toBeUndefined()
    // Reference images belong to the conversation; generated assets do not.
    expect(await persistence.loadImageBlob("ref-drop")).toBeUndefined()
    expect(await persistence.loadImageBlob("asset-keep")).toBeDefined()
    const assets = await persistence.listGeneratedAssets()
    expect(assets.map((asset) => asset.id)).toContain("asset-keep")
  })

  it("deleting an asset removes only that asset", async () => {
    const persistence = await freshPersistence()
    for (const id of ["asset-a", "asset-b"]) {
      await persistence.saveGeneratedAsset({
        id,
        conversationId: "conv-1",
        generationId: "gen-1",
        skillId: "logo",
        imageModel: "model-9",
        mimeType: "image/png",
        blob: imageBlob(),
      })
    }
    await persistence.deleteGeneratedAsset("asset-a")
    const assets = await persistence.listGeneratedAssets()
    expect(assets.map((asset) => asset.id)).toEqual(["asset-b"])
    expect(await persistence.loadImageBlob("asset-a")).toBeUndefined()
    expect(await persistence.loadImageBlob("asset-b")).toBeDefined()
  })
})
