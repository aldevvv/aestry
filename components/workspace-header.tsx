"use client"

import { usePathname } from "next/navigation"

import { RouteSearch } from "@/components/route-search"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { getPageTitle } from "@/lib/app-nav"

function WorkspaceHeader() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <span className="text-sm font-medium text-foreground">
        {getPageTitle(pathname)}
      </span>
      <div className="ml-auto flex items-center">
        <RouteSearch />
      </div>
    </header>
  )
}

export { WorkspaceHeader }
