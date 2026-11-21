"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { MessageSquareIcon, Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useMounted } from "@/hooks/use-mounted"
import {
  deleteConversationRecord,
  listConversations,
} from "@/lib/conversation/persistence"
import { useConversations } from "@/lib/conversation/store"
import { getSkill } from "@/lib/skills/registry"

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes.toString()} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours.toString()}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days.toString()}d ago`
  return new Date(iso).toLocaleDateString()
}

function HistoryList() {
  const mounted = useMounted()
  const [conversations, setConversations] = React.useState<
    import("@/lib/conversation/types").Conversation[] | null
  >(null)

  React.useEffect(() => {
    let alive = true
    void listConversations()
      .then((records) => {
        if (alive) setConversations(records)
      })
      .catch(() => {
        if (alive) setConversations([])
        toast.error("Browser storage is unavailable — history cannot be read.")
      })
    return () => {
      alive = false
    }
  }, [])

  const handleDelete = async (id: string) => {
    try {
      await deleteConversationRecord(id)
    } catch {
      toast.error("The conversation could not be deleted from storage.")
      return
    }
    useConversations.getState().forgetConversation(id)
    setConversations((previous) =>
      previous ? previous.filter((conversation) => conversation.id !== id) : previous
    )
    toast.success("Conversation deleted")
  }

  if (!mounted || conversations === null) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-14 animate-pulse rounded-xl border border-border bg-muted/50"
          />
        ))}
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
          <MessageSquareIcon />
        </span>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="font-medium text-foreground">No conversations yet</p>
          <p className="text-sm/relaxed text-muted-foreground">
            Start creating in the Dashboard — conversations are saved in this
            browser.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {conversations.map((conversation) => (
        <div
          key={conversation.id}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
        >
          <div className="min-w-0 flex-1">
            <Link
              href={`/chat/${conversation.id}`}
              className="block truncate text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
            >
              {conversation.title}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">
                {getSkill(conversation.skillId).name}
              </Badge>
              <span>{relativeTime(conversation.updatedAt)}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link href={`/chat/${conversation.id}`} />}
            nativeButton={false}
            aria-label={`Open ${conversation.title}`}
          >
            <MessageSquareIcon />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${conversation.title}`}
                >
                  <Trash2Icon />
                </Button>
              }
            />
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete “{conversation.title}”?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The conversation, its design brief, and its generated images
                  are removed from this browser. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleDelete(conversation.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ))}
    </div>
  )
}

export { HistoryList }
