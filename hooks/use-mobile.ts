import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribeToMobileMediaQuery(callback: () => void) {
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMobileMediaQuery,
    () => window.matchMedia(MOBILE_MEDIA_QUERY).matches,
    // Server snapshot: assume desktop during SSR and the first client render;
    // React re-syncs from the media query after hydration.
    () => false
  )
}
