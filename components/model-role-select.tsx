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
  resolveSelection,
  useProviders,
  type ModelCapability,
  type ProviderModel,
  type ProviderRole,
} from "@/lib/provider-store"

/**
 * Explicit role selector over every provider's discovered models. Used on
 * the Providers page (full form context) and inside the conversation
 * composer (quick switching). Nothing is selected implicitly.
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
  const providers = useProviders((state) => state.providers)
  const selection = useProviders((state) => state.selections[role])
  const setSelection = useProviders((state) => state.setSelection)
  const selectId = `model-role-${role}`

  const options = providers.flatMap((provider) =>
    (provider.models ?? [])
      .filter((model: ProviderModel) => model.capability === capability)
      .map((model) => ({
        value: `${provider.id}::${model.id}`,
        label: `${provider.label} · ${model.id}`,
      }))
  )

  const resolved = resolveSelection(providers, selection)
  const currentValue = resolved
    ? `${resolved.provider.id}::${resolved.model}`
    : null
  const stale = Boolean(selection) && !resolved

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
            setSelection(role, { providerId, model })
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
      ) : (
        <p className="text-xs text-muted-foreground">
          Load models for a provider first.
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
