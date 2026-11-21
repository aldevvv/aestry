import { openDB, type DBSchema, type IDBPDatabase } from "idb"

import type { SkillId } from "@/lib/skills/registry"
import type { Conversation } from "./types"

/**
 * Local-first conversation and asset persistence.
 *
 * Reliability contract:
 * - Writes for the same conversation are serialized (a per-conversation
 *   promise chain), so rapid-fire updates can never land out of order and
 *   a stale snapshot cannot overwrite a newer one.
 * - Image binaries and their metadata are written in one transaction, so a
 *   crash never leaves a record pointing at a missing blob.
 * - Generated images live in the independent `assets` store and survive
 *   conversation deletion. Reference images stay owned by the conversation.
 * - Schema upgrades are versioned and non-destructive; existing records are
 *   backfilled, never cleared.
 */

interface AestryDatabase extends DBSchema {
  conversations: {
    key: string
    value: Conversation
    indexes: { "by-updated": string }
  }
  blobs: {
    key: string
    value: BlobRecord
    indexes: { "by-conversation": string }
  }
  assets: {
    key: string
    value: GeneratedAsset
    indexes: { "by-created": string }
  }
}

export type BlobRecord = {
  id: string
  conversationId: string
  role: "generated" | "reference"
  mimeType: string
  blob: Blob
  createdAt: number
}

/**
 * A successfully generated image as an independent, long-lived record.
 * `conversationId` is provenance, not ownership: it may reference a
 * conversation that no longer exists.
 */
export type GeneratedAsset = {
  id: string
  conversationId: string | null
  generationId?: string
  skillId?: SkillId
  imageModel?: string
  mimeType: string
  createdAt: number
}

const DB_NAME = "aestry"
const DB_VERSION = 2

let databasePromise: Promise<IDBPDatabase<AestryDatabase>> | null = null

function getDatabase(): Promise<IDBPDatabase<AestryDatabase>> | null {
  // IndexedDB exists in browsers and workers alike; only its absence
  // (server rendering, tests without a fake) makes storage unavailable.
  if (typeof indexedDB === "undefined") {
    return null
  }
  if (!databasePromise) {
    databasePromise = openDB<AestryDatabase>(DB_NAME, DB_VERSION, {
      async upgrade(db, _oldVersion, _newVersion, transaction) {
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
        if (!db.objectStoreNames.contains("assets")) {
          const assets = db.createObjectStore("assets", { keyPath: "id" })
          assets.createIndex("by-created", "createdAt")
        }
        // Backfill (idempotent): only when coming from a pre-assets schema.
        if (db.objectStoreNames.contains("blobs") && _oldVersion < 2) {
          const blobStore = transaction.objectStore("blobs")
          const assetStore = transaction.objectStore("assets")
          const conversationStore = transaction.objectStore("conversations")
          const existingBlobs = await blobStore.getAll()
          for (const record of existingBlobs) {
            if (!record || record.role !== "generated") continue
            if ((await assetStore.getKey(record.id)) !== undefined) continue
            let skillId: SkillId | undefined
            let imageModel: string | undefined
            let generationId: string | undefined
            const conversation = (await conversationStore.get(
              record.conversationId
            )) as Conversation | undefined
            if (conversation) {
              skillId = conversation.skillId
              for (const generation of Object.values(conversation.generations)) {
                if (
                  generation.items.some(
                    (item) => item.status === "done" && item.imageId === record.id
                  )
                ) {
                  generationId = generation.id
                  imageModel = generation.imageModel
                  break
                }
              }
            }
            await assetStore.put({
              id: record.id,
              conversationId: record.conversationId,
              generationId,
              skillId,
              imageModel,
              mimeType: record.mimeType,
              createdAt: record.createdAt,
            })
          }
        }
      },
      blocked() {
        // Another tab holds an older connection open. The promise stays
        // pending until it closes; Aestry keeps working from memory.
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

/**
 * Serialized writes. Each conversation's operations chain onto the previous
 * one, so concurrent store updates persist in application order and a slow
 * write can never be overtaken by a stale one.
 */
const writeQueues = new Map<string, Promise<unknown>>()

function enqueueWrite<T>(
  conversationId: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = writeQueues.get(conversationId) ?? Promise.resolve()
  const next = previous.then(operation, operation)
  // The queue only tracks settlement; callers receive `next`'s result and
  // failures do not poison subsequent writes.
  writeQueues.set(
    conversationId,
    next.catch(() => undefined)
  )
  return next
}

export async function saveConversation(
  conversation: Conversation
): Promise<void> {
  return enqueueWrite(conversation.id, () =>
    withDatabase(async (db) => {
      await db.put("conversations", structuredClone(conversation))
    })
  )
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

/**
 * Deletes a conversation and its reference images. Completed generated
 * images are deliberately preserved: they are independent assets and
 * remain reachable in the History gallery.
 */
export async function deleteConversationRecord(id: string): Promise<void> {
  return enqueueWrite(id, () =>
    withDatabase(async (db) => {
      const tx = db.transaction(["conversations", "blobs"] as const, "readwrite")
      const blobStore = tx.objectStore("blobs")
      const records = await blobStore.index("by-conversation").getAll(id)
      // Only reference images are conversation-owned; generated assets stay.
      const referenceIds = records
        .filter((record) => record.role === "reference")
        .map((record) => record.id)
      await Promise.all([
        tx.objectStore("conversations").delete(id),
        ...referenceIds.map((blobId) => blobStore.delete(blobId)),
        tx.done,
      ])
    })
  )

}

export async function saveImageBlob(record: {
  id: string
  conversationId: string
  role: "generated" | "reference"
  mimeType: string
  blob: Blob
}): Promise<void> {
  return enqueueWrite(record.conversationId, () =>
    withDatabase(async (db) => {
      await db.put("blobs", { ...record, createdAt: Date.now() })
    })
  )
}

/**
 * Persists a generated image atomically: the binary, the conversation-owned
 * blob record, and the independent asset record land in one transaction.
 * Callers must await this before reporting the image as stored.
 */
export async function saveGeneratedAsset(record: {
  id: string
  conversationId: string
  generationId: string
  skillId: SkillId
  imageModel: string
  mimeType: string
  blob: Blob
}): Promise<void> {
  return enqueueWrite(record.conversationId, () =>
    withDatabase(async (db) => {
      const createdAt = Date.now()
      const tx = db.transaction(["blobs", "assets"] as const, "readwrite")
      await tx.objectStore("blobs").put({
        id: record.id,
        conversationId: record.conversationId,
        role: "generated",
        mimeType: record.mimeType,
        blob: record.blob,
        createdAt,
      })
      await tx.objectStore("assets").put({
        id: record.id,
        conversationId: record.conversationId,
        generationId: record.generationId,
        skillId: record.skillId,
        imageModel: record.imageModel,
        mimeType: record.mimeType,
        createdAt,
      })
      await tx.done
    })
  )
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

/** Generated assets for the History gallery, newest first. */
export async function listGeneratedAssets(): Promise<GeneratedAsset[]> {
  return withDatabase(async (db) => {
    const all = await db.getAllFromIndex("assets", "by-created")
    return all.reverse()
  })
}

export async function deleteGeneratedAsset(id: string): Promise<void> {
  return withDatabase(async (db) => {
    const tx = db.transaction(["blobs", "assets"] as const, "readwrite")
    await tx.objectStore("assets").delete(id)
    await tx.objectStore("blobs").delete(id)
    await tx.done
  })
}

/**
 * Persists a conversation together with any pending image blobs in ONE
 * transaction: the record never lands without its images. Images
 * referenced by generation records must be stored atomically with the
 * conversation; otherwise restore would show missing images.
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
  return enqueueWrite(conversation.id, () =>
    withDatabase(async (db) => {
      const createdAt = Date.now()
      const tx = db.transaction(["blobs", "conversations"] as const, "readwrite")
      for (const blob of blobs) {
        await tx.objectStore("blobs").put({
          id: blob.id,
          conversationId: conversation.id,
          role: blob.role,
          mimeType: blob.mimeType,
          blob: blob.blob,
          createdAt,
        })
      }
      await tx.objectStore("conversations").put(structuredClone(conversation))
      await tx.done
    })
  )
}
