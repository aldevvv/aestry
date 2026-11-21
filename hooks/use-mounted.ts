import * as React from "react"

// SSR-safe hydration detector: the server snapshot is false, the client
// snapshot is true, and React re-syncs after hydration without any effects.
const subscribeNever = () => () => {}

export function useMounted() {
  return React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )
}
