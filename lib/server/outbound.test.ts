import { afterEach, describe, expect, it, vi } from "vitest"

import {
  fetchImageBounded,
  OutboundUrlError,
  safeFetch,
  safeFetchJson,
  validateOutboundUrl,
} from "./outbound"

describe("validateOutboundUrl", () => {
  it("accepts public http(s) endpoints", () => {
    expect(validateOutboundUrl("https://api.example.com/v1").hostname).toBe(
      "api.example.com"
    )
    expect(validateOutboundUrl("http://api.openai.com").protocol).toBe("http:")
  })

  it("rejects malformed and non-http URLs", () => {
    expect(() => validateOutboundUrl("not a url")).toThrow(OutboundUrlError)
    expect(() => validateOutboundUrl("file:///etc/passwd")).toThrow(OutboundUrlError)
    expect(() => validateOutboundUrl("ftp://example.com")).toThrow(OutboundUrlError)
  })

  it("rejects credentials embedded in the URL", () => {
    expect(() => validateOutboundUrl("https://user:pass@api.example.com")).toThrow(
      OutboundUrlError
    )
  })

  it("rejects loopback, private ranges, and metadata hosts", () => {
    for (const url of [
      "http://localhost:8080",
      "http://127.0.0.1:3000",
      "http://10.1.2.3/v1",
      "http://192.168.1.10/v1",
      "http://172.16.0.5/v1",
      "http://169.254.169.254/latest/meta-data",
      "http://100.100.100.100",
      "http://[::1]/v1",
      "http://[fd00::1]/v1",
      "http://metadata.google.internal/computeMetadata",
      "http://api.localhost/v1",
      "http://service.internal/v1",
    ]) {
      expect(() => validateOutboundUrl(url), url).toThrow(OutboundUrlError)
    }
  })

  it("allows private addresses only behind the explicit opt-in", () => {
    vi.stubEnv("AESTRY_ALLOW_PRIVATE_ENDPOINTS", "true")
    expect(
      validateOutboundUrl("http://127.0.0.1:1234/v1").hostname
    ).toBe("127.0.0.1")
    // Cloud metadata stays blocked even with the opt-in.
    expect(() => validateOutboundUrl("http://169.254.169.254/latest")).toThrow(
      OutboundUrlError
    )
    vi.unstubAllEnvs()
  })
})

describe("fetchImageBounded", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("downloads a valid image and returns base64", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(bytes, {
          headers: { "Content-Type": "image/png" },
        })
      )
    )
    const image = await fetchImageBounded("https://cdn.example.com/image.png")
    expect(image.mimeType).toBe("image/png")
    expect(new Uint8Array(Buffer.from(image.base64, "base64"))).toEqual(bytes)
  })

  it("rejects non-image content types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { headers: { "Content-Type": "text/html" } }))
    )
    await expect(
      fetchImageBounded("https://cdn.example.com/not-an-image")
    ).rejects.toThrow(OutboundUrlError)
  })

  it("enforces the size cap while streaming", async () => {
    const big = new Uint8Array(64 * 1024)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(big, { headers: { "Content-Type": "image/png" } }))
    )
    await expect(
      fetchImageBounded("https://cdn.example.com/big.png", 1024)
    ).rejects.toThrow(OutboundUrlError)
  })

  it("does not follow redirects into restricted addresses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://169.254.169.254/latest/meta-data" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      fetchImageBounded("https://cdn.example.com/redirect.png")
    ).rejects.toThrow(OutboundUrlError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("safeFetch redirect credential safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps credentials on a same-origin redirect", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: url.toString(), init })
        if (calls.length === 1) {
          return new Response(null, {
            status: 307,
            headers: { Location: "https://api.example.com/v1/renamed" },
          })
        }
        return new Response("{}")
      })
    )
    const response = await safeFetch("https://api.example.com/v1/models", {
      headers: { Authorization: "Bearer sk-test" },
    })
    expect(response.ok).toBe(true)
    expect(calls.length).toBe(2)
    const forwarded = new Headers(calls[1].init?.headers)
    expect(forwarded.get("authorization")).toBe("Bearer sk-test")
  })

  it("strips credential headers on a cross-origin redirect", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: url.toString(), init })
        if (calls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { Location: "https://cdn.other.example/download" },
          })
        }
        return new Response("{}")
      })
    )
    const response = await safeFetch("https://api.example.com/v1/files", {
      headers: {
        Authorization: "Bearer sk-test",
        "x-goog-api-key": "AIza-secret",
        Cookie: "session=abc",
      },
    })
    expect(response.ok).toBe(true)
    expect(calls.length).toBe(2)
    expect(calls[1].url).toBe("https://cdn.other.example/download")
    const forwarded = new Headers(calls[1].init?.headers)
    expect(forwarded.get("authorization")).toBeNull()
    expect(forwarded.get("x-goog-api-key")).toBeNull()
    expect(forwarded.get("cookie")).toBeNull()
  })

  it("downgrades 303 redirects to body-less GETs", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: url.toString(), init })
        if (calls.length === 1) {
          return new Response(null, {
            status: 303,
            headers: { Location: "https://api.example.com/v1/other" },
          })
        }
        return new Response("{}")
      })
    )
    await safeFetch("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { Authorization: "Bearer sk-test" },
      body: JSON.stringify({ big: "payload" }),
    })
    expect(calls[1].init?.method).toBe("GET")
    expect(calls[1].init?.body).toBeUndefined()
  })

  it("still refuses restricted redirect destinations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, {
          status: 307,
          headers: { Location: "http://127.0.0.1:6379/" },
        })
      )
    )
    await expect(
      safeFetch("https://api.example.com/v1/models", {
        headers: { Authorization: "Bearer sk-test" },
      })
    ).rejects.toThrow(OutboundUrlError)
  })
})

describe("safeFetchJson bounded reads", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("rejects oversized bodies that hide their size from content-length", async () => {
    const big = "x".repeat(64 * 1024)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(big, { headers: { "Content-Type": "application/json" } }))
    )
    const result = await safeFetchJson<unknown>("https://api.example.com/data", {
      maxBytes: 1024,
    })
    expect(result.ok).toBe(false)
  })

  it("parses JSON bodies under the cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"ok":true}'))
    )
    const result = await safeFetchJson<{ ok: boolean }>("https://api.example.com/data")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.ok).toBe(true)
  })
})
