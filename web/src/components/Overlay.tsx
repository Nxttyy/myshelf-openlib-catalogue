/* Overlay shells: the design's drawer (d-drawer) and centered dialog
   (d-dialog), both full-screen sheets that slide up on phones
   (styles/mobile.css). They close on Escape and the scrim, lock the page
   behind them, and move focus inside. */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

function useOverlayBehaviour(onClose: () => void) {
  const close = useRef(onClose)
  useLayoutEffect(() => { close.current = onClose })
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    window.addEventListener('keydown', key)
    // Lock the page behind, padding the body by the scrollbar that just went
    // away so nothing shifts sideways; overlays still cover the full width.
    const body = document.body.style
    const prev = { overflow: body.overflow, paddingRight: body.paddingRight }
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    body.overflow = 'hidden'
    if (scrollbar > 0) body.paddingRight = `${scrollbar}px`
    return () => {
      window.removeEventListener('keydown', key)
      body.overflow = prev.overflow
      body.paddingRight = prev.paddingRight
    }
  }, [])
}

/** With `hero`, the body brings its own header (DetailHero) and close
    button, so the drawer's plain head is left out, as in the design. */
export function Drawer({ label, onClose, hero, children }: { label: string; onClose: () => void; hero?: boolean; children: ReactNode }) {
  useOverlayBehaviour(onClose)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
  }, [hero])
  return (
    <>
      <div className="d-scrim" onClick={onClose} />
      <div ref={panel} className="d-drawer" role="dialog" aria-modal="true" aria-label={label}>
        {!hero && (
          <div className="d-drawer-head">
            <span className="f-label">{label}</span>
            <button data-autofocus className="f-iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
          </div>
        )}
        <div className="d-drawer-body">{children}</div>
      </div>
    </>
  )
}

/** The design's centered dialog (d-dialog); content supplies its own header. */
export function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useOverlayBehaviour(onClose)
  return (
    <>
      <div className="d-scrim" onClick={onClose} />
      <div className="d-dialog" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </>
  )
}
