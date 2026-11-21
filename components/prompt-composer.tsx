"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import TextareaAutosize from "react-textarea-autosize"
import { ErrorCode, useDropzone, type FileRejection } from "react-dropzone"
import { toast } from "sonner"
import { CpuIcon, PaperclipIcon, XIcon } from "lucide-react"

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
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GenerationResults, type GenerationRecord, type GenerationImage } from "@/components/generation-results"
import { useMounted } from "@/hooks/use-mounted"
import { useProviders, type ProviderConfig } from "@/lib/provider-store"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function fileToBase64(
  file: File
): Promise<{ mimeType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const separator = result.indexOf(",")
      resolve({
        mimeType: file.type || "image/png",
        data: result.slice(separator + 1),
      })
    }
    reader.onerror = () => reject(new Error("Could not read the image"))
    reader.readAsDataURL(file)
  })
}

function createImageUrl(base64: string, mimeType: string): string {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }))
}

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

function ModelPicker({ active }: { active: ProviderConfig | undefined }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={active ? `Provider: ${active.label}` : "Model selection"}
          >
            <CpuIcon />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>
            {active ? active.label : "No model configured"}
          </PopoverTitle>
          <PopoverDescription>
            {active
              ? "This provider will be used for generation once the pipeline is wired up."
              : "Aestry generates assets through bring-your-own-key AI providers. Configure one to make the model selector and generation available."}
          </PopoverDescription>
        </PopoverHeader>
        {active ? (
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {active.imageModel ? (
              <p className="truncate">Image · {active.imageModel}</p>
            ) : null}
            {active.multimodalModel ? (
              <p className="truncate">
                Multimodal · {active.multimodalModel}
              </p>
            ) : null}
          </div>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/providers" />}
          nativeButton={false}
          onClick={() => setOpen(false)}
        >
          {active ? "Manage providers" : "Add a provider"}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function PromptComposer() {
  const providers = useProviders((state) => state.providers)
  const mounted = useMounted()
  // Most recently added provider is the one generation uses.
  const active = mounted ? providers[providers.length - 1] : undefined
  const [prompt, setPrompt] = React.useState("")
  const [assetType, setAssetType] = React.useState<AssetType>("app-icon")
  const [quantity, setQuantity] = React.useState<Quantity>("1")
  const [attachments, setAttachments] = React.useState<Attachment[]>([])
  const [running, setRunning] = React.useState(false)
  const [generations, setGenerations] = React.useState<GenerationRecord[]>([])
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const resultsRef = React.useRef<HTMLDivElement | null>(null)

  // Keep a ref in sync so unmount cleanup can revoke every object URL that
  // was ever created, even after the state has moved on.
  const attachmentsRef = React.useRef<Attachment[]>([])
  const generationsRef = React.useRef<GenerationRecord[]>([])
  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])
  React.useEffect(() => {
    generationsRef.current = generations
  }, [generations])

  React.useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        URL.revokeObjectURL(attachment.url)
      }
      for (const record of generationsRef.current) {
        for (const image of record.images) {
          URL.revokeObjectURL(image.url)
        }
      }
    }
  }, [])

  const canGenerate =
    Boolean(active?.imageModel) && prompt.trim().length > 0 && !running

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

  const updateGeneration = React.useCallback(
    (id: string, patch: Partial<GenerationRecord>) => {
      setGenerations((previous) =>
        previous.map((record) =>
          record.id === id ? { ...record, ...patch } : record
        )
      )
    },
    []
  )

  const submitGeneration = React.useCallback(async () => {
    if (!active?.imageModel || running || !prompt.trim()) return
    let referenceImages: Array<{ mimeType: string; data: string }> = []
    if (attachments.length > 0) {
      try {
        referenceImages = await Promise.all(
          attachments.map((attachment) => fileToBase64(attachment.file))
        )
      } catch {
        toast.error("Could not read a reference image.")
        return
      }
    }

    const record: GenerationRecord = {
      id: crypto.randomUUID(),
      prompt: prompt.trim(),
      providerLabel: active.label,
      imageModel: active.imageModel,
      status: "running",
      count: Number(quantity),
      images: [],
    }
    setGenerations((previous) => [record, ...previous])
    setRunning(true)
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "nearest",
      })
    })

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: active.kind,
          apiKey: active.apiKey,
          model: active.imageModel,
          baseUrl: active.baseUrl,
          prompt: record.prompt,
          count: Number(quantity),
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        }),
        signal: AbortSignal.timeout(180_000),
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message =
          isRecord(data) && typeof data.error === "string"
            ? data.error
            : `Generation failed (${response.status}).`
        updateGeneration(record.id, { status: "error", error: message })
        toast.error(message)
        return
      }
      if (!isRecord(data) || !Array.isArray(data.results)) {
        updateGeneration(record.id, {
          status: "error",
          error: "The generation response could not be read.",
        })
        return
      }
      const images: GenerationImage[] = []
      let firstError: string | undefined
      for (const item of data.results) {
        if (
          isRecord(item) &&
          item.ok === true &&
          isRecord(item.image) &&
          typeof item.image.mimeType === "string" &&
          typeof item.image.data === "string"
        ) {
          images.push({
            url: createImageUrl(item.image.data, item.image.mimeType),
            mimeType: item.image.mimeType,
          })
        } else if (
          isRecord(item) &&
          item.ok === false &&
          typeof item.error === "string" &&
          !firstError
        ) {
          firstError = item.error
        }
      }
      const warning =
        isRecord(data) && typeof data.warning === "string"
          ? data.warning
          : undefined
      if (images.length === 0) {
        const message = firstError ?? "No images were returned."
        updateGeneration(record.id, { status: "error", error: message, warning })
        toast.error(message)
        return
      }
      updateGeneration(record.id, { status: "done", images, warning })
      toast.success(
        `Generated ${images.length.toString()} image${
          images.length === 1 ? "" : "s"
        }`
      )
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Generation timed out."
          : "Could not reach the Aestry server."
      updateGeneration(record.id, { status: "error", error: message })
      toast.error(message)
    } finally {
      setRunning(false)
    }
  }, [active, attachments, prompt, quantity, running, updateGeneration])

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
            minRows={2}
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
              <TabsTrigger value="app-icon" className="px-2.5">
                App Icon
              </TabsTrigger>
              <TabsTrigger value="logo" className="px-2.5">
                Logo
              </TabsTrigger>
              <TabsTrigger value="og-image" className="px-2.5">
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
            <ModelPicker active={active} />
            <Button
              onClick={() => void submitGeneration()}
              disabled={!canGenerate}
            >
              {running ? (
                <>
                  <Spinner className="size-3.5" />
                  Generating…
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </div>
        </div>
      </div>
      {mounted && !active ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Generation is available once an AI provider is configured.{" "}
          <Link
            href="/providers"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Set up providers
          </Link>
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap justify-center gap-1">
        {EXAMPLE_PROMPTS.map((example) => (
          <Button
            key={example}
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => applySuggestion(example)}
          >
            {example}
          </Button>
        ))}
      </div>
      <div ref={resultsRef}>
        <GenerationResults generations={generations} />
      </div>
    </div>
  )
}

export { PromptComposer }
