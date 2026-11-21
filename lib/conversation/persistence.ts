import { openDB, type DBSchema, type IDBPDatabase } from "idb"

import type { Conversation } from "./types"

/**
 * Local-first conversation persistence. API keys never enter this database:
 * credentials live only in the provider localStorage store, and conversation
 * records contain no credential fields.
 */

interface AestryDatabase extends DBSchema {
  conversations: {
    key: string
    value: Conversation
    indexes: { "by-updated": string }
  }
  blobs: {
    key: string
    value: {
      id: string
      conversationId: string
      role: "generated" | "reference"
      mimeType: string
      blob: Blob
      createdAt: number
    }
    indexes: { "by-conversation": string }
  }
}

const DB_NAME = "aestry"
const DB_VERSION = 1

let databasePromise: Promise<IDBPDatabase<AestryDatabase>> | null = null

function getDatabase(): Promise<IDBPDatabase<AestryDatabase>> | null {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return null
  }
  if (!databasePromise) {
    databasePromise = openDB<AestryDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("conversations")) {
          const conversations = db.createObjectStore("conversations", {
            keyPath: "id",
          })
          conversations.createIndex("by-updated", "updatedAt")
        }
        if (!db.objectStoreNames.contains("blobs")) {
          const blobs = db.createObjectStore("blobs", { keyPath: "id" })
          blobs.createIndex("by-conversation", "conversationId")
        }
      },
    })
  }
  return databasePromise
}

export class StorageUnavailableError extends Error {}

async function withDatabase<T>(
  operation: (db: IDBPDatabase<AestryDatabase>) => Promise<T>
): Promise<T> {
  const dbPromise = getDatabase()
  if (!dbPromise) {
    throw new StorageUnavailableError("Browser storage is unavailable.")
  }
  const db = await dbPromise
  return operation(db)
}

export async function saveConversation(
  conversation: Conversation
): Promise<void> {
  return withDatabase(async (db) => {
    await db.put("conversations", structuredClone(conversation))
  })
}

export async function loadConversation(
  id: string
): Promise<Conversation | undefined> {
  return withDatabase(async (db) => db.get("conversations", id))
}

export async function listConversations(): Promise<Conversation[]> {
  return withDatabase(async (db) => {
    const all = await db.getAllFromIndex("conversations", "by-updated")
    return all.reverse()
  })
}

export async function deleteConversationRecord(id: string): Promise<void> {
  return withDatabase(async (db) => {
    await db.delete("conversations", id)
    const blobs = await db.getAllFromIndex("blobs", "by-conversation", id)
    const tx = db.transaction("blobs", "readwrite")
    const store = tx.objectStore("blobs")
    await Promise.all(
      blobs.map((blob) => store.delete(blob.id)).concat([tx.done])
    )
  })
}

export async function saveImageBlob(record: {
  id: string
  conversationId: string
  role: "generated" | "reference"
  mimeType: string
  blob: Blob
}): Promise<void> {
  return withDatabase(async (db) => {
    await db.put("blobs", { ...record, createdAt: Date.now() })
  })
}

export async function loadImageBlob(id: string): Promise<
  | {
      mimeType: string
      blob: Blob
    }
  | undefined
> {
  return withDatabase(async (db) => {
    const record = await db.get("blobs", id)
    if (!record) return undefined
    return { mimeType: record.mimeType, blob: record.blob }
  })
}

/**
 * Persists a conversation together with any pending image blobs. Images
 * referenced by generation records must have their blobs stored before the
 * conversation record lands; otherwise restore would show missing images.
 */
export async function persistConversation(
  conversation: Conversation,
  blobs: Array<{
    id: string
    role: "generated" | "reference"
    mimeType: string
    blob: Blob
  }> = []
): Promise<void> {
  const db = await withDatabase(async (database) => database)
  for (const blob of blobs) {
    await db.put("blobs", {
      ...blob,
      conversationId: conversation.id,
      createdAt: Date.now(),
    })
  }
  await db.put("conversations", structuredClone(conversation))
}
