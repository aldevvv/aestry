import postgres from "postgres"

/**
 * Bounded, read-only PostgreSQL health check shared by all three database
 * providers (Supabase, Neon, and generic PostgreSQL are wire-compatible
 * for this purpose). The check runs `SELECT 1` with tight timeouts, never
 * mutates, never runs migrations, and reports sanitized results.
 */

export type DatabaseHealthResult =
  | { verified: true; latencyMs: number; serverVersion?: string }
  | { verified: false; latencyMs: number; errorCategory: string; error: string }

const CONNECT_TIMEOUT_SECONDS = 5

export async function checkDatabaseHealth(
  connectionString: string
): Promise<DatabaseHealthResult> {
  const startedAt = Date.now()
  let sql: postgres.Sql | null = null
  try {
    sql = postgres(connectionString, {
      max: 1,
      connect_timeout: CONNECT_TIMEOUT_SECONDS,
      idle_timeout: 5,
      max_lifetime: 60,
      // Providers hand out pooler endpoints with their own TLS; postgres.js
      // negotiates from the connection string's sslmode.
      prepare: false,
    })
    const result = await sql`select version() as version`
    const version =
      typeof result[0]?.version === "string"
        ? result[0].version.split(" ").slice(0, 2).join(" ")
        : undefined
    return {
      verified: true,
      latencyMs: Date.now() - startedAt,
      serverVersion: version,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    return {
      verified: false,
      latencyMs: Date.now() - startedAt,
      errorCategory: /timeout|connect/i.test(message)
        ? "network"
        : /password|authentication/i.test(message)
          ? "auth"
          : /ssl|tls/i.test(message)
            ? "tls"
            : "upstream",
      error: "The database could not be reached with the configured connection string.",
    }
  } finally {
    if (sql) {
      try {
        await sql.end({ timeout: 2 })
      } catch {
        // Closing must never mask the check's own result.
      }
    }
  }
}
