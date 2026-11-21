import { NextResponse } from "next/server"

import { accessSecret, requireAccess } from "@/lib/server/access"

/**
 * GET /api/auth/status — non-sensitive access state for the UI. Reports
 * whether protection is configured and whether this browser holds a valid
 * operator session. No secrets, no deployment details.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = accessSecret()
  if (secret === null) {
    return NextResponse.json({ configured: false, authenticated: false })
  }
  const denial = requireAccess(request)
  return NextResponse.json({ configured: true, authenticated: denial === null })
}
