import { afterEach, describe, expect, it, vi } from "vitest"

import {
  accessMode,
  accessSecret,
  createSessionToken,
  isSameOriginRequest,
  requireAccess,
  requireAccessForRead,
  secretsMatch,
  verifySessionToken,
} from "./access"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("session tokens", () => {
  it("round-trips a derived token", () => {
    const token = createSessionToken("secret-1")
    expect(verifySessionToken(token, "secret-1")).toBe(true)
  })

  it("rejects tokens minted with a different secret", () => {
    const token = createSessionToken("secret-1")
    expect(verifySessionToken(token, "secret-2")).toBe(false)
  })

  it("rejects expired and malformed tokens", () => {
    // Minted 31 days ago: the 30-day TTL has elapsed.
    const expired = createSessionToken(
      "secret-1",
      Date.now() - 31 * 24 * 60 * 60 * 1000
    )
    expect(verifySessionToken(expired, "secret-1")).toBe(false)
    expect(verifySessionToken("garbage", "secret-1")).toBe(false)
    expect(verifySessionToken("123.not-a-signature", "secret-1")).toBe(false)
  })

  it("never embeds the raw secret in the token", () => {
    const token = createSessionToken("the-operator-secret")
    expect(token).not.toContain("the-operator-secret")
  })
})

describe("requireAccess", () => {
  it("permits reads and blocks cross-site writes when unconfigured", () => {
    vi.stubEnv("AESTRY_ACCESS_SECRET", "")
    expect(accessSecret()).toBeNull()

    const read = new Request("https://aestry.local/api/logs")
    expect(requireAccess(read)).toBeNull()

    const sameOriginWrite = new Request("https://aestry.local/api/chat", {
      method: "POST",
      headers: { origin: "https://aestry.local" },
    })
    expect(requireAccess(sameOriginWrite)).toBeNull()

    const crossSiteWrite = new Request("https://aestry.local/api/chat", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    })
    const denial = requireAccess(crossSiteWrite)
    expect(denial?.status).toBe(403)
  })

  it("requires a valid session when configured", () => {
    vi.stubEnv("AESTRY_ACCESS_SECRET", "secret-1")
    const request = () => new Request("https://aestry.local/api/chat", { method: "POST" })

    expect(requireAccess(request())?.status).toBe(401)

    const withCookie = new Request("https://aestry.local/api/chat", {
      method: "POST",
      headers: { cookie: `aestry_session=${createSessionToken("secret-1")}` },
    })
    expect(requireAccess(withCookie)).toBeNull()

    const withBadCookie = new Request("https://aestry.local/api/chat", {
      method: "POST",
      headers: { cookie: "aestry_session=1.deadbeef" },
    })
    expect(requireAccess(withBadCookie)?.status).toBe(401)
  })

  it("rejects cross-site mutations even when a session is present", () => {
    // CSRF defense in depth: SameSite=Strict is the primary layer; a
    // mismatched Origin is rejected regardless of session validity.
    vi.stubEnv("AESTRY_ACCESS_SECRET", "secret-1")
    const crossSite = new Request("https://aestry.local/api/chat", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        cookie: `aestry_session=${createSessionToken("secret-1")}`,
      },
    })
    expect(requireAccess(crossSite)?.status).toBe(403)
  })
})

describe("access modes", () => {
  it("is local-dev without a secret outside production", () => {
    vi.stubEnv("AESTRY_ACCESS_SECRET", "")
    expect(accessMode()).toBe("local-dev")
    const read = new Request("https://aestry.local/api/logs")
    expect(requireAccess(read)).toBeNull()
  })

  it("fails closed in production without a secret", () => {
    vi.stubEnv("AESTRY_ACCESS_SECRET", "")
    vi.stubEnv("NODE_ENV", "production")
    expect(accessMode()).toBe("blocked")

    const read = requireAccess(new Request("https://aestry.local/api/logs"))
    expect(read?.status).toBe(503)
    const write = requireAccess(
      new Request("https://aestry.local/api/chat", {
        method: "POST",
        headers: { origin: "https://aestry.local" },
      })
    )
    expect(write?.status).toBe(503)
    expect(requireAccessForRead(null)?.status).toBe(503)
    expect(read?.body).not.toBeNull()
  })

  it("supports an explicit local-mode opt-out", () => {
    vi.stubEnv("AESTRY_ACCESS_SECRET", "")
    vi.stubEnv("AESTRY_ALLOW_LOCAL_MODE", "false")
    expect(accessMode()).toBe("blocked")
    expect(requireAccess(new Request("https://aestry.local/api/logs"))?.status).toBe(503)
  })

  it("stays protected in production with a secret", () => {
    vi.stubEnv("AESTRY_ACCESS_SECRET", "secret-1")
    vi.stubEnv("NODE_ENV", "production")
    expect(accessMode()).toBe("protected")
    const withSession = new Request("https://aestry.local/api/chat", {
      method: "POST",
      headers: {
        origin: "https://aestry.local",
        cookie: `aestry_session=${createSessionToken("secret-1")}`,
      },
    })
    expect(requireAccess(withSession)).toBeNull()
  })
})

describe("isSameOriginRequest", () => {
  it("treats a missing Origin as same-origin and mismatches as cross-origin", () => {
    expect(
      isSameOriginRequest(new Request("https://aestry.local/api", { method: "POST" }))
    ).toBe(true)
    expect(
      isSameOriginRequest(
        new Request("https://aestry.local/api", {
          method: "POST",
          headers: { origin: "https://aestry.local" },
        })
      )
    ).toBe(true)
    expect(
      isSameOriginRequest(
        new Request("https://aestry.local/api", {
          method: "POST",
          headers: { origin: "https://other.example" },
        })
      )
    ).toBe(false)
  })
})

describe("secretsMatch", () => {
  it("compares timing-safely and rejects wrong values", () => {
    expect(secretsMatch("correct", "correct")).toBe(true)
    expect(secretsMatch("wrong", "correct")).toBe(false)
    expect(secretsMatch("", "correct")).toBe(false)
  })
})
