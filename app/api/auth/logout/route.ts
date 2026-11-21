import { NextResponse } from "next/server"

import { sessionCookieOptions } from "@/lib/server/access"

/** POST /api/auth/logout — clears the operator session cookie. */
export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true })
  response.cookies.set({ ...sessionCookieOptions(0), value: "" })
  return response
}
