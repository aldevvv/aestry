"use client"

import { useTheme } from "next-themes"
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { useMounted } from "@/hooks/use-mounted"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const

function AppearanceSelector() {
  const { theme, setTheme } = useTheme()
  // next-themes resolves the persisted theme on the client only; render a
  // stable placeholder until mounted so SSR markup always matches hydration.
  const mounted = useMounted()

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
