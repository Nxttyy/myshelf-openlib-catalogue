// Install-as-app state: whether the banner was dismissed (per device) and
// whether the steps sheet is open. See components/InstallApp.tsx.
import { useSyncExternalStore } from 'react'
import { useMediaQuery } from './useMediaQuery'

const KEY = 'dora-install-hidden-v2'
const listeners = new Set<() => void>()
const state = {
  hidden: (() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })(),
  open: false,
}
export function setInstall(patch: Partial<typeof state>) {
  Object.assign(state, patch)
  listeners.forEach((l) => l())
}
export const useInstall = <T,>(pick: (s: typeof state) => T) => useSyncExternalStore(
  (l) => { listeners.add(l); return () => listeners.delete(l) },
  () => pick(state),
)

/** Open the steps sheet (account menu → Install app). */
export const openInstallSteps = () => setInstall({ open: true })

/** Running from the home screen / dock rather than a browser tab. */
export const useInstalled = () => {
  const standalone = useMediaQuery('(display-mode: standalone)')
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function hideInstallBanner() {
  setInstall({ hidden: true })
  try { localStorage.setItem(KEY, '1') } catch { /* this visit only */ }
}
