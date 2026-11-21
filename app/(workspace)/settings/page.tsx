import { KeyRoundIcon, HardDriveIcon } from "lucide-react"

import { AppearanceSelector } from "@/components/appearance-selector"
import { Separator } from "@/components/ui/separator"

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <p className="text-sm/relaxed text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function UnavailablePanel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm/relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage how Aestry looks and where your data lives.
        </p>
      </div>
      <SettingsSection
        title="Appearance"
        description="Choose how Aestry looks on this device. System follows your operating system preference."
      >
        <AppearanceSelector />
      </SettingsSection>
      <Separator />
      <SettingsSection
        title="AI providers"
        description="Aestry uses bring-your-own-key access to image generation providers. Nothing is configured or stored yet."
      >
        <UnavailablePanel icon={<KeyRoundIcon />} title="No providers configured">
          Provider configuration arrives in an upcoming release. Until then, no
          API keys are requested, stored, or shared.
        </UnavailablePanel>
      </SettingsSection>
      <Separator />
      <SettingsSection
        title="Data &amp; storage"
        description="Aestry is designed to be local-first and self-hostable."
      >
        <UnavailablePanel icon={<HardDriveIcon />} title="Local storage not enabled">
          Prompts and generated assets are intended to live in your browser, not
          on a server. Persistence is not enabled in this version, so nothing is
          stored between visits yet.
        </UnavailablePanel>
      </SettingsSection>
    </div>
  )
}
