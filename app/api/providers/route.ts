import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { getProviderSummariesWithErrors } from "@/lib/providers/registry"
import { requireAccessForRead, SESSION_COOKIE_NAME } from "@/lib/server/access"

/**
 * GET /api/providers — sanitized, environment-aware provider statuses.
 * Presence and configuration states only: no API keys, no project ids, no
 * location values, no credential material of any kind. The cookies() read
 * marks the route as runtime under cacheComponents, so the access check
 * always runs against the real request.
 */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies()
  const denial = requireAccessForRead(
    cookieStore.get(SESSION_COOKIE_NAME)?.value
  )
  if (denial) return denial
  const { summaries, configErrors } = getProviderSummariesWithErrors()
  return NextResponse.json({ providers: summaries, configErrors })
}
