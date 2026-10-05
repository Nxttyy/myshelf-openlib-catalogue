import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type Push, type ToastKind } from '../lib/toast'
import { useIsDesktop } from '../lib/useMediaQuery'

type Toast = { id: number; msg: string; kind: ToastKind; leaving?: boolean }

// Timings from the design's app shell: visible ~1.9s, then a 250ms exit.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const isDesktop = useIsDesktop()

  const push = useCallback<Push>((msg, kind = 'ok') => {
    const id = ++nextId.current
    setToasts((ts) => [...ts, { id, msg, kind }])
    setTimeout(() => setToasts((ts) => ts.map((x) => (x.id === id ? { ...x, leaving: true } : x))), 1900)
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 2150)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={isDesktop ? 'd-toastwrap' : 'f-toastwrap'} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`f-toast f-toast--${t.kind}${t.leaving ? ' out' : ''}`}>
            <span className="tdot" /><span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
