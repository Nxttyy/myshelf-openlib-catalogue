import { useState } from 'react'

/** Only follow same-site paths from ?next=, never an outside URL. */
export function safeNext(raw: string | null, fallback: string) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : fallback
}

export const MIN_PASSWORD = 8
export const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())

/** Errors appear once a field has been left, or after the first submit. */
export function useTouched<K extends string>() {
  const [touched, setTouched] = useState<Partial<Record<K, boolean>>>({})
  const [tried, setTried] = useState(false)
  return {
    tried,
    setTried,
    seen: (k: K) => tried || !!touched[k],
    blur: (k: K) => () => setTouched((t) => ({ ...t, [k]: true })),
  }
}
