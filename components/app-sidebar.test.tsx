// @vitest-environment happy-dom
import { IDBFactory } from "fake-indexeddb"
import "fake-indexeddb/auto"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RenameConversationDialog, RecentRowMenu } from "./app-sidebar"
import { useConversations } from "@/lib/conversation/store"
import { useProjects } from "@/lib/projects/store"
import type { DesignProject } from "@/lib/projects/types"

/**
 * Interaction regression coverage for the conversation Rename and Delete
 * dialogs (M44). Rendered in happy-dom — no browser, no network; storage
 * runs on fake IndexedDB. Base UI navigation and sidebar contexts are
 * stubbed at the module boundary.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
}))

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({
    state: "expanded",
    isMobile: false,
    setOpenMobile: vi.fn(),
  }),
}))

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  useConversations.setState({
    conversations: {},
    activeId: null,
    summaryList: [],
    storageWarning: null,
  })
  useProjects.setState({ projects: [] })
})

afterEach(() => {
  cleanup()
  vi.doUnmock("@/lib/conversation/persistence")
  vi.resetModules()
})

async function seedConversation(title: string) {
  const conversation = useConversations.getState().createConversation("logo")
  useConversations.getState().setTitle(conversation.id, title, "user")
  return conversation
}

describe("RenameConversationDialog", () => {
  it("saves a new title on Enter and closes", async () => {
    const conversation = await seedConversation("Old title")
    const onClose = vi.fn()
    render(
      <RenameConversationDialog
        conversationId={conversation.id}
        currentTitle="Old title"
        onClose={onClose}
      />
    )
    const input = screen.getByLabelText("Conversation title")
    fireEvent.change(input, { target: { value: "Renamed conversation" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(
      useConversations.getState().conversations[conversation.id]?.title
    ).toBe("Renamed conversation")
    expect(
      useConversations.getState().conversations[conversation.id]?.titleSource
    ).toBe("user")
    expect(onClose).toHaveBeenCalled()
  })

  it("cancels on Escape without changing the title", () => {
    const conversation = seedConversationSync()
    const onClose = vi.fn()
    render(
      <RenameConversationDialog
        conversationId={conversation.id}
        currentTitle="Keep me"
        onClose={onClose}
      />
    )
    const input = screen.getByLabelText("Conversation title")
    fireEvent.change(input, { target: { value: "Should not save" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
    expect(
      useConversations.getState().conversations[conversation.id]?.title
    ).toBe("Keep me")
  })

  it("rejects whitespace-only titles", () => {
    const conversation = seedConversationSync()
    const onClose = vi.fn()
    render(
      <RenameConversationDialog
        conversationId={conversation.id}
        currentTitle="Current"
        onClose={onClose}
      />
    )
    const input = screen.getByLabelText("Conversation title")
    fireEvent.change(input, { target: { value: "    " } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onClose).not.toHaveBeenCalled()
    // The seeded title survives: whitespace-only input changes nothing.
    expect(
      useConversations.getState().conversations[conversation.id]?.title
    ).toBe("Keep me")
  })

  it("enforces the 60-character title limit", () => {
    const conversation = seedConversationSync()
    render(
      <RenameConversationDialog
        conversationId={conversation.id}
        currentTitle="Start"
        onClose={vi.fn()}
      />
    )
    const input = screen.getByLabelText("Conversation title") as HTMLInputElement
    expect(input.maxLength).toBe(60)
  })
})

function seedConversationSync() {
  // createConversation is synchronous over the in-memory store; persistence
  // is fire-and-forget on fake IndexedDB.
  const conversation = useConversations.getState().createConversation("logo")
  useConversations.getState().setTitle(conversation.id, "Keep me", "user")
  return conversation
}

describe("RecentRowMenu delete flow", () => {
  const projects: DesignProject[] = []

  it("opens the confirmation from the menu and deletes on confirm", async () => {
    const conversation = await seedConversation("Deletable chat")
    render(
      <RecentRowMenu
        conversationId={conversation.id}
        title="Deletable chat"
        projects={projects}
        onMoveToProject={vi.fn()}
        onRename={vi.fn()}
      />
    )

    // Open the menu via keyboard (Base UI trigger), then choose Delete —
    // the confirmation is controlled and rendered outside the menu, so it
    // stays open.
    const trigger = screen.getByLabelText("Conversation actions for Deletable chat")
    fireEvent.pointerDown(trigger)
    fireEvent.pointerUp(trigger)
    fireEvent.click(trigger)
    const deleteItem = await screen.findByText("Delete")
    fireEvent.pointerUp(deleteItem)
    fireEvent.click(deleteItem)
    fireEvent.keyDown(deleteItem, { key: "Enter" })

    await screen.findByRole("alertdialog")
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => {
      expect(
        useConversations.getState().conversations[conversation.id]
      ).toBeUndefined()
    })
  })

  it("keeps the conversation when deletion persistence fails", async () => {
    const real = await vi.importActual<typeof import("@/lib/conversation/persistence")>(
      "@/lib/conversation/persistence"
    )
    vi.doMock("@/lib/conversation/persistence", () => ({
      ...real,
      deleteConversationRecord: async () => {
        throw new Error("simulated storage failure")
      },
    }))
    // Re-register the store module so it binds to the mocked persistence.
    vi.resetModules()
    const { RecentRowMenu: FreshMenu } = await import("./app-sidebar")
    const { useConversations: freshStore } = await import("@/lib/conversation/store")
    const conversation = freshStore.getState().createConversation("logo")
    freshStore.getState().setTitle(conversation.id, "Sticky chat", "user")

    render(
      <FreshMenu
        conversationId={conversation.id}
        title="Sticky chat"
        projects={projects}
        onMoveToProject={vi.fn()}
        onRename={vi.fn()}
      />
    )
    const stickyTrigger = screen.getByLabelText("Conversation actions for Sticky chat")
    fireEvent.pointerDown(stickyTrigger)
    fireEvent.pointerUp(stickyTrigger)
    fireEvent.click(stickyTrigger)
    const deleteItem = await screen.findByText("Delete")
    fireEvent.pointerUp(deleteItem)
    fireEvent.click(deleteItem)
    fireEvent.keyDown(deleteItem, { key: "Enter" })

    await screen.findByRole("alertdialog")
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => {
      // Deletion failed: the conversation must remain everywhere.
      expect(
        useConversations.getState().conversations[conversation.id] ??
          freshStore.getState().conversations[conversation.id]
      ).toBeDefined()
    })
    vi.doUnmock("@/lib/conversation/persistence")
  })
})
