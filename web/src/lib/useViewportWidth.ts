import { useSyncExternalStore } from 'react'

const subscribe = (cb: () => void) => {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

/** Viewport width in CSS px, for components (covers) that need a number. */
export const useViewportWidth = () => useSyncExternalStore(subscribe, () => window.innerWidth)
