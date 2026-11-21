import type { Metadata } from "next"

import { ConversationWorkspace } from "@/components/conversation/conversation-workspace"

export const metadata: Metadata = {
  title: "Temporary chat",
  robots: { index: false, follow: false },
}

export default function TemporaryChatPage() {
  return (
    <ConversationWorkspace ephemeral />
  )
}
