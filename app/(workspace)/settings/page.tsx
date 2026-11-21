import type { Metadata } from "next"
import Link from "next/link"
import { HardDriveIcon, KeyRoundIcon } from "lucide-react"

import { AccessLogin } from "@/components/access-login"
import { AppearanceSelector } from "@/components/appearance-selector"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

export const metadata: Metadata = {
  title: "Settings",
}

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
        <div className="text-sm/relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
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
        title="Server access"
        description="When AESTRY_ACCESS_SECRET is set on the server, provider operations require operator sign-in on this browser."
      >
        <AccessLogin />
      </SettingsSection>
      <Separator />
      <SettingsSection
        title="AI providers"
        description="Provider credentials live in the server environment and never reach the browser. Verify connections and choose role models on the providers page."
      >
        <UnavailablePanel icon={<KeyRoundIcon />} title="Manage your providers">
          The built-in Google Gemini Developer API and Google Vertex AI
          integrations are configured through the server environment.
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            render={<Link href="/providers" />}
            nativeButton={false}
          >
            Go to Providers
          </Button>
        </UnavailablePanel>
      </SettingsSection>
      <Separator />
      <SettingsSection
        title="Data &amp; storage"
        description="Aestry is designed to be local-first and self-hostable."
      >
        <UnavailablePanel icon={<HardDriveIcon />} title="Local-first storage">
          Conversations, reference images, and generated assets are stored in
          this browser (IndexedDB). Generated images remain in your asset
          library even if their conversation is deleted. Server-side
          database persistence is planned.
        </UnavailablePanel>
      </SettingsSection>
    </div>
  )
}
