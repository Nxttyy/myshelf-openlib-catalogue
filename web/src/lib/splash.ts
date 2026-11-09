import { useEffect } from 'react'

declare global {
  interface Window { DoraSplashDone?: () => void }
}

/** Lift the launch splash (index.html) once the calling shell has drawn. */
export function useSplashDone() {
  useEffect(() => { window.DoraSplashDone?.() }, [])
}
