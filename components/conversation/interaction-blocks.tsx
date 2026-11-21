"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { InteractionBlock } from "@/lib/conversation/schema"

/**
 * Trusted registry for interaction blocks. Every variant is a fixed,
 * typed Aestry component fed by validated, bounded data — nothing here
 * executes model-supplied code or renders untrusted markup. Blocks are
 * serializable and render identically after conversation restore.
 */

function BlockCard({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  )
}

function ConceptComparison({
  block,
  onSelect,
}: {
  block: Extract<InteractionBlock, { type: "concept-comparison" }>
  onSelect?: (choice: string) => void
}) {
  return (
    <BlockCard label="Design directions">
      <div className="grid gap-2 sm:grid-cols-2">
        {block.options.map((option) => (
          <div
            key={option.title}
            className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5"
          >
            <p className="text-sm font-medium text-foreground">{option.title}</p>
            <p className="text-sm/relaxed text-muted-foreground">{option.premise}</p>
            {option.composition ? (
              <p className="text-xs text-muted-foreground">
                Composition · {option.composition}
              </p>
            ) : null}
            {option.tradeoffs ? (
              <p className="text-xs text-muted-foreground">
                Trade-offs · {option.tradeoffs}
              </p>
            ) : null}
            {onSelect ? (
              <Button
                variant="outline"
                size="xs"
                className="mt-auto self-start"
                onClick={() => onSelect(option.title)}
              >
                Use this direction
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </BlockCard>
  )
}

function Critique({
  block,
}: {
  block: Extract<InteractionBlock, { type: "critique" }>
}) {
  const sections = [
    { label: "Strengths", items: block.strengths, tone: "text-foreground" },
    { label: "Problems", items: block.problems, tone: "text-foreground" },
    {
      label: "Suggested refinements",
      items: block.refinements,
      tone: "text-foreground",
    },
  ].filter((section) => section.items.length > 0)
  return (
    <BlockCard
      label={
        block.basedOn === "reference-image"
          ? "Reference critique"
          : block.basedOn === "generated-image"
            ? "Generated image critique"
            : "Design critique"
      }
    >
      <div className="flex flex-col gap-2">
        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {section.label}
            </p>
            <ul className="ml-4 list-disc space-y-0.5 text-sm/relaxed">
              {section.items.map((item, index) => (
                <li key={`${section.label}-${index.toString()}`}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </BlockCard>
  )
}

function Palette({
  block,
}: {
  block: Extract<InteractionBlock, { type: "palette" }>
}) {
  return (
    <BlockCard label="Palette direction">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {block.colors.map((color) => (
          <div
            key={color.hex}
            className="flex items-center gap-2 rounded-lg border border-border p-1.5"
          >
            <span
              className="size-7 shrink-0 rounded-md border border-border"
              style={{ backgroundColor: color.hex }}
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono text-xs text-foreground">
                {color.hex}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {color.role}
              </span>
            </span>
          </div>
        ))}
      </div>
      {block.note ? (
        <p className="text-xs text-muted-foreground">{block.note}</p>
      ) : null}
    </BlockCard>
  )
}

function Typography({
  block,
}: {
  block: Extract<InteractionBlock, { type: "typography" }>
}) {
  return (
    <BlockCard label="Typography directions">
      <div className="flex flex-col gap-1.5">
        {block.directions.map((direction) => (
          <div
            key={direction.name}
            className="flex flex-col gap-0.5 rounded-lg border border-border p-2.5"
          >
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {direction.name}
            </p>
            <p className="text-sm/relaxed text-muted-foreground">
              {direction.attitude}
            </p>
            {direction.note ? (
              <p className="text-xs text-muted-foreground">{direction.note}</p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Directions describe typographic attitude — exact font rendering
        depends on the fonts available where assets are produced.
      </p>
    </BlockCard>
  )
}

function GenerationProposal({
  block,
}: {
  block: Extract<InteractionBlock, { type: "generation-proposal" }>
}) {
  return (
    <BlockCard label="Generation proposal">
      <p className="text-sm/relaxed text-foreground">{block.summary}</p>
      {block.suggestedCount ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <CheckIcon className="size-3.5" />
          Suggested variation count: {block.suggestedCount.toString()}
        </p>
      ) : null}
    </BlockCard>
  )
}

/**
 * Renders validated interaction blocks. Unknown block types are ignored —
 * the schema strips them server-side already, so this is a belt-and-
 * braces guard for persisted conversations from older versions.
 */
export function InteractionBlocks({
  blocks,
  onSelect,
}: {
  blocks: InteractionBlock[]
  onSelect?: (choice: string) => void
}) {
  if (!blocks || blocks.length === 0) return null
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "concept-comparison":
            return <ConceptComparison key={index} block={block} onSelect={onSelect} />
          case "critique":
            return <Critique key={index} block={block} />
          case "palette":
            return <Palette key={index} block={block} />
          case "typography":
            return <Typography key={index} block={block} />
          case "generation-proposal":
            return <GenerationProposal key={index} block={block} />
          default:
            return null
        }
      })}
    </div>
  )
}
