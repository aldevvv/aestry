import { NextResponse } from "next/server"

import { getProviderSummariesWithErrors } from "@/lib/providers/registry"
import { requireAccess } from "@/lib/server/access"

/**
 * GET /api/providers — sanitized, environment-aware provider statuses.
 * Presence and configuration states only: no API keys, no project ids, no
 * location values, no credential material of any kind.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const denial = requireAccess(request)
  if (denial) return denial
  const { summaries, configErrors } = getProviderSummariesWithErrors()
  return NextResponse.json({ providers: summaries, configErrors })
}
