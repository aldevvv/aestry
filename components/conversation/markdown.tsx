"use client"

import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { CheckIcon, CopyIcon } from "lucide-react"

/**
 * Safe Markdown rendering for conversation content. Model output is
 * untrusted: raw HTML is never rendered, images from model content are
 * dropped, URL schemes are restricted, and external links get noopener
 * attributes. Styling follows the monochrome design system at chat
 * density — no oversized bubbles, no decorative cards.
 */

function allowedUri(uri: string): string {
  try {
    const url = new URL(uri)
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
    ) {
      return uri
    }
  } catch {
    // Relative anchors and bare fragments are safe.
    if (uri.startsWith("#")) return uri
  }
  return ""
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false)
  const preRef = React.useRef<HTMLPreElement | null>(null)

  const copy = async () => {
    const text = preRef.current?.textContent ?? ""
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    } catch {
      // Clipboard unavailable (permissions, non-secure context): the code
      // remains selectable.
    }
  }

  return (
    <div className="group relative my-2.5">
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-lg bg-muted/60 p-2.5 font-mono text-xs leading-relaxed text-foreground"
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy code"
        className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-lg bg-background/90 text-muted-foreground ring-1 ring-border transition-colors hover:bg-foreground hover:text-background"
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  )
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    const safeHref = href ? allowedUri(href) : ""
    if (!safeHref) {
      return <span>{children}</span>
    }
    const external = /^https?:/i.test(safeHref)
    return (
      <a
        href={safeHref}
        {...(external
          ? { target: "_blank", rel: "noopener noreferrer nofollow" }
          : {})}
        className="font-medium text-foreground underline underline-offset-4"
      >
        {children}
      </a>
    )
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    // Fenced blocks carry a language-className; inline code does not.
    const isBlock = typeof className === "string" && className.includes("language-")
    if (isBlock) {
      return <code className="font-mono text-xs">{children}</code>
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
        {children}
      </code>
    )
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  ol: ({ children }) => (
    <ol className="ml-4 list-decimal space-y-1 [ol&]:mt-1">{children}</ol>
  ),
  ul: ({ children }) => (
    <ul className="ml-4 list-disc space-y-1 [ul&]:mt-1">{children}</ul>
  ),
  li: ({ children, className }) => {
    // GFM task lists render disabled checkbox inputs inside list items.
    const isTask = typeof className === "string" && className.includes("task-list-item")
    return (
      <li className={isTask ? "list-none" : undefined}>
        {isTask ? <span className="ml-[-1em] mr-1.5">☐</span> : null}
        {children}
      </li>
    )
  },
  input: () => null,
  h1: ({ children }) => (
    <p className="mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</p>
  ),
  h2: ({ children }) => (
    <p className="mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</p>
  ),
  h3: ({ children }) => (
    <p className="mt-2.5 text-sm font-semibold text-foreground first:mt-0">{children}</p>
  ),
  h4: ({ children }) => (
    <p className="mt-2.5 text-sm font-medium text-foreground first:mt-0">{children}</p>
  ),
  h5: ({ children }) => (
    <p className="mt-2.5 text-sm font-medium text-foreground first:mt-0">{children}</p>
  ),
  h6: ({ children }) => (
    <p className="mt-2.5 text-sm font-medium text-muted-foreground first:mt-0">{children}</p>
  ),
  hr: () => <hr className="my-3 border-border" />,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
  table: ({ children }) => (
    <div className="my-2.5 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm [&_td]:border-b [&_td]:border-border/60 [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-border [&_th]:bg-muted/40 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium">
        {children}
      </table>
    </div>
  ),
  // Model-provided images are never embedded: they are an arbitrary remote
  // content channel. The alt text stands in instead.
  img: ({ alt }) =>
    alt ? (
      <span className="rounded-lg bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
        {alt}
      </span>
    ) : null,
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words text-sm/relaxed text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={allowedUri}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
