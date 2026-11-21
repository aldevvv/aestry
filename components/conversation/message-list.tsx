"use client"

import * as React from "react"
import Image from "next/image"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  ImagePlusIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ActivityOrb, ThinkingOrbIndicator } from "@/components/thinking-indicator"
import { useImageUrl } from "@/components/conversation/image-url"
import { Markdown } from "@/components/conversation/markdown"
import { InteractionBlocks } from "@/components/conversation/interaction-blocks"
import { getSkill, type SkillId } from "@/lib/skills/registry"
import type {
  GenerationRecord,
  Message,
} from "@/lib/conversation/types"

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
}

function aspectClassName(aspect: string): string {
  return aspect === "landscape" ? "aspect-[1200/630]" : "aspect-square"
}

// 50 lines at text-sm/relaxed (14px × 1.625).
const USER_BUBBLE_MAX_LINES = 50
const USER_BUBBLE_COLLAPSED_HEIGHT = Math.round(
  USER_BUBBLE_MAX_LINES * 1.625 * 14
)

/**
 * User message bubble. Hugs the length of the message; content beyond
 * roughly 50 rendered lines collapses behind a "Show all" chevron so one
 * long paste cannot dominate the whole thread.
 */
function UserTextBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false)
  const [overflowing, setOverflowing] = React.useState(false)
  const innerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    // ResizeObserver fires on observe (covering the initial measurement)
    // and its callback runs async, keeping the effect lint-clean.
    const observer = new ResizeObserver(() => {
      setOverflowing(inner.scrollHeight > USER_BUBBLE_COLLAPSED_HEIGHT)
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [text])

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="w-fit max-w-full rounded-lg bg-muted px-3 py-2.5 text-sm text-foreground [&_p]:my-1.5">
        <div
          ref={innerRef}
          className="break-words"
          style={
            expanded
              ? undefined
              : { maxHeight: USER_BUBBLE_COLLAPSED_HEIGHT, overflow: "hidden" }
          }
        >
          <Markdown content={text} />
        </div>
      </div>
      {overflowing ? (
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          aria-expanded={expanded}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? (
            <ChevronUpIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
          {expanded ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  )
}

function ReferenceThumb({ imageId }: { imageId: string }) {
  const url = useImageUrl(imageId)
  if (!url) {
    return (
      <div className="size-16 shrink-0 animate-pulse rounded-lg border border-border bg-muted" />
    )
  }
  return (
    <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-border">
      <Image
        src={url}
        alt="Reference image"
        width={64}
        height={64}
        unoptimized
        className="size-16 object-cover"
      />
    </div>
  )
}

function GenerationGallery({
  record,
  onRetryItem,
  onUseAsReference,
}: {
  record: GenerationRecord
  onRetryItem?: (itemId: string) => void
  onUseAsReference?: (imageId: string, mimeType: string) => void
}) {
  const skill = getSkill(record.skillId)
  const failed = record.items.filter((item) => item.status === "failed")

  return (
    <div className="flex flex-col gap-2">
      {record.status === "running" ? (
        <ThinkingOrbIndicator activity="generate" />
      ) : null}
      <div
        className={
          record.items.filter((item) => item.status !== "failed").length > 2
            ? "grid grid-cols-2 gap-2 sm:grid-cols-4"
            : record.items.filter((item) => item.status !== "failed").length > 1
              ? "grid grid-cols-2 gap-2"
              : "grid grid-cols-1 gap-2"
        }
      >
        {record.items.map((item) => (
          <GeneratedImageTile
            key={item.id}
            item={item}
            aspect={skill.previewAspect}
            onRetry={
              onRetryItem && item.status === "failed"
                ? () => onRetryItem(item.id)
                : undefined
            }
            onUseAsReference={
              onUseAsReference && item.status === "done" && item.imageId
                ? () => onUseAsReference(item.imageId as string, item.mimeType as string)
                : undefined
            }
          />
        ))}
      </div>
      {record.warning ? (
        <p
          className="flex items-start gap-2 text-xs text-warning"
          role="note"
        >
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{record.warning}</span>
        </p>
      ) : null}
      {failed.length > 0 && record.items.length > failed.length ? (
        <p className="text-xs text-muted-foreground">
          {record.items.length - failed.length} of {record.items.length}{" "}
          images generated. Failures can be retried individually.
        </p>
      ) : null}
    </div>
  )
}

function GeneratedImageTile({
  item,
  aspect,
  onRetry,
  onUseAsReference,
}: {
  item: GenerationRecord["items"][number]
  aspect: string
  onRetry?: () => void
  onUseAsReference?: () => void
}) {
  const url = useImageUrl(item.imageId)

  if (item.status === "pending") {
    return (
      <div
        className={`flex ${aspectClassName(aspect)} items-center justify-center rounded-xl border border-border bg-card`}
      >
        <ActivityOrb activity="generate" size={32} />
      </div>
    )
  }
  if (item.status === "failed" || !url) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
        <div className="flex items-start gap-2">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="text-sm/relaxed">{item.error ?? "Generation failed."}</p>
        </div>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/40"
            onClick={onRetry}
          >
            <RefreshCwIcon />
            Retry
          </Button>
        ) : null}
      </div>
    )
  }
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-border bg-card ${aspectClassName(aspect)}`}
    >
      <Image
        src={url}
        alt="Generated asset"
        width={1024}
        height={aspect === "landscape" ? 540 : 1024}
        unoptimized
        className={`w-full object-contain ${aspectClassName(aspect)}`}
      />
      {item.persistence === "session-only" ? (
        <span
          className="absolute top-2 left-2 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border"
          title="This image could not be saved to browser storage and will be lost when this page closes."
        >
          Session only
        </span>
      ) : null}
      <div className="absolute right-2 bottom-2 flex gap-1">
        {onUseAsReference ? (
          <button
            type="button"
            onClick={onUseAsReference}
            aria-label="Use as refinement reference"
            className="flex size-7 items-center justify-center rounded-lg bg-background/90 text-foreground ring-1 ring-border transition-colors hover:bg-foreground hover:text-background"
          >
            <ImagePlusIcon className="size-3.5" />
          </button>
        ) : null}
        <a
          href={url}
          download={`aestry-${item.id}.${EXTENSIONS[item.mimeType ?? ""] ?? "png"}`}
          aria-label="Download image"
          className="flex size-7 items-center justify-center rounded-lg bg-background/90 text-foreground ring-1 ring-border transition-colors hover:bg-foreground hover:text-background"
        >
          <DownloadIcon className="size-3.5" />
        </a>
      </div>
    </div>
  )
}

export function MessageListItem({
  message,
  generations,
  skillId,
  generatableBriefId,
  onGenerate,
  onRetryItem,
  onClarificationSuggestion,
  onUseAsReference,
}: {
  message: Message
  generations: Record<string, GenerationRecord>
  skillId: SkillId
  generatableBriefId?: string
  onGenerate?: (count: 1 | 2 | 4) => void
  onRetryItem?: (generationId: string, itemId: string) => void
  onClarificationSuggestion?: (suggestion: string) => void
  onUseAsReference?: (imageId: string, mimeType: string) => void
}) {
  const content = message.content
  const canGenerate =
    content.type === "brief" && message.id === generatableBriefId

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-2">
        {content.type === "text" ? (
          <>
            {content.references && content.references.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {content.references.map((reference) => (
                  <ReferenceThumb key={reference.imageId} imageId={reference.imageId} />
                ))}
              </div>
            ) : null}
            <UserTextBubble text={content.text} />
          </>
        ) : null}
      </div>
    )
  }

  if (content.type === "assistant-text") {
    return (
      <div className="flex flex-col gap-2.5">
        <Markdown content={content.text} />
        {content.plan?.blocks?.length ? (
          <InteractionBlocks
            blocks={content.plan.blocks}
            onSelect={
              onClarificationSuggestion
                ? (choice) => onClarificationSuggestion(choice)
                : undefined
            }
          />
        ) : null}
      </div>
    )
  }

  if (content.type === "clarification") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm/relaxed text-foreground">{content.question}</p>
        {content.suggestions && content.suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {content.suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                size="sm"
                className="text-muted-foreground"
                onClick={() => onClarificationSuggestion?.(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  if (content.type === "brief") {
    const brief = content.brief
    return (
      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">
            Design brief · {getSkill(skillId).name}
          </p>
          <Badge variant="secondary">Proposal</Badge>
        </div>
        <dl className="flex flex-col gap-1.5 text-sm/relaxed">
          {[
            ["Concept", brief.concept],
            ["Style", brief.style],
            ["Palette", brief.palette],
            ["Composition", brief.composition],
            ...(brief.symbolism ? [["Symbolism", brief.symbolism]] : []),
            ...(brief.typography ? [["Typography", brief.typography]] : []),
            ...(brief.headline ? [["Headline", brief.headline]] : []),
            ...(brief.subline ? [["Supporting line", brief.subline]] : []),
          ].map(([term, value]) => (
            <div key={term} className="flex flex-col sm:flex-row sm:gap-2">
              <dt className="shrink-0 text-xs font-medium text-muted-foreground sm:w-24 sm:pt-0.5">
                {term}
              </dt>
              <dd className="min-w-0 text-foreground">{value}</dd>
            </div>
          ))}
          {brief.constraints && brief.constraints.length > 0 ? (
            <div className="flex flex-col sm:flex-row sm:gap-2">
              <dt className="shrink-0 text-xs font-medium text-muted-foreground sm:w-24 sm:pt-0.5">
                Constraints
              </dt>
              <dd className="min-w-0 text-foreground">
                {brief.constraints.join("; ")}
              </dd>
            </div>
          ) : null}
        </dl>
        {canGenerate && onGenerate ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button onClick={() => onGenerate(1)}>Generate image</Button>
            <Button variant="outline" onClick={() => onGenerate(2)}>
              2 variations
            </Button>
            <Button variant="outline" onClick={() => onGenerate(4)}>
              4 variations
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  if (content.type === "generation") {
    const record = generations[content.generationId]
    if (!record) return null
    return (
      <GenerationGallery
        record={record}
        onRetryItem={
          onRetryItem ? (itemId) => onRetryItem(content.generationId, itemId) : undefined
        }
        onUseAsReference={onUseAsReference}
      />
    )
  }

  if (content.type === "error") {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
      >
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
        <p className="text-sm/relaxed">{content.error}</p>
      </div>
    )
  }

  if (content.type === "context") {
    return (
      <div className="rounded-xl border border-dashed border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">
          {content.title}
        </p>
        <p className="mt-1 text-sm/relaxed text-muted-foreground">
          {content.summary}
        </p>
      </div>
    )
  }

  return null
}

export function MessageList({
  messages,
  generations,
  skillId,
  generatableBriefId,
  streamingText,
  onGenerate,
  onRetryItem,
  onClarificationSuggestion,
  onUseAsReference,
}: {
  messages: Message[]
  generations: Record<string, GenerationRecord>
  skillId: SkillId
  generatableBriefId?: string
  /** Live assistant text while the consultation streams in. */
  streamingText?: string | null
  onGenerate?: (count: 1 | 2 | 4) => void
  onRetryItem?: (generationId: string, itemId: string) => void
  onClarificationSuggestion?: (suggestion: string) => void
  onUseAsReference?: (imageId: string, mimeType: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((message) => (
        <div key={message.id}>
          <div className="max-w-full">
            <MessageListItem
              message={message}
              generations={generations}
              skillId={skillId}
              generatableBriefId={generatableBriefId}
              onGenerate={onGenerate}
              onRetryItem={onRetryItem}
              onClarificationSuggestion={onClarificationSuggestion}
              onUseAsReference={onUseAsReference}
            />
          </div>
        </div>
      ))}
      {streamingText ? (
        <div className="flex justify-start">
          <div className="max-w-full">
            <Markdown content={streamingText} />
            <span className="animate-pulse text-sm text-foreground" aria-hidden="true">
              ▍
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
