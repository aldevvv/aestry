import { NextResponse } from "next/server"

import { requireAccess } from "@/lib/server/access"
import {
  clearProviderLogs,
  getProviderLogs,
} from "@/lib/server/logs"

/**
 * Provider diagnostics for the Terminal page. Operator-access gated: the
 * ring buffer contains operational metadata that anonymous visitors on a
 * shared deployment must not read or erase. Entries are written through the
 * allowlisted diagnostic schema; excerpts only exist when the operator
 * enabled AESTRY_ENABLE_DIAGNOSTICS.
 */

export async function GET(request: Request): Promise<NextResponse> {
  const denial = requireAccess(request)
  if (denial) return denial
  return NextResponse.json({ logs: getProviderLogs() })
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const denial = requireAccess(request)
  if (denial) return denial
  clearProviderLogs()
  return NextResponse.json({ logs: [] })
}
