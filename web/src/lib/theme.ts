import { useSyncExternalStore } from 'react'

// Light or dark, from the design's account menu ("Theme: Light / Dark"):
// "Dora brand: light" is `th-brand`, "Dora brand: dark" adds `th-night`.
// The choice is per device. The classes go on <html> as well as on the app
// shell, so the brand's root colours (app.css) and anything rendered outside
// the shell (portals) follow the theme. index.html applies the stored choice
// before first paint, so a dark-mode reload never flashes light.

export type Theme = 'light' | 'dark'

const KEY = 'dora-theme'
const listeners = new Set<() => void>()

function read(): Theme {
  try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}

let current: Theme = read()

/** Class names for the app shell: `d-app f-grain kc ${themeClass(theme)} v2`. */
export function themeClass(theme: Theme) {
  return theme === 'dark' ? 'th-brand th-night' : 'th-brand'
}

function apply(theme: Theme) {
  const root = document.documentElement
  root.classList.add('th-brand')
  root.classList.toggle('th-night', theme === 'dark')
}

export function setTheme(theme: Theme) {
  current = theme
  try { localStorage.setItem(KEY, theme) } catch { /* private mode: this visit only */ }
  apply(theme)
  listeners.forEach((l) => l())
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => current,
  )
  return [theme, setTheme]
}

apply(current)
