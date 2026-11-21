import type { Metadata } from "next"
import { TerminalIcon } from "lucide-react"

import { TerminalView } from "@/components/terminal-view"

export const metadata: Metadata = {
  title: "Terminal",
}

export default function TerminalPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Terminal
        </h1>
        <p className="text-sm text-muted-foreground">
          Raw events from every provider operation — requests, responses,
          streaming excerpts, successes and failures. Keys are redacted at the
          source.
        </p>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
          <TerminalIcon />
        </span>
        <p className="text-sm/relaxed text-muted-foreground">
          These events live in the server&rsquo;s memory (last 300 entries) and
          reset when the server restarts. Nothing here is persisted or sent
          anywhere.
        </p>
      </div>
      <TerminalView />
    </div>
  )
}
