"use client"

import * as React from "react"
import { LockIcon, LockOpenIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useMounted } from "@/hooks/use-mounted"

/**
 * Operator access surface. Reports whether the server requires sign-in
 * (AESTRY_ACCESS_SECRET configured) and provides the login form. The
 * browser only ever holds the derived HttpOnly session cookie.
 */

type AccessStatus = {
  configured: boolean
  authenticated: boolean
}

async function fetchStatus(): Promise<AccessStatus | null> {
  try {
    const response = await fetch("/api/auth/status", { cache: "no-store" })
    const data: unknown = await response.json().catch(() => null)
    if (
      data &&
      typeof data === "object" &&
      typeof (data as { configured?: unknown }).configured === "boolean"
    ) {
      const record = data as { configured: boolean; authenticated?: unknown }
      return {
        configured: record.configured,
        authenticated: record.authenticated === true,
      }
    }
    return null
  } catch {
    return null
  }
}

export function AccessLogin() {
  const mounted = useMounted()
  const [status, setStatus] = React.useState<AccessStatus | null>(null)
  const [secret, setSecret] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(() => {
    void fetchStatus().then((next) => {
      if (next) setStatus(next)
    })
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!secret.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secret.trim() }),
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        setError(
          data &&
          typeof data === "object" &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Sign-in failed."
        )
        return
      }
      setSecret("")
      refresh()
      toast.success("Signed in as the operator")
    } catch {
      setError("Could not reach the Aestry server.")
    } finally {
      setSubmitting(false)
    }
  }

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } finally {
      refresh()
    }
  }

  if (!mounted) {
    return <div className="h-14 animate-pulse rounded-xl border border-border bg-muted/50" />
  }

  if (status === null) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        Access status could not be read from the server.
      </div>
    )
  }

  if (!status.configured) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
          <LockOpenIcon />
        </span>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="font-medium text-foreground">Access protection is disabled</p>
          <p className="text-sm/relaxed text-muted-foreground">
            Anyone who can reach this server can use its provider operations.
            Set AESTRY_ACCESS_SECRET in the server environment to require
            operator sign-in, then restart the server.
          </p>
        </div>
      </div>
    )
  }

  if (status.authenticated) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
          <ShieldCheckIcon />
        </span>
        <p className="min-w-0 flex-1 text-sm text-foreground">
          Signed in as the operator on this browser.
        </p>
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => void signIn(event)}
      noValidate
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <LockIcon className="size-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Operator sign-in</p>
      </div>
      <p className="text-sm/relaxed text-muted-foreground">
        This server requires operator access for provider operations. Enter
        the access secret from the server environment (AESTRY_ACCESS_SECRET).
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="access-secret">Access secret</Label>
        <div className="flex gap-2">
          <Input
            id="access-secret"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "access-secret-error" : undefined}
          />
          <Button type="submit" disabled={submitting || secret.trim().length === 0}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </div>
        {error ? (
          <p id="access-secret-error" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  )
}
