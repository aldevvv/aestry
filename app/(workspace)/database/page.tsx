import type { Metadata } from "next"

import { DatabaseManager } from "@/components/database-manager"

export const metadata: Metadata = {
  title: "Database",
}

export default function DatabasePage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Database
        </h1>
        <p className="text-sm text-muted-foreground">
          Optional server-side database integrations. Aestry remains
          fully functional without them.
        </p>
      </div>
      <DatabaseManager />
    </div>
  )
}
