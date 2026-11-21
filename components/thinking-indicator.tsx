"use client"

import * as React from "react"
import { ThinkingOrb, type OrbState } from "thinking-orbs"

/**
 * The varied orb/label states used across Aestry. Both the orb animation and
 * the label rotate while an operation runs, so nothing reads as a static
 * spinner.
 */
export type ThinkingActivity = "consult" | "generate" | "compact" | "models"

const ACTIVITY_STATES: Record<ThinkingActivity, OrbState[]> = {
  consult: ["working", "weaving", "shaping", "solving", "connecting"],
  generate: ["composing", "shaping", "working", "weaving", "breathing"],
  compact: ["solving", "working", "breathing"],
  models: ["connecting", "working", "breathing"],
}

const ACTIVITY_PHRASES: Record<ThinkingActivity, string[]> = {
  consult: [
    "Thinking",
    "Working",
    "Weaving Ideas",
    "Shaping Direction",
    "Connecting The Dots",
  ],
  generate: ["Generating", "Composing", "Shaping", "Rendering", "Working"],
  compact: ["Compacting", "Summarizing", "Working"],
  models: ["Load Skills", "Connecting", "Loading Models"],
}

function useRotatingIndex(length: number, intervalMs: number): number {
  const [index, setIndex] = React.useState(0)
  React.useEffect(() => {
    const timer = setInterval(() => {
      setIndex((previous) => (previous + 1) % length)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [length, intervalMs])
  return index
}

/** A single animated orb for the given activity, theme auto-detected. */
export function ActivityOrb({
  activity,
  size = 20,
  paused,
}: {
  activity: ThinkingActivity
  size?: 20 | 32 | 64
  paused?: boolean
}) {
  const index = useRotatingIndex(ACTIVITY_STATES[activity].length, 2600)
  const states = ACTIVITY_STATES[activity]
  return (
    <ThinkingOrb
      state={states[index % states.length]}
      size={size}
      paused={paused}
    />
  )
}

/**
 * Orb + rotating label + elapsed-seconds timer. The label sits to the right
 * of the orb at reduced opacity, chat-style.
 */
export function ThinkingOrbIndicator({
  activity,
  className,
}: {
  activity: ThinkingActivity
  className?: string
}) {
  const phrases = ACTIVITY_PHRASES[activity]
  const index = useRotatingIndex(phrases.length, 2400)
  const [seconds, setSeconds] = React.useState(0)
  React.useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((previous) => previous + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div
      className={`flex items-center gap-2.5 ${className ?? ""}`}
      role="status"
      aria-live="polite"
    >
      <ActivityOrb activity={activity} size={20} />
      <span className="text-[13px] text-muted-foreground/70">
        {phrases[index % phrases.length]}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground/70">
        {seconds.toString()}s
      </span>
    </div>
  )
}
