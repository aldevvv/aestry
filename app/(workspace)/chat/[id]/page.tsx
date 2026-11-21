import { Suspense } from "react"

import { ConversationWorkspace } from "@/components/conversation/conversation-workspace"

function ChatFallback() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6" aria-hidden="true">
      <div className="flex flex-col gap-6">
        <div className="h-10 animate-pulse rounded-xl border border-border bg-muted/50" />
        <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/50" />
        <div className="h-10 w-2/3 animate-pulse rounded-xl border border-border bg-muted/50" />
        <div className="h-12 animate-pulse rounded-xl border border-border bg-muted/50" />
      </div>
    </div>
  )
}

async function ChatConversation({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ConversationWorkspace conversationId={id} />
}

export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatConversation params={params} />
    </Suspense>
  )
}
