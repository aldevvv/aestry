"use client"

import * as React from "react"
import Image from "next/image"
import { toast } from "sonner"
import {
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  PlugIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ActivityOrb } from "@/components/thinking-indicator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMounted } from "@/hooks/use-mounted"
import {
  GOOGLE_PROVIDER_LABEL,
  PROVIDER_KIND_LABELS,
  collectFieldErrors,
  googleFormSchema,
  isInsecureEndpoint,
  maskApiKey,
  openAiCompatibleFormSchema,
  useProviders,
  type ModelCapability,
  type ProviderConfig,
  type ProviderKind,
  type ProviderModel,
  type ProviderRole,
} from "@/lib/provider-store"
import { ModelRoleSelect } from "@/components/model-role-select"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

type ModelState = {
  models: ProviderModel[]
  multimodal: string
  image: string
  multimodalManual: string
  imageManual: string
  loading: boolean
  error: string | null
}

const idleModelState: ModelState = {
  models: [],
  multimodal: "",
  image: "",
  multimodalManual: "",
  imageManual: "",
  loading: false,
  error: null,
}

function modelLabel(models: ProviderModel[], id: string): string {
  const model = models.find((item) => item.id === id)
  return model?.label ?? id
}

/**
 * Asks the Aestry server to list the models an API key can access, bucketed
 * into multimodal (chat, brainstorming, reference images) and image
 * generation. The key travels only to this self-hosted server and straight
 * on to the provider endpoint.
 */
async function requestModels(payload: {
  kind: ProviderKind
  apiKey: string
  baseUrl?: string
}): Promise<{ models: ProviderModel[] } | { error: string }> {
  try {
    const response = await fetch("/api/providers/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      return {
        error:
          isRecord(data) && typeof data.error === "string"
            ? data.error
            : "Could not load models.",
      }
    }
    if (!isRecord(data) || !Array.isArray(data.models)) {
      return { error: "The provider response could not be read." }
    }
    const models: ProviderModel[] = []
    for (const item of data.models) {
      if (
        isRecord(item) &&
        typeof item.id === "string" &&
        (item.capability === "multimodal" || item.capability === "image")
      ) {
        models.push({
          id: item.id,
          capability: item.capability,
          label: typeof item.label === "string" ? item.label : undefined,
          contextWindow:
            typeof item.contextWindow === "number"
              ? item.contextWindow
              : undefined,
        })
      }
    }
    return { models }
  } catch {
    return { error: "Could not reach the Aestry server." }
  }
}

function ApiKeyField({
  id,
  value,
  onChange,
  error,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
}) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>API key</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="pr-9"
        />
        <button
          type="button"
          onClick={() => setVisible((previous) => !previous)}
          aria-label={visible ? "Hide API key" : "Show API key"}
          aria-pressed={visible}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          {visible ? (
            <EyeOffIcon className="size-4" />
          ) : (
            <EyeIcon className="size-4" />
          )}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function FormField({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

function CapabilitySelector({
  id,
  capability,
  providerKind,
  models,
  value,
  onChange,
}: {
  id: string
  capability: ModelCapability
  providerKind: ProviderKind
  models: ProviderModel[]
  value: string
  onChange: (id: string) => void
}) {
  const options = models.filter((model) => model.capability === capability)
  const label =
    capability === "multimodal" ? "Multimodal model" : "Image generation model"
  const hint =
    capability === "multimodal"
      ? "For brainstorming, chatting, and reading reference images."
      : "For generating app icons, logos, and OG images."

  return (
    <FormField label={label} htmlFor={id} hint={hint}>
      {options.length > 0 ? (
        <Select
          value={value || null}
          onValueChange={(value) => {
            if (typeof value === "string") {
              onChange(value)
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full" aria-label={label}>
            <SelectValue>
              {(selected) =>
                typeof selected === "string" && selected
                  ? modelLabel(models, selected)
                  : "Choose a model"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    {providerKind === "google" ? (
                      <Image
                        src="/images/Gemini.svg"
                        alt=""
                        width={16}
                        height={16}
                        unoptimized
                        className="size-4 shrink-0"
                      />
                    ) : null}
                    <span className="truncate">
                      {model.label && model.label !== model.id
                        ? model.label
                        : model.id}
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {model.id}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <>
          <Input
            id={`${id}-manual`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={
              capability === "multimodal"
                ? "Multimodal model id, e.g. gemini-2.5-flash"
                : "Image model id, e.g. gemini-2.5-flash-image"
            }
            autoComplete="off"
            aria-label={`${label} (manual)`}
          />
          <p className="text-xs text-muted-foreground">
            No {capability === "multimodal" ? "multimodal" : "image generation"}{" "}
            models were reported for this key — enter the model id manually.
          </p>
        </>
      )}
    </FormField>
  )
}

function ProviderRow({
  provider,
  onRemove,
}: {
  provider: ProviderConfig
  onRemove: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
        {provider.kind === "google" ? <KeyRoundIcon /> : <PlugIcon />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">
            {provider.label}
          </p>
          <Badge variant="secondary">
            {PROVIDER_KIND_LABELS[provider.kind]}
          </Badge>
        </div>
        <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
          {provider.imageModel ? (
            <p className="truncate">Image · {provider.imageModel}</p>
          ) : null}
          {provider.multimodalModel ? (
            <p className="truncate">
              Multimodal · {provider.multimodalModel}
            </p>
          ) : null}
          <p className="truncate">
            {[provider.baseUrl, `Key ${maskApiKey(provider.apiKey)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${provider.label}`}
            >
              <Trash2Icon />
            </Button>
          }
        />
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {provider.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              The stored API key is deleted from this browser. You can add the
              provider again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              onClick={onRemove}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function AddProviderForm() {
  const providers = useProviders((state) => state.providers)
  const addProvider = useProviders((state) => state.addProvider)
  const [kind, setKind] = React.useState<ProviderKind>("google")
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  const [googleApiKey, setGoogleApiKey] = React.useState("")
  const [googleModelState, setGoogleModelState] =
    React.useState<ModelState>(idleModelState)

  const [customLabel, setCustomLabel] = React.useState("")
  const [customBaseUrl, setCustomBaseUrl] = React.useState("")
  const [customApiKey, setCustomApiKey] = React.useState("")
  const [customModelState, setCustomModelState] =
    React.useState<ModelState>(idleModelState)

  const hasGoogle = providers.some((provider) => provider.kind === "google")
  const insecureCustomEndpoint =
    customBaseUrl.trim().length > 0 &&
    isInsecureEndpoint(customBaseUrl.trim())

  const isProviderKind = (value: string): value is ProviderKind =>
    value === "google" || value === "openai-compatible"

  const googleMultimodal =
    googleModelState.multimodal || googleModelState.multimodalManual.trim()
  const googleImage = googleModelState.image || googleModelState.imageManual.trim()
  const googleReady = Boolean(googleMultimodal && googleImage)

  const customMultimodal =
    customModelState.multimodal || customModelState.multimodalManual.trim()
  const customImage = customModelState.image || customModelState.imageManual.trim()
  const customReady = Boolean(customMultimodal && customImage)

  const loadGoogleModels = async () => {
    setGoogleModelState({ ...idleModelState, loading: true })
    const result = await requestModels({
      kind: "google",
      apiKey: googleApiKey.trim(),
    })
    if ("error" in result) {
      setGoogleModelState({ ...idleModelState, error: result.error })
      return
    }
    setGoogleModelState({ ...idleModelState, models: result.models })
  }

  const loadCustomModels = async () => {
    setCustomModelState({ ...idleModelState, loading: true })
    const result = await requestModels({
      kind: "openai-compatible",
      apiKey: customApiKey.trim(),
      baseUrl: customBaseUrl.trim(),
    })
    if ("error" in result) {
      setCustomModelState({ ...idleModelState, error: result.error })
      return
    }
    setCustomModelState({ ...idleModelState, models: result.models })
  }

  const submitGoogle = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = googleFormSchema.safeParse({ apiKey: googleApiKey })
    if (!result.success) {
      setErrors(collectFieldErrors(result.error))
      return
    }
    if (!googleReady) return
    addProvider({
      id: crypto.randomUUID(),
      kind: "google",
      label: GOOGLE_PROVIDER_LABEL,
      apiKey: result.data.apiKey,
      multimodalModel: googleMultimodal,
      imageModel: googleImage,
      models: googleModelState.models.length
        ? googleModelState.models
        : undefined,
      createdAt: new Date().toISOString(),
    })
    toast.success("Google Gemini saved in this browser")
    setGoogleApiKey("")
    setGoogleModelState(idleModelState)
    setErrors({})
  }

  const submitCustom = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = openAiCompatibleFormSchema.safeParse({
      label: customLabel,
      baseUrl: customBaseUrl,
      apiKey: customApiKey,
    })
    if (!result.success) {
      setErrors(collectFieldErrors(result.error))
      return
    }
    if (!customReady) return
    addProvider({
      id: crypto.randomUUID(),
      kind: "openai-compatible",
      label: result.data.label,
      baseUrl: result.data.baseUrl.replace(/\/+$/, ""),
      apiKey: result.data.apiKey,
      multimodalModel: customMultimodal,
      imageModel: customImage,
      models: customModelState.models.length
        ? customModelState.models
        : undefined,
      createdAt: new Date().toISOString(),
    })
    toast.success(`${result.data.label} saved in this browser`)
    setCustomLabel("")
    setCustomBaseUrl("")
    setCustomApiKey("")
    setCustomModelState(idleModelState)
    setErrors({})
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={kind}
        onValueChange={(value) => {
          if (typeof value === "string" && isProviderKind(value)) {
            setKind(value)
            setErrors({})
          }
        }}
      >
        <TabsList aria-label="Provider type">
          <TabsTrigger value="google" className="px-2.5">
            Google Gemini
          </TabsTrigger>
          <TabsTrigger value="openai-compatible" className="px-2.5">
            OpenAI-compatible
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {kind === "google" ? (
        hasGoogle ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm/relaxed text-muted-foreground">
            Google Gemini is already configured. Remove it in the list above if
            you want to replace the stored key.
          </p>
        ) : (
          <form
            onSubmit={submitGoogle}
            noValidate
            className="flex flex-col gap-4"
          >
            <ApiKeyField
              id="google-api-key"
              value={googleApiKey}
              onChange={setGoogleApiKey}
              error={errors.apiKey}
              placeholder="Paste your Gemini API key"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadGoogleModels()}
                disabled={
                  googleModelState.loading || googleApiKey.trim().length === 0
                }
              >
                {googleModelState.loading ? (
                  <>
                    <ActivityOrb activity="models" size={20} />
                    Loading…
                  </>
                ) : (
                  "Load models"
                )}
              </Button>
              <Button type="submit" disabled={!googleReady}>
                Add Google Gemini
              </Button>
            </div>
            {googleModelState.error ? (
              <p className="text-xs text-destructive">
                {googleModelState.error}
              </p>
            ) : null}
            {googleModelState.models.length > 0 ? (
              <div className="flex flex-col gap-4">
                <CapabilitySelector
                  id="google-multimodal"
                  capability="multimodal"
                  providerKind="google"
                  models={googleModelState.models}
                  value={googleModelState.multimodal}
                  onChange={(id) =>
                    setGoogleModelState((state) => ({
                      ...state,
                      multimodal: id,
                    }))
                  }
                />
                <CapabilitySelector
                  id="google-image"
                  capability="image"
                  providerKind="google"
                  models={googleModelState.models}
                  value={googleModelState.image}
                  onChange={(id) =>
                    setGoogleModelState((state) => ({ ...state, image: id }))
                  }
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Load models to verify the key and pick a multimodal and an
                image generation model from what it can actually access.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Create a free key at{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Google AI Studio
              </a>
              .
            </p>
          </form>
        )
      ) : (
        <form
          onSubmit={submitCustom}
          noValidate
          className="flex flex-col gap-4"
        >
          <FormField
            label="Name"
            htmlFor="custom-label"
            error={errors.label}
            hint="Only visible to you — e.g. OpenRouter or a local endpoint."
          >
            <Input
              id="custom-label"
              value={customLabel}
              onChange={(event) => setCustomLabel(event.target.value)}
              placeholder="My provider"
              autoComplete="off"
              aria-invalid={errors.label ? true : undefined}
              aria-describedby={
                errors.label ? "custom-label-error" : undefined
              }
            />
          </FormField>
          <FormField
            label="Base URL"
            htmlFor="custom-base-url"
            error={errors.baseUrl}
            hint="OpenAI-compatible API root, e.g. https://api.example.com/v1."
          >
            <Input
              id="custom-base-url"
              value={customBaseUrl}
              onChange={(event) => setCustomBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              autoComplete="off"
              inputMode="url"
              aria-invalid={errors.baseUrl ? true : undefined}
              aria-describedby={
                errors.baseUrl ? "custom-base-url-error" : undefined
              }
            />
          </FormField>
          {insecureCustomEndpoint ? (
            <p
              className="flex items-start gap-2 text-xs text-warning"
              role="note"
            >
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This endpoint uses HTTP, so the API key travels unencrypted.
                Fine for trusted local networks — prefer HTTPS otherwise.
              </span>
            </p>
          ) : null}
          <ApiKeyField
            id="custom-api-key"
            value={customApiKey}
            onChange={setCustomApiKey}
            error={errors.apiKey}
            placeholder="Paste the API key"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadCustomModels()}
              disabled={
                customModelState.loading ||
                customApiKey.trim().length === 0 ||
                customBaseUrl.trim().length === 0
              }
            >
              {customModelState.loading ? (
                <>
                  <ActivityOrb activity="models" size={20} />
                  Loading…
                </>
              ) : (
                "Load models"
              )}
            </Button>
            <Button type="submit" disabled={!customReady}>
              Add provider
            </Button>
          </div>
          {customModelState.error ? (
            <p className="text-xs text-destructive">
              {customModelState.error}
            </p>
          ) : null}
          {customModelState.models.length > 0 ? (
            <div className="flex flex-col gap-4">
              <CapabilitySelector
                id="custom-multimodal"
                capability="multimodal"
                providerKind="openai-compatible"
                models={customModelState.models}
                value={customModelState.multimodal}
                onChange={(id) =>
                  setCustomModelState((state) => ({
                    ...state,
                    multimodal: id,
                  }))
                }
              />
              <CapabilitySelector
                id="custom-image"
                capability="image"
                providerKind="openai-compatible"
                models={customModelState.models}
                value={customModelState.image}
                onChange={(id) =>
                  setCustomModelState((state) => ({ ...state, image: id }))
                }
              />
            </div>
          ) : customModelState.error ? (
            <div className="flex flex-col gap-4">
              <CapabilitySelector
                id="custom-multimodal"
                capability="multimodal"
                providerKind="openai-compatible"
                models={[]}
                value={customModelState.multimodalManual}
                onChange={(id) =>
                  setCustomModelState((state) => ({
                    ...state,
                    multimodalManual: id,
                  }))
                }
              />
              <CapabilitySelector
                id="custom-image"
                capability="image"
                providerKind="openai-compatible"
                models={[]}
                value={customModelState.imageManual}
                onChange={(id) =>
                  setCustomModelState((state) => ({
                    ...state,
                    imageManual: id,
                  }))
                }
              />
            </div>
          ) : null}
        </form>
      )}
    </div>
  )
}

function ActiveModelRole({
  role,
  capability,
  label,
  hint,
}: {
  role: ProviderRole
  capability: ModelCapability
  label: string
  hint: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <ModelRoleSelect role={role} capability={capability} label={label} />
      <p className="text-xs text-muted-foreground">{hint}</p>
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
        <ActiveModelRole
          role="consultation"
          capability="multimodal"
          label="Consultation model"
          hint="Powers the design consultant in conversations."
        />
        <ActiveModelRole
          role="generation"
          capability="image"
          label="Image generation model"
          hint="Produces assets when you approve a brief."
        />
      </div>
    </section>
  )
}

function ProvidersManager() {
  const providers = useProviders((state) => state.providers)
  const removeProvider = useProviders((state) => state.removeProvider)
  const mounted = useMounted()
  // Persisted state rehydrates synchronously on the client, which would
  // diverge from the server-rendered empty list; render placeholders until
  // hydration completes.
  const visible = mounted ? providers : []

  return (
    <div className="flex flex-col gap-8">
      <ActiveModelsSection />
      <section
        className="flex flex-col gap-4"
        aria-labelledby="providers-list-heading"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="providers-list-heading"
            className="text-sm font-medium text-foreground"
          >
            Configured providers
          </h2>
          <p className="text-sm text-muted-foreground">
            {visible.length === 1
              ? "1 provider is stored in this browser."
              : `${visible.length.toString()} providers are stored in this browser.`}
          </p>
        </div>
        {visible.length === 0 ? (
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
              <PlugIcon />
            </span>
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <p className="font-medium text-foreground">No providers yet</p>
              <p className="text-sm/relaxed text-muted-foreground">
                Add one below to make it available to the composer.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                onRemove={() => {
                  removeProvider(provider.id)
                  toast.success(`${provider.label} removed`)
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section
        className="flex flex-col gap-4"
        aria-labelledby="providers-add-heading"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="providers-add-heading"
            className="text-sm font-medium text-foreground"
          >
            Add a provider
          </h2>
          <p className="text-sm text-muted-foreground">
            Use the built-in Google Gemini integration, or point at any
            OpenAI-compatible endpoint. Available models are loaded from the
            provider itself, split into multimodal and image generation roles.
          </p>
        </div>
        <AddProviderForm />
      </section>
    </div>
  )
}

export { ProvidersManager }
