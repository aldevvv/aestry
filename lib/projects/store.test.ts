import { IDBFactory } from "fake-indexeddb"
import "fake-indexeddb/auto"
import { openDB } from "idb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Conversation } from "@/lib/conversation/types"
import type { DesignProject } from "./types"

/**
 * Project persistence regressions: v2 -> v3 migration is non-destructive,
 * project CRUD works, deletion unassigns conversations instead of
 * destroying them, and project context stays scoped to its own project.
 */

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
  vi.resetModules()
})

async function freshPersistence() {
  vi.resetModules()
  return import("@/lib/conversation/persistence")
}

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

function makeProject(overrides: Partial<DesignProject> = {}): DesignProject {
  const now = new Date().toISOString()
  return {
    id: "proj-1",
    name: "Aestry rebrand",
    instructions: "Keep everything monochrome.",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("v2 -> v3 migration", () => {
  it("creates the projects store without touching existing data", async () => {
    // Seed a v2 database (conversations + blobs + assets, no projects).
    const db = await openDB("aestry", 2, {
      upgrade(database) {
        const conversations = database.createObjectStore("conversations", {
          keyPath: "id",
        })
        conversations.createIndex("by-updated", "updatedAt")
        const blobs = database.createObjectStore("blobs", { keyPath: "id" })
        blobs.createIndex("by-conversation", "conversationId")
        const assets = database.createObjectStore("assets", { keyPath: "id" })
        assets.createIndex("by-created", "createdAt")
      },
    })
    const conversation = makeConversation()
    await db.put("conversations", conversation)
    db.close()

    const persistence = await freshPersistence()
    // Opening upgraded the database; existing records survive.
    expect(await persistence.loadConversation("conv-1")).toBeDefined()
    const projects = await persistence.listProjects()
    expect(projects).toEqual([])
  })
})

describe("project CRUD and deletion semantics", () => {
  it("saves, lists, and loads projects", async () => {
    const persistence = await freshPersistence()
    const project = makeProject()
    await persistence.saveProject(project)
    const projects = await persistence.listProjects()
    expect(projects.map((entry) => entry.id)).toEqual(["proj-1"])
    expect((await persistence.loadProject("proj-1"))?.name).toBe(
      "Aestry rebrand"
    )
  })

  it("deleting a project unassigns conversations and preserves messages", async () => {
    const persistence = await freshPersistence()
    const project = makeProject()
    await persistence.saveProject(project)
    const conversation = makeConversation({
      id: "conv-assigned",
      projectId: "proj-1",
      messages: [
        {
          id: "m1",
          role: "user",
          content: { type: "text", text: "precious history" },
          createdAt: new Date().toISOString(),
        },
      ],
    })
    await persistence.saveConversation(conversation)

    await persistence.deleteProjectRecord("proj-1")

    expect(await persistence.loadProject("proj-1")).toBeUndefined()
    // The conversation returns to the unassigned collection, intact.
    const unassigned = await persistence.loadConversation("conv-assigned")
    expect(unassigned?.projectId).toBeUndefined()
    expect(unassigned?.messages).toHaveLength(1)
  })

  it("lists project conversations scoped to their own project", async () => {
    const persistence = await freshPersistence()
    await persistence.saveProject(makeProject({ id: "proj-a" }))
    await persistence.saveProject(makeProject({ id: "proj-b" }))
    await persistence.saveConversation(
      makeConversation({ id: "conv-a", projectId: "proj-a" })
    )
    await persistence.saveConversation(
      makeConversation({ id: "conv-b", projectId: "proj-b" })
    )
    await persistence.saveConversation(makeConversation({ id: "conv-free" }))

    const scoped = await persistence.listProjectConversations("proj-a")
    expect(scoped.map((conversation) => conversation.id)).toEqual(["conv-a"])
    // Context isolation is structural: another project cannot see them.
    const other = await persistence.listProjectConversations("proj-b")
    expect(other.map((conversation) => conversation.id)).toEqual(["conv-b"])
  })
})

describe("project store operations", () => {
  it("creates projects and moves conversations between scopes", async () => {
    vi.resetModules()
    const { useProjects } = await import("./store")
    const { useConversations } = await import("@/lib/conversation/store")
    await useProjects.getState().refresh()

    const project = await useProjects.getState().createProject({
      name: "  Brand refresh  ",
      instructions: "  Prefer serif wordmarks.  ",
    })
    expect(project.name).toBe("Brand refresh")
    expect(project.instructions).toBe("Prefer serif wordmarks.")

    const conversation = useConversations
      .getState()
      .createConversation("logo")
    expect(conversation.projectId).toBeUndefined()

    await useProjects.getState().moveConversation(conversation.id, project.id)
    const summaries = useConversations.getState().summaryList
    const moved = summaries?.find((summary) => summary.id === conversation.id)
    expect(moved?.projectId).toBe(project.id)

    // Moving back restores unassigned scope without losing data.
    await useProjects.getState().moveConversation(conversation.id, null)
    const restored = useConversations.getState().summaryList?.find(
      (summary) => summary.id === conversation.id
    )
    expect(restored?.projectId).toBeUndefined()
    expect(
      useConversations.getState().conversations[conversation.id]?.projectId
    ).toBeUndefined()
  })
})
