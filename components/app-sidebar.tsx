"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { APP_NAV_ITEMS, type AppNavItem } from "@/lib/app-nav"

function SidebarBrand() {
  const { state } = useSidebar()

  return (
    <div className="flex h-12 items-center px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <Link
        href="/"
        aria-label="Aestry home"
        className="rounded-md px-1.5 py-0.5 text-[15px] font-semibold tracking-tight text-sidebar-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        {state === "collapsed" ? "a." : "aestry."}
      </Link>
    </div>
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

function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarNavGroup items={APP_NAV_ITEMS.filter((item) => item.group === "workspace")} />
        <SidebarNavGroup
          label="Preferences"
          items={APP_NAV_ITEMS.filter((item) => item.group === "preferences")}
        />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

export { AppSidebar }
