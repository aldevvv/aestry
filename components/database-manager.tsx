"use client"

import * as React from "react"
import { DatabaseIcon, HardDriveIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useMounted } from "@/hooks/use-mounted"

/**
 * Database integration dashboard. Aestry is local-first: IndexedDB always
 * works without any configuration. Server-side database providers report
 * their environment configuration here, with an explicit bounded health
 * check. Remote conversation persistence is planned, not implemented —
 * configuring a database never silently enables synchronization.
 */

type DatabaseProviderStatus = {
  id: "supabase" | "neon" | "postgres"
  label: string
  kind: "postgresql"
  envVar: string
  configured: boolean
  setupHint: string
}

type DatabaseStatusResponse = {
  providers: DatabaseProviderStatus[]
  activeProvider?: "supabase" | "neon" | "postgres"
  ambiguous?: string[]
  errors: string[]
}

type Verification = {
  verified: boolean
  latencyMs?: number
  serverVersion?: string
  error?: string
}

const UPCOMING_DATABASES = ["MySQL", "SQLite", "MongoDB"]

function DatabaseProviderCard({
  provider,
  active,
  onVerify,
  verifying,
  verification,
}: {
  provider: DatabaseProviderStatus
  active: boolean
  onVerify: () => void
  verifying: boolean
  verification?: Verification
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
          <DatabaseIcon />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {provider.label}
        </p>
        {active ? <Badge variant="secondary">Active</Badge> : null}
        <Badge variant={provider.configured ? "secondary" : "outline"}>
          {provider.configured ? "Configured" : "Not configured"}
        </Badge>
      </div>
      {!provider.configured ? (
        <p className="text-sm/relaxed text-muted-foreground">{provider.setupHint}</p>
      ) : (
        <>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <p>Database type · {provider.kind}</p>
            <p>Connection string · {provider.envVar} (values stay on the server)</p>
            {verification?.verified ? (
              <p>
                Last check passed · {verification.latencyMs?.toString() ?? "?"}ms
                {verification.serverVersion ? ` · ${verification.serverVersion}` : ""}
              </p>
            ) : null}
            {verification && !verification.verified && verification.error ? (
              <p className="text-destructive">{verification.error}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onVerify} disabled={verifying}>
              {verifying ? "Checking…" : "Run health check"}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function DatabaseManager() {
  const mounted = useMounted()
  const [status, setStatus] = React.useState<DatabaseStatusResponse | null>(null)
  const [statusError, setStatusError] = React.useState<string | null>(null)
  const [verifying, setVerifying] = React.useState<string | null>(null)
  const [verifications, setVerifications] = React.useState<
    Record<string, Verification | undefined>
  >({})

  const refresh = React.useCallback(() => {
    void (async () => {
      try {
        const response = await fetch("/api/database", { cache: "no-store" })
        const data: unknown = await response.json().catch(() => null)
        if (
          data &&
          typeof data === "object" &&
          Array.isArray((data as { providers?: unknown }).providers)
        ) {
          setStatus(data as DatabaseStatusResponse)
          setStatusError(null)
        } else if (response.status === 401) {
          setStatusError("Operator sign-in required to read database status.")
        } else {
          setStatusError("Database status could not be read from the server.")
        }
      } catch {
        setStatusError("Could not reach the Aestry server.")
      }
    })()
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const verify = async (providerId: string) => {
    if (verifying) return
    setVerifying(providerId)
    try {
      const response = await fetch("/api/database/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      })
      const data: unknown = await response.json().catch(() => null)
      if (response.status === 200 && data && typeof data === "object") {
        const result = data as {
          verified?: unknown
          latencyMs?: unknown
          serverVersion?: unknown
          error?: unknown
        }
        setVerifications((previous) => ({
          ...previous,
          [providerId]: {
            verified: result.verified === true,
            latencyMs:
              typeof result.latencyMs === "number" ? result.latencyMs : undefined,
            serverVersion:
              typeof result.serverVersion === "string"
                ? result.serverVersion
                : undefined,
            error: typeof result.error === "string" ? result.error : undefined,
          },
        }))
        if (result.verified === true) {
          toast.success("Database connection verified")
        }
      } else {
        const message =
          data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "The health check could not run."
        toast.error(message)
      }
    } catch {
      toast.error("Could not reach the Aestry server.")
    } finally {
      setVerifying(null)
    }
  }

  if (!mounted) {
    return <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/50" />
  }

  return (
    <div className="flex flex-col gap-8">
      {statusError ? (
        <p className="flex items-start gap-2 text-sm text-warning" role="note">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{statusError}</span>
        </p>
      ) : null}
      {status?.errors.map((error) => (
        <p
          key={error}
          className="flex items-start gap-2 text-sm text-warning"
          role="note"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ))}

      <section className="flex flex-col gap-4" aria-labelledby="database-storage-heading">
        <div className="flex flex-col gap-1">
          <h2
            id="database-storage-heading"
            className="text-sm font-medium text-foreground"
          >
            Storage mode
          </h2>
          <p className="text-sm/relaxed text-muted-foreground">
            Aestry is local-first: conversations, reference images, and
            generated assets are stored in this browser and work without any
            database configuration. Configuring a database below does not
            enable remote synchronization — that integration is planned and
            will be opt-in.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
            <HardDriveIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Browser storage (IndexedDB)</p>
            <p className="text-xs text-muted-foreground">
              Active — all data stays on this device.
            </p>
          </div>
          <Badge variant="secondary">Active</Badge>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-border p-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
            <DatabaseIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Remote persistence</p>
            <p className="text-xs text-muted-foreground">
              Planned — provider connections below can be verified, but Aestry
              does not store conversations or assets remotely yet.
            </p>
          </div>
          <Badge variant="outline">Planned</Badge>
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="database-providers-heading">
        <div className="flex flex-col gap-1">
          <h2
            id="database-providers-heading"
            className="text-sm font-medium text-foreground"
          >
            Configured providers
          </h2>
          <p className="text-sm text-muted-foreground">
            Connection strings are read from the server environment and never
            reach the browser. Health checks are read-only.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {(status?.providers ?? []).map((provider) => (
            <DatabaseProviderCard
              key={provider.id}
              provider={provider}
              active={status?.activeProvider === provider.id}
              verifying={verifying === provider.id}
              verification={verifications[provider.id]}
              onVerify={() => void verify(provider.id)}
            />
          ))}
          {status === null && !statusError ? (
            <>
              <div className="h-32 animate-pulse rounded-xl border border-border bg-muted/50" />
              <div className="h-32 animate-pulse rounded-xl border border-border bg-muted/50" />
            </>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="database-upcoming-heading">
        <div className="flex flex-col gap-1">
          <h2
            id="database-upcoming-heading"
            className="text-sm font-medium text-foreground"
          >
            Coming soon
          </h2>
          <p className="text-sm text-muted-foreground">
            Further database technologies are planned.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {UPCOMING_DATABASES.map((name) => (
            <div
              key={name}
              className="flex items-center gap-3 rounded-xl border border-dashed border-border p-3"
            >
              <DatabaseIcon className="size-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{name}</p>
              <Badge variant="secondary">Soon</Badge>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export { DatabaseManager }
