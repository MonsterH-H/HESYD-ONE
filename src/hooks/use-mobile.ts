import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Détection du viewport mobile via useSyncExternalStore : l'abonnement matchMedia
 * est un store externe (pas d'état local ni d'effet), le fallback serveur reste
 * `false` — comportement identique à l'ancien pattern useState + useEffect.
 */
export function useIsMobile() {
  const subscribe = React.useCallback((callback: () => void) => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", callback)
    return () => mql.removeEventListener("change", callback)
  }, [])
  const snapshot = React.useCallback(() => window.innerWidth < MOBILE_BREAKPOINT, [])
  const isMobile = React.useSyncExternalStore(subscribe, snapshot, () => false)
  return isMobile
}
