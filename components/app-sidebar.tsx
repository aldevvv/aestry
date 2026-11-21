"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { toast } from "sonner"
import {
  FolderIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
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
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useConversations } from "@/lib/conversation/store"
import { useProjects } from "@/lib/projects/store"
import type { DesignProject } from "@/lib/projects/types"
import { ProjectFormDialog } from "@/components/project-view"
import {
  APP_NAV_ITEMS,
  UPCOMING_NAV_ITEMS,
  type AppNavItem,
  type UpcomingNavItem,
} from "@/lib/app-nav"

const RECENT_ROW_LIMIT = 100

function SidebarBrand() {
  const { state } = useSidebar()

  return (
    <div className="flex h-12 items-center px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <Link
        href="/"
        aria-label="Aestry home"
        className="rounded-md px-1.5 py-0.5 text-sm font-semibold tracking-tight text-sidebar-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        {state === "collapsed" ? "a." : "aestry."}
      </Link>
    </div>
  )
}

function SidebarSearchSurface({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="px-2 pt-2 group-data-[collapsible=icon]:hidden">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Search pages"
        className="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-transparent px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span>Search</span>
        <Kbd className="ml-auto">⌘K</Kbd>
      </button>
    </div>
  )
}

function SidebarSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const projects = useProjects((state) => state.projects)
  const refreshProjects = useProjects((state) => state.refresh)
  const summaryList = useConversations((state) => state.summaryList)
  const refreshSummaryList = useConversations((state) => state.refreshSummaryList)

  React.useEffect(() => {
    if (open) {
      void refreshProjects()
      void refreshSummaryList()
    }
  }, [open, refreshProjects, refreshSummaryList])

  const navigate = React.useCallback(
    (href: string) => {
      onOpenChange(false)
      router.push(href)
    },
    [onOpenChange, router]
  )

  // Title-level search only: message-history search is deliberately out of
  // scope to keep this bounded and fast.
  const recentSummaries = (summaryList ?? [])
    .filter((summary) => !summary.projectId)
    .slice(0, 20)

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Jump to a page, project, or conversation"
    >
      {/* CommandDialog does not provide the cmdk store itself; the
          <Command> wrapper supplies the context Input and List require. */}
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Pages">
            {APP_NAV_ITEMS.map((item) => (
              <CommandItem
                key={item.href}
                value={item.label}
                onSelect={() => navigate(item.href)}
              >
                <item.icon />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
          {projects && projects.length > 0 ? (
            <CommandGroup heading="Projects">
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`project ${project.name}`}
                  onSelect={() => navigate(`/project/${project.id}`)}
                >
                  <FolderIcon />
                  {project.name}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {recentSummaries.length > 0 ? (
            <CommandGroup heading="Conversations">
              {recentSummaries.map((summary) => (
                <CommandItem
                  key={summary.id}
                  value={`chat ${summary.title}`}
                  onSelect={() => navigate(`/chat/${summary.id}`)}
                >
                  <SquarePenIcon />
                  <span className="truncate">{summary.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function SidebarNewChat() {
  const router = useRouter()

  return (
    <SidebarGroup className="pt-2 pb-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="New Chat"
            onClick={() => {
              useConversations.getState().setActive(null)
              router.push("/")
            }}
          >
            <SquarePenIcon />
            <span>New Chat</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}

function SidebarNavGroup({
  label,
  items,
}: {
  label?: string
  items: AppNavItem[]
}) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <SidebarGroup>
      {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = pathname === item.href
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  render={<Link href={item.href} />}
                  isActive={active}
                  tooltip={item.label}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (isMobile) {
                      setOpenMobile(false)
                    }
                  }}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function SidebarUpcomingGroup({ items }: { items: UpcomingNavItem[] }) {
  return (
    <SidebarGroup className="pb-1">
      <SidebarGroupLabel>Upcoming</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton disabled>
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
              <SidebarMenuBadge>
                <Badge variant="secondary" className="px-1.5">
                  Soon
                </Badge>
              </SidebarMenuBadge>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function RecentRowMenu({
  conversationId,
  title,
  projects,
  onMoveToProject,
  onRename,
}: {
  conversationId: string
  title: string
  projects: DesignProject[]
  onMoveToProject: (projectId: string) => void
  onRename: () => void
}) {
  const router = useRouter()
  const { isMobile, setOpenMobile } = useSidebar()
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const handleDelete = async () => {
    const wasActive = useConversations.getState().activeId === conversationId
    try {
      await useConversations.getState().deleteConversation(conversationId)
    } catch {
      // Persistence failed: the conversation remains in the list. Success
      // is never reported for a deletion that did not stick.
      toast.error(
        "The conversation could not be deleted from storage. It remains in your list — try again."
      )
      return
    }
    toast.success("Conversation deleted")
    if (wasActive) {
      useConversations.getState().setActive(null)
      router.push("/")
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Conversation actions for ${title}`}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity outline-none group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:opacity-100"
            >
              <MoreHorizontalIcon className="size-4" />
            </button>
          }
        />
        <DropdownMenuContent
          side={isMobile ? "bottom" : "right"}
          align="start"
          className="min-w-36"
        >
          <DropdownMenuItem
            onSelect={() => {
              onRename()
              if (isMobile) {
                setOpenMobile(false)
              }
            }}
          >
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          {projects.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderIcon />
                Move to project
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 min-w-44 overflow-y-auto">
                {projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onSelect={() => {
                      onMoveToProject(project.id)
                      if (isMobile) {
                        setOpenMobile(false)
                      }
                    }}
                  >
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              // Controlled confirmation outside the menu: a nested trigger
              // unmounts with the menu and flashes the dialog.
              setConfirmOpen(true)
              if (isMobile) {
                setOpenMobile(false)
              }
            }}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The conversation and its message history are removed from this
              browser. Generated images stay in your asset library. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              onClick={() => void handleDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function RenameConversationDialog({
  conversationId,
  currentTitle,
  onClose,
}: {
  conversationId: string
  currentTitle: string
  onClose: () => void
}) {
  // Mounted fresh for each rename target (keyed by the parent), so the
  // input starts from the current title without a state-syncing effect.
  const [title, setTitle] = React.useState(currentTitle)

  const save = () => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error("Give the conversation a name.")
      return
    }
    useConversations
      .getState()
      .setTitle(conversationId, trimmed.slice(0, 60), "user")
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename conversation</DialogTitle>
          <DialogDescription>
            Up to 60 characters. The full title is stored, truncation is
            display-only.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              save()
            }
            if (event.key === "Escape") {
              onClose()
            }
          }}
          maxLength={60}
          aria-label="Conversation title"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SidebarRecent() {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const summaryList = useConversations((state) => state.summaryList)
  const refreshSummaryList = useConversations((state) => state.refreshSummaryList)
  const projects = useProjects((state) => state.projects)
  const refreshProjects = useProjects((state) => state.refresh)
  const moveConversation = useProjects((state) => state.moveConversation)
  const [renaming, setRenaming] = React.useState<{
    id: string
    title: string
  } | null>(null)

  React.useEffect(() => {
    void refreshSummaryList()
    void refreshProjects()
  }, [refreshSummaryList, refreshProjects])

  // Recent holds unassigned conversations only: Project chats live in their
  // Project's list, never redundantly in both sections.
  const recentSummaries = (summaryList ?? []).filter(
    (summary) => !summary.projectId
  )

  return (
    <SidebarGroup className="min-h-0 flex-1 overflow-y-auto pb-4 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Recent</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {summaryList === null ? (
            <>
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="mx-1.5 h-7 animate-pulse rounded-md bg-muted/60"
                />
              ))}
            </>
          ) : recentSummaries.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No conversations yet.
            </p>
          ) : (
            recentSummaries.slice(0, RECENT_ROW_LIMIT).map((summary) => {
              const active = pathname === `/chat/${summary.id}`
              return (
                <SidebarMenuItem key={summary.id} className="group/row relative">
                  <SidebarMenuButton
                    render={<Link href={`/chat/${summary.id}`} />}
                    isActive={active}
                    tooltip={summary.title}
                    aria-current={active ? "page" : undefined}
                    className="pr-7"
                    onClick={() => {
                      if (isMobile) {
                        setOpenMobile(false)
                      }
                    }}
                  >
                    <span className="truncate">{summary.title}</span>
                  </SidebarMenuButton>
                  <span className="absolute top-1/2 right-1.5 -translate-y-1/2">
                    <RecentRowMenu
                      conversationId={summary.id}
                      title={summary.title}
                      projects={projects ?? []}
                      onMoveToProject={(projectId) =>
                        void moveConversation(summary.id, projectId)
                      }
                      onRename={() =>
                        setRenaming({ id: summary.id, title: summary.title })
                      }
                    />
                  </span>
                </SidebarMenuItem>
              )
            })
          )}
        </SidebarMenu>
      </SidebarGroupContent>
      {renaming ? (
        <RenameConversationDialog
          key={`${renaming.id}:${renaming.title}`}
          conversationId={renaming.id}
          currentTitle={renaming.title}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </SidebarGroup>
  )
}

function SidebarProjectsGroup() {
  const router = useRouter()
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const projects = useProjects((state) => state.projects)
  const refreshProjects = useProjects((state) => state.refresh)
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  return (
    <SidebarGroup className="pb-1">
      <div className="flex items-center justify-between px-2">
        <SidebarGroupLabel className="px-0">Projects</SidebarGroupLabel>
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label="New Project"
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {projects === null ? (
            <div className="mx-1.5 h-7 animate-pulse rounded-md bg-muted/60" />
          ) : projects.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              Group chats into projects.
            </p>
          ) : (
            projects.map((project) => {
              const active = pathname === `/project/${project.id}`
              return (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    render={<Link href={`/project/${project.id}`} />}
                    isActive={active}
                    tooltip={project.name}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      if (isMobile) {
                        setOpenMobile(false)
                      }
                    }}
                  >
                    <FolderIcon />
                    <span className="truncate">{project.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })
          )}
        </SidebarMenu>
      </SidebarGroupContent>
      {creating ? (
        <ProjectFormDialog
          key="new-project"
          onClose={() => setCreating(false)}
          onSaved={(project) => {
            setCreating(false)
            router.push(`/project/${project.id}`)
          }}
        />
      ) : null}
    </SidebarGroup>
  )
}

function AppSidebar() {
  const [searchOpen, setSearchOpen] = React.useState(false)

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearchOpen((previous) => !previous)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent className="overflow-hidden">
        <SidebarSearchSurface onOpen={() => setSearchOpen(true)} />
        <SidebarNewChat />
        <SidebarNavGroup
          items={APP_NAV_ITEMS.filter((item) => item.group === "workspace")}
        />
        <SidebarProjectsGroup />
        <SidebarNavGroup
          label="Preferences"
          items={APP_NAV_ITEMS.filter((item) => item.group === "preferences")}
        />
        <SidebarUpcomingGroup items={UPCOMING_NAV_ITEMS} />
        <SidebarRecent />
      </SidebarContent>
      <SidebarRail />
      <SidebarSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </Sidebar>
  )
}

export { AppSidebar }
