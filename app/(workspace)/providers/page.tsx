import type { Metadata } from "next"
import { LockIcon } from "lucide-react"

import { ProvidersManager } from "@/components/providers-manager"

export const metadata: Metadata = {
  title: "Providers",
}

export default function ProvidersPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Providers
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect the AI providers Aestry uses to generate assets. Keys stay in
          this browser.
        </p>
      </div>
      <ProvidersManager />
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
          <LockIcon />
        </span>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="font-medium text-foreground">
            Keys never leave this device
          </p>
          <p className="text-sm/relaxed text-muted-foreground">
            API keys are stored in this browser&rsquo;s local storage and are
            sent only to the provider endpoint you configured. They are never
            synced, logged, or transmitted anywhere else, and removing a
            provider deletes its key.
          </p>
        </div>
      </div>
    </div>
  )
}
