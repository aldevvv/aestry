import { beforeEach, describe, expect, it } from "vitest"

import {
  acquireSlot,
  loginThrottled,
  readJsonBody,
  recordLoginFailure,
  resetLoginThrottle,
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
  it("saturates and releases", () => {
    const first = acquireSlot("test-ops", 2)
    const second = acquireSlot("test-ops", 2)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(acquireSlot("test-ops", 2)).toBeNull()
    first?.release()
    expect(acquireSlot("test-ops", 2)).not.toBeNull()
    second?.release()
  })

  it("release is idempotent: double release never underflows the counter", () => {
    const slot = acquireSlot("double-release", 1)
    slot?.release()
    expect(slot?.released).toBe(true)
    // A second (buggy or defensive) release must be a no-op.
    slot?.release()
    // The slot is fully available again — exactly one was returned.
    const reclaimed = acquireSlot("double-release", 1)
    expect(reclaimed).not.toBeNull()
    reclaimed?.release()
  })

  it("release after an exception path still restores availability", () => {
    const attempt = (): void => {
      const slot = acquireSlot("error-path", 1)
      try {
        throw new Error("simulated failure")
      } finally {
        slot?.release()
      }
    }
    expect(attempt).toThrow("simulated failure")
    expect(acquireSlot("error-path", 1)).not.toBeNull()
  })

  it("tracks the released flag for ownership assertions", () => {
    const slot = acquireSlot("flag-check", 1)
    expect(slot?.released).toBe(false)
    slot?.release()
    expect(slot?.released).toBe(true)
  })

  it("withSlot runs work inside a slot and rejects when saturated", async () => {
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
