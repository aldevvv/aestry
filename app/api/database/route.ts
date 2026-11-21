import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { requireAccessForRead, SESSION_COOKIE_NAME } from "@/lib/server/access"
import { readDatabaseProviderConfigs } from "@/lib/server/database-env"

/**
 * GET /api/database — sanitized database provider statuses. Provider
 * identities and configuration presence only; connection strings and
 * hosts never cross this boundary. The cookies() read marks the route as
 * runtime under cacheComponents, so the access check always runs against
 * the real request.
 */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies()
  const denial = requireAccessForRead(
    cookieStore.get(SESSION_COOKIE_NAME)?.value
  )
  if (denial) return denial
  const reading = readDatabaseProviderConfigs()
  return NextResponse.json({
    providers: reading.providers,
    activeProvider: reading.activeProvider,
    ambiguous: reading.ambiguous,
    errors: reading.errors,
  })
}
