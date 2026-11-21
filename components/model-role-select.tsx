"use client"

import * as React from "react"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  BUILTIN_PROVIDERS,
  useProviders,
  type ModelCapability,
  type ProviderRole,
} from "@/lib/provider-store"

/**
 * Explicit role selector over the built-in providers' discovered models.
 * Used on the Providers page (full form context) and inside the
 * conversation composer (quick switching). Nothing is selected implicitly.
 */
export function ModelRoleSelect({
  role,
  capability,
  label,
}: {
  role: ProviderRole
  capability: ModelCapability
  label: string
}) {
  const statuses = useProviders((state) => state.statuses)
  const modelsCache = useProviders((state) => state.modelsCache)
  const selection = useProviders((state) => state.selections[role])
  const setSelection = useProviders((state) => state.setSelection)
  const refreshStatus = useProviders((state) => state.refreshStatus)
  const selectId = `model-role-${role}`

  React.useEffect(() => {
    if (statuses === null) {
      void refreshStatus()
    }
  }, [statuses, refreshStatus])

  const configuredIds = new Set(
    (statuses ?? []).filter((entry) => entry.configured).map((entry) => entry.id)
  )
  const options = BUILTIN_PROVIDERS.filter((provider) =>
    configuredIds.has(provider.id)
  ).flatMap((provider) =>
    (modelsCache[provider.id] ?? [])
      .filter((model) => model.capability === capability)
      .map((model) => ({
        value: `${provider.id}::${model.id}`,
        label: `${provider.label} · ${model.id}`,
      }))
  )

  const currentValue = selection
    ? `${selection.providerId}::${selection.model}`
    : null
  const stale = Boolean(selection) && !options.some((o) => o.value === currentValue)

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={selectId}>{label}</Label>
      {options.length > 0 ? (
        <Select
          value={currentValue}
          onValueChange={(value) => {
            if (typeof value !== "string") return
            const separator = value.indexOf("::")
            const providerId = value.slice(0, separator)
            const model = value.slice(separator + 2)
            setSelection(role, {
              providerId: providerId as "gemini" | "vertex",
              model,
            })
          }}
        >
          <SelectTrigger size="sm" className="w-full" id={selectId}>
            <SelectValue placeholder={`Choose a ${capability} model`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : configuredIds.size > 0 ? (
        <p className="text-xs text-muted-foreground">
          Load models for a configured provider on the Providers page first.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Configure a provider on the Providers page first.
        </p>
      )}
      {stale ? (
        <p className="text-xs text-warning">
          The previously selected model is no longer available — choose again.
        </p>
      ) : null}
    </div>
  )
}
