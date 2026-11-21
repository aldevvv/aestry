"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  FolderIcon,
  MessageSquareIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react"

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useMounted } from "@/hooks/use-mounted"
import {
  selectActiveConversation,
  useConversations,
} from "@/lib/conversation/store"
import {
  loadProject,
} from "@/lib/conversation/persistence"
import { useProjects } from "@/lib/projects/store"
import type { DesignProject } from "@/lib/projects/types"

/**
 * Project overview: name, description, instructions, and the Project's
 * conversation list. New chats created here are scoped to the Project;
 * moving or deleting never touches messages or generated assets.
 */

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

export function ProjectFormDialog({
  onClose,
  project,
  onSaved,
}: {
  onClose: () => void
  /** Present = edit mode. */
  project?: DesignProject
  onSaved?: (project: DesignProject) => void
}) {
  const createProject = useProjects((state) => state.createProject)
  const renameProject = useProjects((state) => state.renameProject)
  const [name, setName] = React.useState(project?.name ?? "")
  const [description, setDescription] = React.useState(
    project?.description ?? ""
  )
  const [instructions, setInstructions] = React.useState(
    project?.instructions ?? ""
  )
  const [submitting, setSubmitting] = React.useState(false)

  const save = async () => {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    try {
      if (project) {
        await renameProject(project.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          instructions: instructions.trim() || undefined,
        })
        toast.success("Project updated")
      } else {
        const created = await createProject({
          name: name.trim(),
          description: description.trim() || undefined,
          instructions: instructions.trim() || undefined,
        })
        toast.success("Project created")
        onSaved?.(created)
      }
      onClose()
    } catch {
      toast.error("The project could not be saved.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>
            Projects group conversations and carry standing guidance for the
            design consultant. Guidance is context, never a way to override
            Aestry&rsquo;s security or approval boundaries.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void save()
                }
              }}
              autoFocus
              aria-label="Project name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-description">Description (optional)</Label>
            <Input
              id="project-description"
              value={description}
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this project for?"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-instructions">Instructions (optional)</Label>
            <Textarea
              id="project-instructions"
              value={instructions}
              maxLength={2_000}
              rows={4}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Standing guidance for consultations in this project — brand personality, audience, palette direction, things to always avoid."
            />
            <p className="text-xs text-muted-foreground">
              {instructions.length.toString()} / 2000 characters
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={submitting || name.trim().length === 0}
          >
            {submitting ? "Saving…" : project ? "Save" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteProjectDialog({
  project,
  conversationCount,
  onClose,
}: {
  project: DesignProject
  conversationCount: number
  onClose: () => void
}) {
  const deleteProject = useProjects((state) => state.deleteProject)
  const router = useRouter()

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The project and its guidance are removed. Its{" "}
            {conversationCount.toString()} conversation
            {conversationCount === 1 ? "" : "s"} return to Recent with all
            messages, and generated images stay in your asset library.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="sm"
            onClick={() => {
              void (async () => {
                try {
                  await deleteProject(project.id)
                  toast.success("Project deleted")
                  onClose()
                  router.push("/")
                } catch {
                  toast.error("The project could not be deleted from storage.")
                }
              })()
            }}
          >
            Delete project
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ProjectView({ projectId }: { projectId: string }) {
  const mounted = useMounted()
  const router = useRouter()
  const conversation = useConversations(selectActiveConversation)
  const listError = useProjects((state) => state.listError)
  const refreshProjects = useProjects((state) => state.refresh)
  const summaryList = useConversations((state) => state.summaryList)
  const refreshSummaryList = useConversations((state) => state.refreshSummaryList)
  const [project, setProject] = React.useState<DesignProject | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  React.useEffect(() => {
    void refreshProjects()
    void refreshSummaryList()
  }, [refreshProjects, refreshSummaryList])

  React.useEffect(() => {
    let alive = true
    void loadProject(projectId)
      .then((record) => {
        if (!alive) return
        if (record) {
          setProject(record)
        } else {
          setNotFound(true)
        }
      })
      .catch(() => {
        if (alive) setNotFound(true)
      })
    return () => {
      alive = false
    }
  }, [projectId])

  const projectConversations = (summaryList ?? []).filter(
    (summary) => summary.projectId === projectId
  )

  const startChat = () => {
    const created = useConversations
      .getState()
      .createConversation("app-icon", projectId)
    router.push(`/chat/${created.id}`)
  }

  if (!mounted) {
    return <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/50" />
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-4 text-sm">
        <p className="font-medium text-foreground">Project not found</p>
        <p className="text-muted-foreground">
          It may have been deleted from this browser.
        </p>
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/" />}
          nativeButton={false}
        >
          Back to Dashboard
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {listError ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-warning">
          {listError}
        </p>
      ) : null}
      {project ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
              <FolderIcon />
            </span>
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-foreground">
              {project.name}
            </h1>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit project
            </Button>
            <Button variant="default" size="sm" onClick={startChat}>
              <SquarePenIcon />
              New chat in project
            </Button>
          </div>
          {project.description ? (
            <p className="text-sm/relaxed text-muted-foreground">
              {project.description}
            </p>
          ) : null}
          {project.instructions ? (
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Standing instructions
              </p>
              <p className="mt-1 text-sm/relaxed text-foreground whitespace-pre-wrap">
                {project.instructions}
              </p>
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{projectConversations.length} conversations</Badge>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="ghost" size="xs" className="text-muted-foreground">
                    <Trash2Icon />
                    Delete project
                  </Button>
                }
              />
            </AlertDialog>
          </div>
        </div>
      ) : (
        <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/50" />
      )}

      <section className="flex flex-col gap-3" aria-labelledby="project-chats-heading">
        <div className="flex flex-col gap-1">
          <h2
            id="project-chats-heading"
            className="text-sm font-medium text-foreground"
          >
            Conversations in this project
          </h2>
          <p className="text-sm text-muted-foreground">
            These chats use the project guidance above. Moving them out of the
            project keeps every message and asset.
          </p>
        </div>
        {projectConversations.length === 0 ? (
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4 text-sm">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
              <MessageSquareIcon />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-medium text-foreground">No conversations yet</p>
              <p className="text-sm/relaxed text-muted-foreground">
                Start a chat inside this project to keep its work organized.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {projectConversations.map((summary) => (
              <div
                key={summary.id}
                className={`flex items-center gap-3 rounded-xl border bg-card p-3 ${
                  conversation?.id === summary.id ? "border-ring" : "border-border"
                }`}
              >
                <Link
                  href={`/chat/${summary.id}`}
                  className="min-w-0 flex-1 truncate rounded-md text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {summary.title}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(summary.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {editing && project ? (
        <ProjectFormDialog
          key={`edit-${project.id}`}
          project={project}
          onClose={() => setEditing(false)}
          onSaved={(updated) => setProject(updated)}
        />
      ) : null}
      {deleting && project ? (
        <DeleteProjectDialog
          project={project}
          conversationCount={projectConversations.length}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </div>
  )
}
