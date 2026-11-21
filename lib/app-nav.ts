import {
  HistoryIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react"

export type AppNavItem = {
  href: "/" | "/history" | "/settings"
  label: string
  icon: LucideIcon
  group: "workspace" | "preferences"
}

export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    group: "workspace",
  },
  {
    href: "/history",
    label: "History",
    icon: HistoryIcon,
    group: "workspace",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    group: "preferences",
  },
]

export function getPageTitle(pathname: string): string {
  return (
    APP_NAV_ITEMS.find((item) => item.href === pathname)?.label ?? "Dashboard"
  )
}
