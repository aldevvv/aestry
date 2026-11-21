"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const

// SSR-safe hydration detector: the server snapshot is false, the client
// snapshot is true, and React re-syncs after hydration without any effects.
const subscribeNever = () => () => {}

function AppearanceSelector() {
  const { theme, setTheme } = useTheme()
  const mounted = React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )

  if (!mounted) {
    return <div aria-hidden="true" className="h-9 w-63 rounded-lg bg-muted" />
  }

  return (
    <Tabs value={theme} onValueChange={(value) => setTheme(value)}>
      <TabsList aria-label="Appearance">
        {THEME_OPTIONS.map((option) => (
          <TabsTrigger key={option.value} value={option.value} className="px-3">
            <option.icon />
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

export { AppearanceSelector }
