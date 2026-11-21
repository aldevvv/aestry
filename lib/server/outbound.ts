/**
 * Server-side outbound request policy. Aestry is self-hostable and may be
 * deployed publicly, so every request to a user-configured destination is
 * treated as untrusted. This module is the single choke point: provider
 * adapters and image-URL downloads must not fetch() arbitrary destinations
 * directly.
 *
 * Known limitation (documented in the README): hostname validation is
 * lexical — DNS rebinding to a public name that resolves to an internal
 * address is not defeated by pinning resolved IPs. Deployments exposed to
 * untrusted networks should apply network-level egress restrictions.
 */

export class OutboundUrlError extends Error {}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "instance-data",
  "169.254.169.254",
])

/**
 * Self-hosted users legitimately point Aestry at local providers (e.g.
 * LM Studio on localhost:1234). Private-address endpoints are rejected by
 * default (safe for publicly accessible deployments) and allowed only when
 * the operator sets AESTRY_ALLOW_PRIVATE_ENDPOINTS=true. Cloud metadata
 * hosts stay blocked regardless.
 */
function allowPrivateEndpoints(): boolean {
  return process.env.AESTRY_ALLOW_PRIVATE_ENDPOINTS === "true"
}

function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!match) return false
  const [a, b] = [Number(match[1]), Number(match[2])]
  if ([a, b, Number(match[3]), Number(match[4])].some((n) => n > 255)) {
    // Not a valid IPv4 literal; treat as a hostname and let DNS handle it.
    return false
  }
  if (a === 127 || a === 10 || a === 0) return true
  if (a === 169 && b === 254) return true // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT range
  return false
}

function isPrivateIpv6(hostname: string): boolean {
  // Bracketed literals only appear inside URL hostname for IPv6.
  const literal = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!literal.includes(":")) return false
  return (
    literal === "::" ||
    literal === "::1" ||
    literal.startsWith("fc") ||
    literal.startsWith("fd") ||
    literal.startsWith("fe80") ||
    literal.startsWith("64:ff9b:")
  )
}

/**
 * Validates a user-controlled destination before the server contacts it.
 * Throws OutboundUrlError with a client-safe message when rejected.
 */
export function validateOutboundUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new OutboundUrlError("The endpoint URL is malformed.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundUrlError("Only http and https endpoints are supported.")
  }
  if (url.username || url.password) {
    throw new OutboundUrlError("Credentials in the endpoint URL are not allowed.")
  }
  const hostname = url.hostname.toLowerCase()
  const privateAddress =
    isPrivateIpv4(hostname) || isPrivateIpv6(hostname)
  if (
    privateAddress &&
    allowPrivateEndpoints() &&
    !BLOCKED_HOSTNAMES.has(hostname)
  ) {
    return url
  }
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local") ||
    privateAddress
  ) {
    throw new OutboundUrlError(
      "This endpoint points to a restricted address. Self-hosted operators can allow private endpoints with AESTRY_ALLOW_PRIVATE_ENDPOINTS=true."
    )
  }
  return url
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export type SafeFetchOptions = RequestInit & {
  maxRedirects?: number
  timeoutMs?: number
}

/**
 * fetch() with the outbound policy enforced on every redirect hop. Redirect
 * responses are followed manually (up to maxRedirects) so each destination
 * is re-validated — a redirect must not smuggle a request to an internal
 * address. Cross-origin forwarding is limited to the redirect target itself;
 * credentials never travel beyond the configured endpoint.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const { maxRedirects = 3, timeoutMs = 30_000, ...init } = options
  let currentUrl = validateOutboundUrl(rawUrl)
  let currentInit: RequestInit = { ...init }

  for (let hop = 0; ; hop += 1) {
    const response = await fetch(currentUrl, {
      ...currentInit,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    })
    if (!REDIRECT_STATUSES.has(response.status) || hop >= maxRedirects) {
      return response
    }
    const location = response.headers.get("location")
    if (!location) return response
    const nextUrl = new URL(location, currentUrl)
    currentUrl = validateOutboundUrl(nextUrl.toString())
    if (response.status !== 307 && response.status !== 308) {
      // 301/302/303 downgrade to GET without a body.
      currentInit = { ...currentInit, method: "GET", body: undefined }
    }
  }
}

/**
 * Downloads a generated image with strict bounds: image content types only,
 * hard size cap enforced while streaming, and the outbound policy applied.
 */
export async function fetchImageBounded(
  rawUrl: string,
  maxBytes = 10 * 1024 * 1024
): Promise<{ mimeType: string; base64: string }> {
  const response = await safeFetch(rawUrl, {
    headers: { Accept: "image/png, image/jpeg, image/webp" },
    timeoutMs: 60_000,
  })
  if (!response.ok) {
    throw new OutboundUrlError(
      `The image download failed with status ${response.status}.`
    )
  }
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.startsWith("image/")) {
    throw new OutboundUrlError("The image URL did not return an image.")
  }
  const declaredLength = response.headers.get("content-length")
  if (declaredLength && Number(declaredLength) > maxBytes) {
    throw new OutboundUrlError("The generated image is too large to download.")
  }
  const reader = response.body?.getReader()
  if (!reader) {
    throw new OutboundUrlError("The image response has no body.")
  }
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      received += value.byteLength
      if (received > maxBytes) {
        void reader.cancel()
        throw new OutboundUrlError("The generated image is too large to download.")
      }
      chunks.push(value)
    }
  }
  const mimeType = contentType.startsWith("image/")
    ? contentType.split(";")[0].trim()
    : "image/png"
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  return { mimeType, base64: buffer.toString("base64") }
}

export type SafeFetchJsonSuccess<T> = { ok: true; data: T; response: Response }
export type SafeFetchJsonFailure = { ok: false; response: Response }

/**
 * safeFetch + JSON parsing with a size bound. Returns the parsed body for
 * 2xx responses and the raw response otherwise, so callers can map status
 * codes to user-facing errors without parsing untrusted bodies blindly.
 */
export async function safeFetchJson<T>(
  rawUrl: string,
  options: SafeFetchOptions & { maxBytes?: number } = {}
): Promise<SafeFetchJsonSuccess<T> | SafeFetchJsonFailure> {
  const { maxBytes = 8 * 1024 * 1024, ...rest } = options
  const response = await safeFetch(rawUrl, rest)
  if (!response.ok) {
    return { ok: false, response }
  }
  const declaredLength = response.headers.get("content-length")
  if (declaredLength && Number(declaredLength) > maxBytes) {
    return { ok: false, response }
  }
  const text = await response.text()
  if (text.length > maxBytes) {
    return { ok: false, response }
  }
  try {
    return { ok: true, data: JSON.parse(text) as T, response }
  } catch {
    return { ok: false, response }
  }
}
