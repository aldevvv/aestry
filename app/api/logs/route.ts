import { NextResponse } from "next/server"

import {
  clearProviderLogs,
  getProviderLogs,
} from "@/lib/server/logs"

/**
 * Raw provider event log for the Terminal page. Entries are written
 * redacted at the source; this endpoint only serves what is already in the
 * ring buffer.
 */

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ logs: getProviderLogs() })
}

export async function DELETE(): Promise<NextResponse> {
  clearProviderLogs()
  return NextResponse.json({ logs: [] })
}
