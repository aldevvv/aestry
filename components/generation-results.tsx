"use client"

import Image from "next/image"
import { DownloadIcon, TriangleAlertIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"

export type GenerationImage = { url: string; mimeType: string }

export type GenerationRecord = {
  id: string
  prompt: string
  providerLabel: string
  imageModel: string
  status: "running" | "done" | "error"
  count: number
  images: GenerationImage[]
  error?: string
  warning?: string
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
}

function gridClassName(count: number): string {
  return count > 1 ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2"
}

function GenerationResults({
  generations,
}: {
  generations: GenerationRecord[]
}) {
  if (generations.length === 0) return null

  return (
    <div className="mt-10 flex flex-col gap-10">
      {generations.map((record) => (
        <section
          key={record.id}
          aria-label={`Generation: ${record.prompt.slice(0, 60)}`}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm text-foreground">
              {record.prompt}
            </p>
            <Badge variant="secondary">{record.imageModel}</Badge>
          </div>
          {record.status === "running" ? (
            <div className={gridClassName(record.count)}>
              {Array.from({ length: record.count }).map((_, index) => (
                <div
                  key={index}
                  className="flex aspect-square items-center justify-center rounded-xl border border-border bg-card text-muted-foreground"
                >
                  <Spinner className="size-5" />
                </div>
              ))}
            </div>
          ) : record.status === "error" ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="text-sm/relaxed">{record.error}</p>
            </div>
          ) : (
            <>
              <div className={gridClassName(record.count)}>
                {record.images.map((image, index) => (
                  <div
                    key={image.url}
                    className="group relative overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <Image
                      src={image.url}
                      alt={`Generated image ${index + 1} for: ${
                        record.prompt.length > 80
                          ? `${record.prompt.slice(0, 80)}…`
                          : record.prompt
                      }`}
                      width={768}
                      height={768}
                      unoptimized
                      className="aspect-square w-full object-cover"
                    />
                    <a
                      href={image.url}
                      download={`aestry-${record.id}-${index + 1}.${
                        EXTENSIONS[image.mimeType] ?? "png"
                      }`}
                      aria-label={`Download image ${index + 1}`}
                      className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-lg bg-background/90 text-foreground ring-1 ring-border transition-colors hover:bg-foreground hover:text-background"
                    >
                      <DownloadIcon className="size-4" />
                    </a>
                  </div>
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
            </>
          )}
        </section>
      ))}
    </div>
  )
}

export { GenerationResults }
