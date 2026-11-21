import { MODE_FRAMES, resolvePreset } from "thinking-orbs"
import { describe, expect, it } from "vitest"
import {
  ACTIVITY_STATES,
  WELCOME_ORB_ACTIVITY,
} from "@/components/thinking-indicator"

describe("orb activity registry", () => {
  it("welcome orb cycles multiple shared consultation states", () => {
    const states = ACTIVITY_STATES[WELCOME_ORB_ACTIVITY]
    expect(states.length).toBeGreaterThanOrEqual(2)
  })

  it("every activity state resolves to a renderable animation in the installed package", () => {
    for (const [activity, states] of Object.entries(ACTIVITY_STATES)) {
      for (const state of states) {
        for (const size of [20, 64] as const) {
          const resolved = resolvePreset(state, size)
          expect(
            MODE_FRAMES,
            `${activity} state "${state}" at size ${size}`,
          ).toHaveProperty(resolved.mode)
        }
      }
    }
  })
})
