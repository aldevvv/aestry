"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { toast } from "sonner"
import {
  DownloadIcon,
  ImagePlusIcon,
  MessageSquareIcon,
  Trash2Icon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useImageUrl, revokeImageUrl } from "@/components/conversation/image-url"
import { useMounted } from "@/hooks/use-mounted"
import {
  deleteGeneratedAsset,
  listGeneratedAssets,
  loadConversation,
  type GeneratedAsset,
} from "@/lib/conversation/persistence"
import { getSkill, isSkillId, type SkillId } from "@/lib/skills/registry"

/**
 * The History gallery: every successfully generated image across all
 * conversations, persisted independently of chat lifetime. Assets remain
 * here even when their originating conversation is deleted.
 */

type AssetFilter = "all" | SkillId

const FILTERS: Array<{ id: AssetFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "app-icon", label: "App Icons" },
  { id: "logo", label: "Logos" },
  { id: "og-image", label: "OG Images" },
]

function aspectOf(asset: GeneratedAsset): string {
  return asset.skillId && isSkillId(asset.skillId)
    ? getSkill(asset.skillId).previewAspect
    : "square"
}

function aspectClassName(aspect: string): string {
  return aspect === "landscape" ? "aspect-[1200/630]" : "aspect-square"
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function skillLabel(asset: GeneratedAsset): string {
  return asset.skillId && isSkillId(asset.skillId)
    ? getSkill(asset.skillId).name
    : "Generated asset"
}

function downloadName(asset: GeneratedAsset): string {
  return `aestry-${asset.id}.${asset.mimeType.split("/")[1] ?? "png"}`
}

function AssetTile({
  asset,
  onPreview,
  onDelete,
}: {
  asset: GeneratedAsset
  onPreview: () => void
  onDelete: () => void
}) {
  const url = useImageUrl(asset.id)

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${skillLabel(asset)} from ${formatDate(asset.createdAt)}`}
        className={`block w-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring ${aspectClassName(aspectOf(asset))}`}
      >
        {url ? (
          <Image
            src={url}
            alt={skillLabel(asset)}
            width={1024}
            height={aspectOf(asset) === "landscape" ? 540 : 1024}
            unoptimized
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            Unavailable
          </span>
        )}
      </button>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <span className="truncate text-xs text-muted-foreground">
          {formatDate(asset.createdAt)}
        </span>
        <div className="flex gap-0.5">
          <a
            href={url ?? "#"}
            download={downloadName(asset)}
            aria-label={`Download ${skillLabel(asset)}`}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={(event) => {
              if (!url) event.preventDefault()
            }}
          >
            <DownloadIcon className="size-3.5" />
          </a>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete ${skillLabel(asset)}`}
                >
                  <Trash2Icon />
                </Button>
              }
            />
            <DeleteAssetDialog onDelete={onDelete} label={skillLabel(asset)} />
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}

function DeleteAssetDialog({
  onDelete,
  label,
}: {
  onDelete: () => void
  label: string
}) {
  return (
    <AlertDialogContent size="sm">
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
        <AlertDialogDescription>
          The generated {label.toLowerCase()} is removed from this browser.
          Other assets are not affected. This cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          size="sm"
          onClick={onDelete}
        >
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

function AssetPreviewDialog({
  asset,
  onClose,
  onDelete,
}: {
  asset: GeneratedAsset
  onClose: () => void
  onDelete: () => void
}) {
  const url = useImageUrl(asset.id)
  const [origin, setOrigin] = React.useState<{
    exists: boolean
    title: string | null
  } | null>(
    asset.conversationId ? { exists: false, title: null } : null
  )

  React.useEffect(() => {
    if (!asset.conversationId) return
    let alive = true
    void loadConversation(asset.conversationId)
      .then((conversation) => {
        if (!alive) return
        setOrigin({
          exists: Boolean(conversation),
          title: conversation?.title ?? null,
        })
      })
      .catch(() => {
        if (alive) setOrigin({ exists: false, title: null })
      })
    return () => {
      alive = false
    }
  }, [asset.conversationId])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{skillLabel(asset)}</DialogTitle>
          <DialogDescription>
            Generated {formatDate(asset.createdAt)}
            {asset.imageModel ? ` · ${asset.imageModel}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div
          className={`overflow-hidden rounded-xl border border-border bg-muted/40 ${aspectClassName(aspectOf(asset))}`}
        >
          {url ? (
            <Image
              src={url}
              alt={skillLabel(asset)}
              width={1200}
              height={800}
              unoptimized
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              This image is no longer available in storage.
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{skillLabel(asset)}</Badge>
            {asset.conversationId ? (
              origin?.exists ? (
                <Button
                  variant="ghost"
                  size="xs"
                  render={<Link href={`/chat/${asset.conversationId}`} />}
                  nativeButton={false}
                >
                  <MessageSquareIcon />
                  <span className="max-w-48 truncate">
                    {origin.title ?? "Open conversation"}
                  </span>
                </Button>
              ) : (
                <span>Original conversation deleted</span>
              )
            ) : null}
          </div>
          <div className="flex gap-2">
            {url ? (
              <Button
                variant="outline"
                size="sm"
                render={
                  <a href={url} download={downloadName(asset)} />
                }
                nativeButton={false}
              >
                <DownloadIcon />
                Download
              </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="destructive" size="sm">
                    <Trash2Icon />
                    Delete
                  </Button>
                }
              />
              <DeleteAssetDialog onDelete={onDelete} label={skillLabel(asset)} />
            </AlertDialog>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AssetGallery() {
  const mounted = useMounted()
  const [assets, setAssets] = React.useState<GeneratedAsset[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState<AssetFilter>("all")
  const [previewing, setPreviewing] = React.useState<GeneratedAsset | null>(null)

  const refresh = React.useCallback(() => {
    void listGeneratedAssets()
      .then((records) => {
        setAssets(records)
        setLoadError(null)
      })
      .catch(() => {
        setAssets([])
        setLoadError("Browser storage is unavailable — the gallery cannot be read.")
      })
  }, [])

  const handleDelete = async (assetId: string) => {
    try {
      await deleteGeneratedAsset(assetId)
      revokeImageUrl(assetId)
      setAssets((previous) =>
        previous ? previous.filter((asset) => asset.id !== assetId) : previous
      )
      setPreviewing((current) => (current?.id === assetId ? null : current))
      toast.success("Asset deleted")
    } catch {
      toast.error("The asset could not be deleted from storage.")
    }
  }

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const visible = (assets ?? []).filter((asset) =>
    filter === "all" ? true : asset.skillId === filter
  )

  if (!mounted) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="aspect-square animate-pulse rounded-xl border border-border bg-muted/50"
          />
        ))}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        {loadError}
      </div>
    )
  }

  if (assets !== null && assets.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
          <ImagePlusIcon />
        </span>
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-foreground">No generated images yet</p>
          <p className="text-sm/relaxed text-muted-foreground">
            Your generated icons, logos, and OG images will appear here.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 self-start"
            render={<Link href="/" />}
            nativeButton={false}
          >
            Start creating
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Filter assets"
      >
        {FILTERS.map((entry) => (
          <Button
            key={entry.id}
            variant={filter === entry.id ? "secondary" : "ghost"}
            size="sm"
            className={filter === entry.id ? undefined : "text-muted-foreground"}
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No {FILTERS.find((entry) => entry.id === filter)?.label.toLowerCase()} in
          the gallery yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((asset) => (
            <AssetTile
              key={asset.id}
              asset={asset}
              onPreview={() => setPreviewing(asset)}
              onDelete={() => void handleDelete(asset.id)}
            />
          ))}
        </div>
      )}
      {previewing ? (
        <AssetPreviewDialog
          asset={previewing}
          onClose={() => setPreviewing(null)}
          onDelete={() => void handleDelete(previewing.id)}
        />
      ) : null}
    </div>
  )
}

export { AssetGallery }
