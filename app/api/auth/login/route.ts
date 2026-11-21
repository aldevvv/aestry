import { NextResponse } from "next/server"
import { z } from "zod"

import {
  accessSecret,
  createSessionToken,
  isSameOriginRequest,
  secretsMatch,
  sessionCookieOptions,
} from "@/lib/server/access"
import { loginThrottled, readJsonBody, recordLoginFailure } from "@/lib/server/limits"

/**
 * POST /api/auth/login — exchanges the operator secret (AESTRY_ACCESS_SECRET)
 * for an HttpOnly session cookie. The secret is compared timing-safely and
 * never stored client-side; failed attempts are throttled per process.
 */

const bodySchema = z.object({
  secret: z.string().min(1).max(500),
})

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-site sign-in attempts are rejected." },
      { status: 403 }
    )
  }
  const secret = accessSecret()
  if (secret === null) {
    return NextResponse.json(
      {
        error:
          "Access control is not configured on this server. Set AESTRY_ACCESS_SECRET to require sign-in.",
      },
      { status: 400 }
    )
  }
  const body = await readJsonBody(request, 4_096)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status })
  }
  const parsed = bodySchema.safeParse(body.data)
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the access secret." }, { status: 400 })
  }
  if (loginThrottled()) {
    return NextResponse.json(
      { error: "Too many failed sign-in attempts — try again later." },
      { status: 429 }
    )
  }
  if (!secretsMatch(parsed.data.secret, secret)) {
    recordLoginFailure()
    return NextResponse.json({ error: "Incorrect access secret." }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    ...sessionCookieOptions(),
    value: createSessionToken(secret),
  })
  return response
}
