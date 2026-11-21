"use client"

import { useTheme } from "next-themes"
import { usePathname, useRouter } from "next/navigation"
import {
  MonitorIcon,
  MoonIcon,
  SquarePenIcon,
  SunIcon,
  TimerIcon,
} from "lucide-react"

import { useMounted } from "@/hooks/use-mounted"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useConversations } from "@/lib/conversation/store"

function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  const mounted = useMounted()
  // Before hydration the icon must match the server output, so it stays a
  // neutral sun until mounted; after that it reflects the active theme.
  const Icon = mounted && theme === "dark" ? MoonIcon : SunIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Change theme">
            <Icon />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value)}
        >
          <DropdownMenuRadioItem value="light">
            <SunIcon />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HeaderIconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={label}
            aria-pressed={active ? true : undefined}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function WorkspaceHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const temporaryActive = pathname === "/temporary"

  return (
    <header className="sticky top-0 z-20 flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3">
      <SidebarTrigger className="-ml-1" />
      <HeaderIconButton
        label="New Chat"
        onClick={() => {
          useConversations.getState().setActive(null)
          router.push("/")
        }}
      >
        <SquarePenIcon />
      </HeaderIconButton>
      <HeaderIconButton
        label="Temporary Chat — not saved"
        active={temporaryActive}
        onClick={() => router.push("/temporary")}
      >
        <TimerIcon />
      </HeaderIconButton>
      <div className="ml-auto flex items-center">
        <ThemeMenu />
      </div>
    </header>
  )
}

export { WorkspaceHeader }
