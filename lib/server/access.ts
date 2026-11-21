import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

/**
 * Single-operator access control for privileged endpoints.
 *
 * When AESTRY_ACCESS_SECRET is configured, every privileged request must
 * carry a session cookie holding an HMAC token derived from the secret —
 * the secret itself never travels to the browser. When it is not
 * configured, the deployment runs in explicit unprotected mode: writes are
 * still limited to same-origin browser requests (defeating drive-by
 * cross-site calls), and the gap is surfaced in the UI instead of hidden.
 * Non-browser callers on a trusted network remain within operator trust in
 * that mode, which is documented as a deployment risk.
 */

const SESSION_COOKIE = "aestry_session"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function accessSecret(): string | null {
  const secret = process.env.AESTRY_ACCESS_SECRET?.trim()
  return secret ? secret : null
}

export function isAccessConfigured(): boolean {
  return accessSecret() !== null
}

function sessionSignature(secret: string, expiry: number): string {
  return createHmac("sha256", secret)
    .update(`aestry-session:${expiry.toString()}`)
    .digest("hex")
}

/** A derived, expiring token — never the raw secret. */
export function createSessionToken(secret: string, now = Date.now()): string {
  const expiry = now + SESSION_TTL_MS
  return `${expiry.toString()}.${sessionSignature(secret, expiry)}`
}

export function verifySessionToken(token: string, secret: string): boolean {
  const separator = token.lastIndexOf(".")
  if (separator <= 0) return false
  const expiry = Number(token.slice(0, separator))
  const signature = token.slice(separator + 1)
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return false
  const expected = sessionSignature(secret, expiry)
  // SHA-256 hex digests have a fixed length, so timingSafeEqual is safe here.
  const a = createHash("sha256").update(signature).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_TTL_MS / 1000) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  }
}

function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie")
  if (!header) return null
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name === SESSION_COOKIE) return rest.join("=")
  }
  return null
}

/**
 * Same-origin check for browser-sent state-changing requests. Browsers
 * attach Origin to cross-site (and same-site) POST/DELETE fetches; a
 * mismatch means the call was not initiated by this application.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return true // non-browser caller or a plain navigation
  let host = request.headers.get("host")
  if (!host) {
    // Some runtimes omit Host from the headers; the request URL carries it.
    try {
      host = new URL(request.url).host
    } catch {
      return false
    }
  }
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function denial(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status })
}

/**
 * Guard for privileged route handlers. Returns a NextResponse to send when
 * access is denied, or null when the request may proceed.
 */
export function requireAccess(request: Request): NextResponse | null {
  const secret = accessSecret()
  if (secret === null) {
    // Unprotected mode. State-changing methods must at least originate from
    // this application's own origin; reads stay open (documented risk).
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method)
    if (mutating && !isSameOriginRequest(request)) {
      return denial(
        403,
        "Cross-site requests are rejected. Use the Aestry app directly."
      )
    }
    return null
  }
  const token = readSessionCookie(request)
  if (token && verifySessionToken(token, secret)) {
    return null
  }
  return denial(
    401,
    "Operator access is required. Sign in on the Terminal or Settings page."
  )
}

/** Timing-safe secret comparison for the login endpoint. */
export function secretsMatch(candidate: string, secret: string): boolean {
  const a = createHash("sha256").update(candidate).digest()
  const b = createHash("sha256").update(secret).digest()
  return timingSafeEqual(a, b)
}
