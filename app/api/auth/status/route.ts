import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  accessSecret,
  requireAccessForRead,
  SESSION_COOKIE_NAME,
} from "@/lib/server/access"

/**
 * GET /api/auth/status — non-sensitive access state for the UI. Reports
 * whether protection is configured and whether this browser holds a valid
 * operator session. No secrets, no deployment details. The cookies() read
 * happens on every execution — before any early return — so the route is
 * always runtime-evaluated under cacheComponents and never serves a stale
 * build-time answer.
 */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies()
  const secret = accessSecret()
  if (secret === null) {
    return NextResponse.json({ configured: false, authenticated: false })
  }
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const authenticated = requireAccessForRead(token) === null
  return NextResponse.json({ configured: true, authenticated })
}
