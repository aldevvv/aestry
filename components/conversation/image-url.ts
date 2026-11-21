"use client"

import * as React from "react"

import { loadImageBlob } from "@/lib/conversation/persistence"

/**
 * Session-level object-URL cache for stored image blobs, exposed through
 * useSyncExternalStore so consumers re-render when a URL becomes available.
 * URLs live for the page session; blobs are owned by IndexedDB.
 */
const urlCache = new Map<string, string | null>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function getSnapshot(imageId: string): string | null {
  return urlCache.get(imageId) ?? null
}

function getServerSnapshot(): string | null {
  return null
}

/** Registers an already-created object URL (e.g. right after generation). */
export function cacheImageUrl(imageId: string, url: string): void {
  const previous = urlCache.get(imageId)
  if (previous) {
    // A re-registered id must not leak its previous URL.
    URL.revokeObjectURL(previous)
  }
  urlCache.set(imageId, url)
  notify()
}

/** Drops the cached URL for an id, revoking the object URL if one exists. */
export function revokeImageUrl(imageId: string): void {
  const existing = urlCache.get(imageId)
  if (existing) {
    URL.revokeObjectURL(existing)
    urlCache.delete(imageId)
    notify()
  }
}

function ensureLoaded(imageId: string): void {
  if (urlCache.has(imageId)) return
  urlCache.set(imageId, null) // mark as loading
  void loadImageBlob(imageId)
    .then((record) => {
      if (!record) return
      const objectUrl = URL.createObjectURL(record.blob)
      urlCache.set(imageId, objectUrl)
      notify()
    })
    .catch(() => {
      urlCache.set(imageId, null)
      notify()
    })
}

export function useImageUrl(imageId: string | undefined): string | null {
  const key = imageId ?? ""
  React.useEffect(() => {
    if (imageId) ensureLoaded(imageId)
  }, [imageId])
  return React.useSyncExternalStore(
    subscribe,
    () => getSnapshot(key),
    getServerSnapshot
  )
}
