import {
  DatabaseIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LayoutTemplateIcon,
  SettingsIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react"

export type AppNavItem = {
  href: "/" | "/history" | "/settings" | "/providers" | "/database" | "/terminal"
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
  {
    href: "/providers",
    label: "Providers",
    icon: KeyRoundIcon,
    group: "preferences",
  },
  {
    href: "/database",
    label: "Database",
    icon: DatabaseIcon,
    group: "preferences",
  },
  {
    href: "/terminal",
    label: "Terminal",
    icon: TerminalIcon,
    group: "preferences",
  },
]

/**
 * Placeholder destinations shown in the sidebar with a "Soon" badge. They
 * are intentionally excluded from route search and stay non-interactive
 * until the features ship.
 */
export type UpcomingNavItem = {
  label: string
  icon: LucideIcon
}

export const UPCOMING_NAV_ITEMS: UpcomingNavItem[] = [
  { label: "Templates", icon: LayoutTemplateIcon },
]
