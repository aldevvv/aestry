import type { Metadata } from "next"

import { HistoryList } from "@/components/history-list"

export const metadata: Metadata = {
  title: "History",
}

export default function HistoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          History
        </h1>
        <p className="text-sm text-muted-foreground">
          Conversations and their generated assets are saved locally in this
          browser.
        </p>
      </div>
      <HistoryList />
    </div>
  )
}
