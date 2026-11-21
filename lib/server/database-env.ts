import { z } from "zod"

/**
 * Server-only database provider detection. Connection strings are read
 * exclusively here and are never echoed back — the UI receives provider
 * identities and statuses only.
 *
 * Detection rules: a provider counts as configured when its dedicated
 * connection string is present. When several are present at once,
 * AESTRY_DATABASE_PROVIDER must name the intended one — Aestry never
 * silently picks a database.
 */

export const DATABASE_PROVIDER_IDS = ["supabase", "neon", "postgres"] as const

export type DatabaseProviderId = (typeof DATABASE_PROVIDER_IDS)[number]

export function isDatabaseProviderId(
  value: string
): value is DatabaseProviderId {
  return (DATABASE_PROVIDER_IDS as readonly string[]).includes(value)
}

const providerSelectionSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => (value === "" ? undefined : value))
  .refine(
    (value) => value === undefined || isDatabaseProviderId(value),
    "AESTRY_DATABASE_PROVIDER must be one of: supabase, neon, postgres"
  )

function connectionStringFor(
  providerId: DatabaseProviderId
): string | undefined {
  const envKey =
    providerId === "supabase"
      ? "SUPABASE_DATABASE_URL"
      : providerId === "neon"
        ? "NEON_DATABASE_URL"
        : "DATABASE_URL"
  const value = process.env[envKey]?.trim()
  return value ? value : undefined
}

export type DatabaseProviderSummary = {
  id: DatabaseProviderId
  label: string
  kind: "postgresql"
  /** Which env variable backs this provider, e.g. SUPABASE_DATABASE_URL. */
  envVar: string
  configured: boolean
  setupHint: string
}

export type DatabaseEnvReading = {
  providers: DatabaseProviderSummary[]
  /** The provider used for operations, when unambiguous. */
  activeProvider?: DatabaseProviderId
  /** Present when multiple configs exist without an explicit selection. */
  ambiguous?: DatabaseProviderId[]
  errors: string[]
}

const LABELS: Record<DatabaseProviderId, string> = {
  supabase: "Supabase PostgreSQL",
  neon: "Neon PostgreSQL",
  postgres: "Generic PostgreSQL",
}

const HINTS: Record<DatabaseProviderId, string> = {
  supabase: "Set SUPABASE_DATABASE_URL in the server environment (the pooled connection string from your Supabase project).",
  neon: "Set NEON_DATABASE_URL in the server environment (the pooled connection string from your Neon project).",
  postgres: "Set DATABASE_URL in the server environment for any reachable PostgreSQL instance.",
}

/**
 * Reads database provider configuration. Pure over the environment; no
 * connections are attempted here and no values are logged.
 */
export function readDatabaseProviderConfigs(): DatabaseEnvReading {
  const errors: string[] = []
  const selection = providerSelectionSchema.safeParse(
    process.env.AESTRY_DATABASE_PROVIDER ?? ""
  )
  if (!selection.success) {
    errors.push(
      "AESTRY_DATABASE_PROVIDER is invalid — it must be one of: supabase, neon, postgres."
    )
  }
  const selected =
    selection.success && selection.data !== undefined
      ? (selection.data as DatabaseProviderId)
      : undefined

  const configured: DatabaseProviderId[] = []
  for (const providerId of DATABASE_PROVIDER_IDS) {
    if (connectionStringFor(providerId)) configured.push(providerId)
  }

  if (selected && !configured.includes(selected)) {
    errors.push(
      `AESTRY_DATABASE_PROVIDER names ${selected}, but its connection string is not configured.`
    )
  }

  let activeProvider: DatabaseProviderId | undefined
  let ambiguous: DatabaseProviderId[] | undefined
  if (configured.length === 1) {
    activeProvider = configured[0]
  } else if (configured.length > 1) {
    if (selected && configured.includes(selected)) {
      activeProvider = selected
    } else {
      ambiguous = configured
      errors.push(
        "Multiple database connection strings are configured — set AESTRY_DATABASE_PROVIDER to choose one explicitly."
      )
    }
  } else if (selected && !configured.includes(selected)) {
    // Already reported above.
  }

  return {
    providers: DATABASE_PROVIDER_IDS.map((providerId) => ({
      id: providerId,
      label: LABELS[providerId],
      kind: "postgresql" as const,
      envVar:
        providerId === "supabase"
          ? "SUPABASE_DATABASE_URL"
          : providerId === "neon"
            ? "NEON_DATABASE_URL"
            : "DATABASE_URL",
      configured: configured.includes(providerId),
      setupHint: HINTS[providerId],
    })),
    activeProvider,
    ambiguous,
    errors,
  }
}

/** The connection string for an active provider, or null. Never logged. */
export function activeDatabaseConnectionString():
  | { providerId: DatabaseProviderId; connectionString: string }
  | null {
  const reading = readDatabaseProviderConfigs()
  if (!reading.activeProvider) return null
  const connectionString = connectionStringFor(reading.activeProvider)
  return connectionString
    ? { providerId: reading.activeProvider, connectionString }
    : null
}
