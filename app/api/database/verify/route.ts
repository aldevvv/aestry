import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAccess } from "@/lib/server/access"
import { checkDatabaseHealth } from "@/lib/server/database-health"
import {
  activeDatabaseConnectionString,
  isDatabaseProviderId,
  readDatabaseProviderConfigs,
} from "@/lib/server/database-env"
import { readJsonBody, withSlot } from "@/lib/server/limits"

/**
 * POST /api/database/verify — an explicit, bounded, read-only health check
 * (SELECT 1) against the configured database provider. Destructive
 * statements and migrations are never part of verification. Connection
 * strings stay server-side; results are sanitized.
 */

const bodySchema = z.object({
  providerId: z.string().refine(isDatabaseProviderId, "Unknown database provider."),
})

export async function POST(request: Request): Promise<NextResponse> {
  const denial = requireAccess(request)
  if (denial) return denial

  const body = await readJsonBody(request, 4_096)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status })
  }
  const parsedBody = bodySchema.safeParse(body.data)
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }
  const { providerId } = parsedBody.data

  const reading = readDatabaseProviderConfigs()
  const summary = reading.providers.find((provider) => provider.id === providerId)
  if (!summary?.configured) {
    return NextResponse.json(
      { error: `${summary?.label ?? providerId} is not configured on this server.` },
      { status: 400 }
    )
  }
  if (reading.activeProvider !== providerId) {
    return NextResponse.json(
      {
        error:
          "Several database configurations are present — set AESTRY_DATABASE_PROVIDER to choose one before verifying.",
      },
      { status: 409 }
    )
  }

  const result = await withSlot("database-verify", 1, async () => {
    const connection = activeDatabaseConnectionString()
    if (!connection || connection.providerId !== providerId) {
      return NextResponse.json(
        { error: "The database connection is not available." },
        { status: 409 }
      )
    }
    const health = await checkDatabaseHealth(connection.connectionString)
    return NextResponse.json({ ...health }, { status: 200 })
  })

  return (
    result ??
    NextResponse.json(
      { error: "A verification attempt is already running." },
      { status: 503 }
    )
  )
}
