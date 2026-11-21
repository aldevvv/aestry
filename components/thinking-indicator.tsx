"use client"

import * as React from "react"
import { ThinkingOrb, type OrbState } from "thinking-orbs"

/**
 * The varied orb/label states used across Aestry. Both the orb animation and
 * the label rotate while an operation runs, so nothing reads as a static
 * spinner.
 */
export type ThinkingActivity = "consult" | "generate" | "compact" | "models"

/** Orb states each activity cycles through; the one registry every orb consumer shares. */
export const ACTIVITY_STATES: Record<ThinkingActivity, OrbState[]> = {
  consult: ["working", "weaving", "searching", "solving", "connecting"],
  generate: ["composing", "weaving", "working", "searching", "breathing"],
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

/**
 * The welcome orb is ambient: it cycles the consultation states with no
 * status semantics, so conversation screens keep all activity labeling.
 */
export const WELCOME_ORB_ACTIVITY: ThinkingActivity = "consult"

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/** Live prefers-reduced-motion flag; false during SSR and before hydration. */
function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  )
}

function useRotatingIndex(
  length: number,
  intervalMs: number,
  active = true,
): number {
  const [index, setIndex] = React.useState(0)
  React.useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      setIndex((previous) => (previous + 1) % length)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [active, length, intervalMs])
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
  const states = ACTIVITY_STATES[activity]
  const reducedMotion = usePrefersReducedMotion()
  // Reduced motion keeps a single stable state; the orb package itself then
  // paints one static frame instead of animating.
  const index = useRotatingIndex(states.length, 2600, !reducedMotion)
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

/**
 * Ambient dashboard orb for the welcome screen. Shares the conversation
 * rotation engine and states, but carries no activity semantics: no label,
 * no elapsed timer, hidden from assistive tech, and never implying that a
 * request is running. Reduced motion renders one stable state.
 */
export function WelcomeOrb({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={className}>
      <ActivityOrb activity={WELCOME_ORB_ACTIVITY} size={64} />
    </div>
  )
}
