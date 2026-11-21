"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import TextareaAutosize from "react-textarea-autosize"
import { ErrorCode, useDropzone, type FileRejection } from "react-dropzone"
import { toast } from "sonner"
import {
  AppWindowIcon,
  ChevronDownIcon,
  CpuIcon,
  ImageIcon,
  PaperclipIcon,
  ShapesIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const MAX_ATTACHMENTS = 4
const MAX_FILE_SIZE = 10 * 1024 * 1024

const ACCEPTED_IMAGE_TYPES = {
  "image/png": [],
  "image/jpeg": [],
  "image/webp": [],
  "image/gif": [],
}

const REJECTION_MESSAGES: Record<string, string> = {
  [ErrorCode.FileTooLarge]: "file is larger than 10 MB",
  [ErrorCode.FileInvalidType]: "unsupported file type — use PNG, JPEG, WebP, or GIF",
  [ErrorCode.TooManyFiles]: "up to 4 reference images per request",
}

type AssetType = "app-icon" | "logo" | "og-image"

function isAssetType(value: string): value is AssetType {
  switch (value) {
    case "app-icon":
    case "logo":
    case "og-image":
      return true
    default:
      return false
  }
}

const QUANTITIES = ["1", "2", "4"] as const
type Quantity = (typeof QUANTITIES)[number]

function isQuantity(value: string): value is Quantity {
  switch (value) {
    case "1":
    case "2":
    case "4":
      return true
    default:
      return false
  }
}

export type GenerationRequest = {
  prompt: string
  assetType: AssetType
  quantity: Quantity
  referenceImages: File[]
}

type Attachment = {
  id: string
  file: File
  url: string
}

const EXAMPLE_PROMPTS = [
  "Create a minimal logo for my developer tool.",
  "Design a modern app icon for a productivity application.",
  "Create an OG image for my open-source project.",
]

function ModelPicker() {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
          >
            <CpuIcon />
            <span className="hidden md:inline">No model configured</span>
            <ChevronDownIcon />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>AI providers</PopoverTitle>
          <PopoverDescription>
            Aestry generates assets through bring-your-own-key AI providers.
            Configure a provider to make the model selector and generation
            available.
          </PopoverDescription>
        </PopoverHeader>
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/settings" />}
          onClick={() => setOpen(false)}
        >
          Configure in Settings
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function PromptComposer({ onSubmit }: { onSubmit?: (request: GenerationRequest) => void }) {
  const [prompt, setPrompt] = React.useState("")
  const [assetType, setAssetType] = React.useState<AssetType>("app-icon")
  const [quantity, setQuantity] = React.useState<Quantity>("1")
  const [attachments, setAttachments] = React.useState<Attachment[]>([])
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  // Keep a ref in sync so unmount cleanup can revoke every object URL that
  // was ever created, even after the state has moved on.
  const attachmentsRef = React.useRef<Attachment[]>([])
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

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((previous) => {
      const target = previous.find((attachment) => attachment.id === id)
      if (target) {
        URL.revokeObjectURL(target.url)
      }
      return previous.filter((attachment) => attachment.id !== id)
    })
  }, [])

  const onDrop = React.useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setAttachments((previous) => {
        const next: Attachment[] = [...previous]
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
          (error && REJECTION_MESSAGES[error.code]) || "could not be attached"
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

  const applySuggestion = React.useCallback((value: string) => {
    setPrompt(value)
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className="rounded-xl border border-border bg-card transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
      >
        <input {...getInputProps()} />
        <div className="px-3.5 pt-3">
          <TextareaAutosize
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            minRows={3}
            maxRows={12}
            placeholder="Describe the asset you want to create..."
            aria-label="Generation prompt"
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
            value={assetType}
            onValueChange={(value) => {
              if (typeof value === "string" && isAssetType(value)) {
                setAssetType(value)
              }
            }}
          >
            <TabsList aria-label="Asset type" className="rounded-lg">
              <TabsTrigger value="app-icon" className="px-2">
                <AppWindowIcon />
                App Icon
              </TabsTrigger>
              <TabsTrigger value="logo" className="px-2">
                <ShapesIcon />
                Logo
              </TabsTrigger>
              <TabsTrigger value="og-image" className="px-2">
                <ImageIcon />
                OG Image
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-1.5">
            <Select
              value={quantity}
              onValueChange={(value) => {
                if (typeof value === "string" && isQuantity(value)) {
                  setQuantity(value)
                }
              }}
            >
              <SelectTrigger size="sm" aria-label="Number of images">
                <SelectValue>
                  {(value) => `${value} image${value === "1" ? "" : "s"}`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {QUANTITIES.map((count) => (
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
            <ModelPicker />
            {/* Generation ships in a later phase: without an onSubmit handler
                the composer stays disabled instead of pretending to work. */}
            <Button disabled={!onSubmit} aria-disabled={!onSubmit}>
              Generate
            </Button>
          </div>
        </div>
      </div>
      {onSubmit ? null : (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Generation is available once an AI provider is configured.{" "}
          <Link
            href="/settings"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Set up providers in Settings
          </Link>
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {EXAMPLE_PROMPTS.map((example) => (
          <Button
            key={example}
            variant="outline"
            size="sm"
            className="rounded-full text-muted-foreground"
            onClick={() => applySuggestion(example)}
          >
            {example}
          </Button>
        ))}
      </div>
    </div>
  )
}

export { PromptComposer }
