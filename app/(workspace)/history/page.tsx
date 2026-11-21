import type { Metadata } from "next"

import { AssetGallery } from "@/components/asset-gallery"

export const metadata: Metadata = {
  title: "History",
}

export default function HistoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          History
        </h1>
        <p className="text-sm text-muted-foreground">
          Every generated image across all conversations, saved in this
          browser. Assets stay here even if their conversation is deleted.
        </p>
      </div>
      <AssetGallery />
    </div>
  )
}
