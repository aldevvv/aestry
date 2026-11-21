"use client"

import * as React from "react"
import {
  CloudIcon,
  KeyRoundIcon,
  PlugIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ActivityOrb } from "@/components/thinking-indicator"
import { useMounted } from "@/hooks/use-mounted"
import { ModelRoleSelect } from "@/components/model-role-select"
import {
  BUILTIN_PROVIDERS,
  providerLabel,
  useProviders,
  type BuiltinProviderId,
  type ProviderStatus,
} from "@/lib/provider-store"

/**
 * Environment-aware provider management. Aestry's credentials live in the
 * server environment, so this page reports sanitized statuses and lets the
 * operator verify connections and choose role models — it never collects
 * API keys.
 */

function StatusBadge({
  status,
  verification,
}: {
  status: ProviderStatus
  verification?: { verified: boolean; error?: string }
}) {
  if (verification?.verified) {
    return <Badge variant="secondary">Verified</Badge>
  }
  if (verification && !verification.verified) {
    return <Badge variant="destructive">Verification failed</Badge>
  }
  if (status.configured) {
    return <Badge variant="secondary">Configured</Badge>
  }
  return <Badge variant="outline">Not configured</Badge>
}

function ProviderCard({
  providerId,
  status,
}: {
  providerId: BuiltinProviderId
  status: ProviderStatus | undefined
}) {
  const loadModels = useProviders((state) => state.loadModels)
  const verifyProvider = useProviders((state) => state.verifyProvider)
  const loadingModels = useProviders((state) => state.loadingModels[providerId])
  const modelError = useProviders((state) => state.modelErrors[providerId])
  const verifying = useProviders((state) => state.verifying[providerId])
  const verification = useProviders(
    (state) => state.verification[providerId]
  )
  const models = useProviders(
    (state) => state.modelsCache[providerId] ?? []
  )

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
          {providerId === "gemini" ? <KeyRoundIcon /> : <CloudIcon />}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {providerLabel(providerId)}
        </p>
        {status ? (
          <StatusBadge status={status} verification={verification} />
        ) : (
          <Badge variant="outline">Checking…</Badge>
        )}
      </div>
      {status === undefined ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
      ) : !status.configured ? (
        <p className="text-sm/relaxed text-muted-foreground">{status.setupHint}</p>
      ) : (
        <>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <p>
              Authentication ·{" "}
              {status.connectionMode === "api-key"
                ? "API key from the server environment"
                : "Application Default Credentials"}
            </p>
            {status.configDetail.map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
            {status.chatModelOverride ? (
              <p>Default chat model pinned via environment</p>
            ) : null}
            {status.imageModelOverride ? (
              <p>Default image model pinned via environment</p>
            ) : null}
            {verification && !verification.verified && verification.error ? (
              <p className="text-destructive">{verification.error}</p>
            ) : null}
            {modelError ? <p className="text-destructive">{modelError}</p> : null}
            {models.length > 0 ? (
              <p>
                {models.filter((model) => model.capability === "multimodal").length}
                {" "}multimodal ·{" "}
                {models.filter((model) => model.capability === "image").length}
                {" "}image generation models
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void verifyProvider(providerId)}
              disabled={verifying}
            >
              {verifying ? (
                <>
                  <ActivityOrb activity="models" size={20} />
                  Verifying…
                </>
              ) : (
                <>
                  <ShieldCheckIcon />
                  Verify connection
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => void loadModels(providerId)}
              disabled={loadingModels}
            >
              {loadingModels ? (
                <>
                  <ActivityOrb activity="models" size={20} />
                  Loading…
                </>
              ) : (
                <>
                  <RefreshCwIcon />
                  Refresh models
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function ActiveModelsSection() {
  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="active-models-heading"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="active-models-heading"
          className="text-sm font-medium text-foreground"
        >
          Active models
        </h2>
        <p className="text-sm text-muted-foreground">
          Consultation and generation can use different providers. Nothing is
          selected implicitly — generation only runs on the model you choose.
        </p>
      </div>
      <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <ModelRoleSelect
            role="consultation"
            capability="multimodal"
            label="Consultation model"
          />
          <p className="text-xs text-muted-foreground">
            Powers the design consultant in conversations.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <ModelRoleSelect
            role="generation"
            capability="image"
            label="Image generation model"
          />
          <p className="text-xs text-muted-foreground">
            Produces assets when you approve a brief.
          </p>
        </div>
      </div>
    </section>
  )
}

function ProvidersManager() {
  const mounted = useMounted()
  const statuses = useProviders((state) => state.statuses)
  const statusError = useProviders((state) => state.statusError)
  const configErrors = useProviders((state) => state.configErrors)
  const refreshStatus = useProviders((state) => state.refreshStatus)
  const legacyCredentialsRemoved = useProviders(
    (state) => state.legacyCredentialsRemoved
  )
  const acknowledgeLegacyNotice = useProviders(
    (state) => state.acknowledgeLegacyNotice
  )

  React.useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  if (!mounted) {
    return <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/50" />
  }

  return (
    <div className="flex flex-col gap-8">
      {legacyCredentialsRemoved ? (
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
            <TriangleAlertIcon />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <p className="font-medium text-foreground">
              Browser-stored API keys are no longer used
            </p>
            <p className="text-sm/relaxed text-muted-foreground">
              Aestry now reads provider credentials from the server
              environment only. The keys previously saved in this browser
              were removed and were never transmitted anywhere — add them to
              the server&rsquo;s .env.local to use them again.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 self-start text-muted-foreground"
              onClick={acknowledgeLegacyNotice}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {statusError ? (
        <p className="flex items-start gap-2 text-sm text-warning" role="note">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{statusError}</span>
        </p>
      ) : null}
      {configErrors.map((error) => (
        <p
          key={error}
          className="flex items-start gap-2 text-sm text-warning"
          role="note"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ))}

      <section
        className="flex flex-col gap-4"
        aria-labelledby="providers-configured-heading"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="providers-configured-heading"
            className="text-sm font-medium text-foreground"
          >
            Built-in providers
          </h2>
          <p className="text-sm text-muted-foreground">
            Credentials are configured in the server environment and never
            reach the browser. A configured provider is not necessarily
            verified — use Verify connection for an explicit check.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {BUILTIN_PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider.id}
              providerId={provider.id}
              status={statuses?.find((entry) => entry.id === provider.id)}
            />
          ))}
        </div>
      </section>

      <ActiveModelsSection />

      <section
        className="flex flex-col gap-3"
        aria-labelledby="providers-upcoming-heading"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="providers-upcoming-heading"
            className="text-sm font-medium text-foreground"
          >
            Coming soon
          </h2>
          <p className="text-sm text-muted-foreground">
            Additional first-party integrations are planned. Custom
            OpenAI-compatible endpoints will return as a server-configured
            provider — they are not available in this version.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-border p-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
            <PlugIcon />
          </span>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Custom OpenAI-compatible endpoints
          </p>
          <Badge variant="secondary">Soon</Badge>
        </div>
      </section>
    </div>
  )
}

export { ProvidersManager }
