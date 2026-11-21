import Link from "next/link"
import { ImagePlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default function HistoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          History
        </h1>
        <p className="text-sm text-muted-foreground">
          Every asset you generate will be kept here, locally in your browser.
        </p>
      </div>
      <Empty className="mt-8 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImagePlusIcon />
          </EmptyMedia>
          <EmptyTitle>No creations yet</EmptyTitle>
          <EmptyDescription>
            Your generated assets will appear here once you start creating.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link href="/" />} nativeButton={false}>
            Start creating
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
