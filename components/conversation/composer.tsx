"use client"

import * as React from "react"
import Link from "next/link"
import TextareaAutosize from "react-textarea-autosize"
import { ErrorCode, useDropzone, type FileRejection } from "react-dropzone"
import { toast } from "sonner"
import {
  ArrowUpIcon,
  PaperclipIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react"

import { ModelRoleSelect } from "@/components/model-role-select"
import { Button } from "@/components/ui/button"
import Image from "next/image"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ActivityOrb } from "@/components/thinking-indicator"
import { useProviders } from "@/lib/provider-store"

const MAX_ATTACHMENTS = 4
const MAX_FILE_SIZE = 10 * 1024 * 1024

const ACCEPTED_IMAGE_TYPES = {
  "image/png": [],
  "image/jpeg": [],
  "image/webp": [],
  "image/gif": [],
}

export type ComposerProps = {
  variant: "welcome" | "conversation"
  busy: boolean
  /** Prompt tokens measured after the last consultation (null = unknown). */
  contextTokens?: number | null
  compacting?: boolean
  onCompact?: () => void
  suggestions?: string[]
  onSend: (text: string, files: File[]) => void
}

export function Composer({
  variant,
  busy,
  contextTokens,
  compacting,
  onCompact,
  suggestions,
  onSend,
}: ComposerProps) {
  const [text, setText] = React.useState("")
  const [attachments, setAttachments] = React.useState<
    Array<{ id: string; file: File; url: string }>
  >([])
  const [composing, setComposing] = React.useState(false)
  const attachmentsRef = React.useRef(attachments)
  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])
  React.useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        URL.revokeObjectURL(attachment.url)
      }
    }
  }, [])

  const onDrop = React.useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setAttachments((previous) => {
        const next = [...previous]
        for (const file of acceptedFiles) {
          if (next.length >= MAX_ATTACHMENTS) break
          next.push({
            id: crypto.randomUUID(),
            file,
            url: URL.createObjectURL(file),
          })
        }
        return next
      })
      for (const rejection of fileRejections) {
        const error = rejection.errors[0]
        const reason =
          error?.code === ErrorCode.FileTooLarge
            ? "file is larger than 10 MB"
            : error?.code === ErrorCode.TooManyFiles
              ? "up to 4 reference images per message"
              : "unsupported file type — use PNG, JPEG, WebP, or GIF"
        toast.error(`${rejection.file.name}: ${reason}`)
      }
    },
    []
  )

  const { getRootProps, getInputProps, open: openFilePicker } = useDropzone({
    accept: ACCEPTED_IMAGE_TYPES,
    maxSize: MAX_FILE_SIZE,
    maxFiles: MAX_ATTACHMENTS,
    noClick: true,
    noKeyboard: true,
    disabled: attachments.length >= MAX_ATTACHMENTS,
    onDrop,
  })

  const removeAttachment = (id: string) => {
    setAttachments((previous) => {
      const target = previous.find((attachment) => attachment.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return previous.filter((attachment) => attachment.id !== id)
    })
  }

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    onSend(trimmed, attachments.map((attachment) => attachment.file))
    setText("")
    setAttachments((previous) => {
      for (const attachment of previous) URL.revokeObjectURL(attachment.url)
      return []
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || composing) return
    event.preventDefault()
    submit()
  }

  const consultationSelected = useProviders(
    (state) => state.selections.consultation !== null
  )

  const canSend = text.trim().length > 0 && !busy && consultationSelected

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className="rounded-xl border border-border bg-card transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
      >
        <input {...getInputProps()} />
        <div className="px-3 pt-2.5">
          <TextareaAutosize
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            minRows={variant === "welcome" ? 2 : 1}
            maxRows={10}
            placeholder={
              variant === "welcome"
                ? "Describe the asset you want to create..."
                : "Reply, refine, or describe what to change..."
            }
            aria-label="Message"
            className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-3 pt-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="relative size-16 overflow-hidden rounded-lg border border-border"
              >
                <Image
                  src={attachment.url}
                  alt={attachment.file.name}
                  width={64}
                  height={64}
                  unoptimized
                  className="size-16 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.file.name}`}
                  className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground ring-1 ring-border transition-colors hover:bg-foreground hover:text-background"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 px-2.5 py-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Attach reference images"
            onClick={() => openFilePicker()}
            disabled={attachments.length >= MAX_ATTACHMENTS}
          >
            <PaperclipIcon />
          </Button>
          <ModelRolePopover />
          <div className="ml-auto flex items-center gap-1.5">
            {variant === "conversation" ? (
              <ContextWindowPie
                contextTokens={contextTokens}
                compacting={compacting}
                onCompact={onCompact}
              />
            ) : null}
            <Button
              size="icon-sm"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send message"
            >
              {busy ? (
                <ActivityOrb activity="consult" size={20} />
              ) : (
                <ArrowUpIcon />
              )}
            </Button>
          </div>
        </div>
      </div>
      {!consultationSelected ? (
        <p className="mt-2.5 text-center text-xs text-muted-foreground">
          Add a provider and choose a consultation model in{" "}
          <Link
            href="/providers"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Providers
          </Link>{" "}
          to start the conversation.
        </p>
      ) : null}
      {variant === "welcome" && suggestions && suggestions.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap justify-center gap-1">
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion}
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setText(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ContextWindowPie({
  contextTokens,
  compacting,
  onCompact,
}: {
  contextTokens?: number | null
  compacting?: boolean
  onCompact?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const providers = useProviders((state) => state.providers)
  const selection = useProviders((state) => state.selections.consultation)
  const provider = selection
    ? providers.find((p) => p.id === selection.providerId)
    : undefined
  const model = selection
    ? (provider?.models ?? []).find((m) => m.id === selection.model)
    : undefined
  const limit = model?.contextWindow
  const used = contextTokens ?? 0
  const ratio = limit ? Math.min(used / limit, 1) : null
  const nearLimit = ratio !== null && ratio >= 0.95

  // Donut geometry: r=7, circumference ≈ 43.98.
  const circumference = 2 * Math.PI * 7
  const dash = ratio === null ? 0 : circumference * ratio
  const strokeColor = nearLimit
    ? "var(--warning)"
    : ratio === null
      ? "var(--muted-foreground)"
      : "var(--foreground)"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Context window usage"
            className="flex size-7 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors hover:bg-muted"
          >
            <svg viewBox="0 0 20 20" className="size-4" role="img">
              <circle
                cx="10"
                cy="10"
                r="7"
                fill="none"
                stroke="var(--border)"
                strokeWidth="2.5"
              />
              {ratio !== null && ratio > 0 ? (
                <circle
                  cx="10"
                  cy="10"
                  r="7"
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="2.5"
                  strokeDasharray={`${dash} ${circumference}`}
                  strokeLinecap="round"
                  transform="rotate(-90 10 10)"
                />
              ) : null}
              {compacting ? (
                <circle
                  cx="10"
                  cy="10"
                  r="7"
                  fill="none"
                  stroke="var(--warning)"
                  strokeWidth="2.5"
                  strokeDasharray="6 38"
                  strokeLinecap="round"
                  className="animate-spin origin-center"
                />
              ) : null}
            </svg>
          </button>
        }
      />
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Context window</PopoverTitle>
          <PopoverDescription>
            {model ? model.id : "No consultation model selected"}
          </PopoverDescription>
        </PopoverHeader>
        <div className="text-xs text-muted-foreground">
          {limit ? (
            <p>
              ~{used.toLocaleString()} of {limit.toLocaleString()} tokens used
              {ratio !== null ? ` (${Math.round(ratio * 100).toString()}%)` : ""}.
            </p>
          ) : (
            <p>
              This endpoint does not report a context limit, so usage cannot be
              measured.
            </p>
          )}
          <p className="mt-1">
            Measured after each consultation. The conversation auto-compacts at
            95% to stay within the window.
          </p>
        </div>
        {onCompact && limit ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onCompact()
              setOpen(false)
            }}
            disabled={compacting}
          >
            {compacting ? (
              <>
                <ActivityOrb activity="compact" size={20} />
                Compacting…
              </>
            ) : (
              "Compact now"
            )}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function ModelRolePopover() {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Model settings"
          >
            <Settings2Icon />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Model roles</PopoverTitle>
          <PopoverDescription>
            Consultation and generation can use different providers.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex flex-col gap-3">
          <ModelRoleSelect
            role="consultation"
            capability="multimodal"
            label="Consultation model"
          />
          <ModelRoleSelect
            role="generation"
            capability="image"
            label="Generation model"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/providers" />}
          nativeButton={false}
          onClick={() => setOpen(false)}
        >
          Manage in Providers
        </Button>
      </PopoverContent>
    </Popover>
  )
}
