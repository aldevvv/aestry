import { afterEach, describe, expect, it, vi } from "vitest"

import {
  fetchImageBounded,
  OutboundUrlError,
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
