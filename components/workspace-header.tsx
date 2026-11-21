"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"

// SSR-safe hydration detector: the server snapshot is false, the client
// snapshot is true, and React re-syncs after hydration without any effects.
const subscribeNever = () => () => {}

function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  const mounted = React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )
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

function WorkspaceHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3">
      <SidebarTrigger className="-ml-1" />
      <div className="ml-auto flex items-center">
        <ThemeMenu />
      </div>
    </header>
  )
}

export { WorkspaceHeader }
