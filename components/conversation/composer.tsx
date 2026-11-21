"use client"

import * as React from "react"
import Link from "next/link"
import TextareaAutosize from "react-textarea-autosize"
import { ErrorCode, useDropzone, type FileRejection } from "react-dropzone"
import { toast } from "sonner"
import {
  ArrowUpIcon,
  CpuIcon,
  PaperclipIcon,
  XIcon,
} from "lucide-react"

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SKILL_IDS, getSkill, isSkillId, type SkillId } from "@/lib/skills/registry"

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
  skillId: SkillId
  quantity: 1 | 2 | 4
  consultationLabel: string | null
  generationLabel: string | null
  busy: boolean
  suggestions?: Array<{ skillId: SkillId; text: string }>
  onSend: (text: string, files: File[]) => void
  onSkillChange: (skillId: SkillId) => void
  onQuantityChange: (quantity: 1 | 2 | 4) => void
}

export function Composer({
  variant,
  skillId,
  quantity,
  consultationLabel,
  generationLabel,
  busy,
  suggestions,
  onSend,
  onSkillChange,
  onQuantityChange,
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

  const canSend =
    text.trim().length > 0 && !busy && Boolean(consultationLabel)

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className="rounded-xl border border-border bg-card transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
      >
        <input {...getInputProps()} />
        <div className="px-3.5 pt-3">
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
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-3.5 pt-2">
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
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2.5">
          <Tabs
            value={skillId}
            onValueChange={(value) => {
              if (typeof value === "string" && isSkillId(value)) {
                onSkillChange(value)
              }
            }}
          >
            <TabsList aria-label="Asset type" className="rounded-lg">
              {SKILL_IDS.map((id) => (
                <TabsTrigger key={id} value={id} className="px-2.5">
                  {getSkill(id).name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-1.5">
            <Select
              value={String(quantity)}
              onValueChange={(value) => {
                if (value === "1" || value === "2" || value === "4") {
                  onQuantityChange(Number(value) as 1 | 2 | 4)
                }
              }}
            >
              <SelectTrigger size="sm" aria-label="Number of images">
                <SelectValue>
                  {(value) =>
                    typeof value === "string" && value
                      ? `${value} image${value === "1" ? "" : "s"}`
                      : "Quantity"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(["1", "2", "4"] as const).map((count) => (
                  <SelectItem key={count} value={count}>
                    {`${count} image${count === "1" ? "" : "s"}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Attach reference images"
              onClick={() => openFilePicker()}
              disabled={attachments.length >= MAX_ATTACHMENTS}
            >
              <PaperclipIcon />
            </Button>
            <ModelInfo
              consultationLabel={consultationLabel}
              generationLabel={generationLabel}
            />
            <Button
              size="icon-sm"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send message"
            >
              {busy ? <Spinner className="size-4" /> : <ArrowUpIcon />}
            </Button>
          </div>
        </div>
      </div>
      {!consultationLabel ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
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
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion.text}
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                onSkillChange(suggestion.skillId)
                setText(suggestion.text)
              }}
            >
              {suggestion.text}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ModelInfo({
  consultationLabel,
  generationLabel,
}: {
  consultationLabel: string | null
  generationLabel: string | null
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Provider and model roles"
          >
            <CpuIcon />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Model roles</PopoverTitle>
          <PopoverDescription>
            Consultation and generation can use different providers.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex flex-col gap-1 text-xs">
          <p className="truncate text-foreground">
            <span className="text-muted-foreground">Consultation: </span>
            {consultationLabel ?? "Not set"}
          </p>
          <p className="truncate text-foreground">
            <span className="text-muted-foreground">Generation: </span>
            {generationLabel ?? "Not set"}
          </p>
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
