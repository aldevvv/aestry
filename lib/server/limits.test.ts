import { beforeEach, describe, expect, it } from "vitest"

import {
  loginThrottled,
  readJsonBody,
  recordLoginFailure,
  releaseSlot,
  resetLoginThrottle,
  tryAcquireSlot,
  withSlot,
} from "./limits"

describe("readJsonBody", () => {
  it("parses a JSON body under the cap", async () => {
    const request = new Request("https://aestry.local/api", {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
      headers: { "content-type": "application/json" },
    })
    const result = await readJsonBody(request, 1024)
    expect(result).toEqual({ ok: true, data: { hello: "world" } })
  })

  it("rejects oversized declared content-length without reading", async () => {
    const request = new Request("https://aestry.local/api", {
      method: "POST",
      body: "x",
      headers: { "content-length": "999999" },
    })
    const result = await readJsonBody(request, 1024)
    expect(result).toMatchObject({ ok: false, status: 413 })
  })

  it("caps unbounded streams even without content-length", async () => {
    const big = "a".repeat(4096)
    const request = new Request("https://aestry.local/api", {
      method: "POST",
      body: big,
    })
    const result = await readJsonBody(request, 1024)
    expect(result).toMatchObject({ ok: false, status: 413 })
  })

  it("rejects malformed JSON", async () => {
    const request = new Request("https://aestry.local/api", {
      method: "POST",
      body: "{nope",
    })
    const result = await readJsonBody(request, 1024)
    expect(result).toMatchObject({ ok: false, status: 400 })
  })
})

describe("concurrency slots", () => {
  it("saturates and releases", async () => {
    releaseSlot("test-ops")
    releaseSlot("test-ops")
    expect(tryAcquireSlot("test-ops", 2)).toBe(true)
    expect(tryAcquireSlot("test-ops", 2)).toBe(true)
    expect(tryAcquireSlot("test-ops", 2)).toBe(false)
    releaseSlot("test-ops")
    expect(tryAcquireSlot("test-ops", 2)).toBe(true)
    releaseSlot("test-ops")
    releaseSlot("test-ops")
  })

  it("withSlot runs work inside a slot and rejects when saturated", async () => {
    releaseSlot("with-slot")
    let running: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      running = resolve
    })
    const first = withSlot("with-slot", 1, async () => {
      await gate
      return "first"
    })
    const second = await withSlot("with-slot", 1, async () => "second")
    expect(second).toBeNull()
    running?.()
    await expect(first).resolves.toBe("first")
    releaseSlot("with-slot")
  })
})

describe("login throttle", () => {
  beforeEach(() => {
    resetLoginThrottle()
  })

  it("trips after ten failures and recovers on reset", () => {
    for (let index = 0; index < 9; index += 1) {
      recordLoginFailure()
      expect(loginThrottled()).toBe(false)
    }
    recordLoginFailure()
    expect(loginThrottled()).toBe(true)
    resetLoginThrottle()
    expect(loginThrottled()).toBe(false)
  })
})
