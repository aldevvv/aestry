import { ConversationWorkspace } from "@/components/conversation/conversation-workspace"

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ConversationWorkspace conversationId={id} />
}
