/* Overlay shells: the design's drawer (d-drawer; a full-screen sheet that
   slides up on phones, styles/mobile.css), its centered dialog, and the
   older mobile bottom sheet (f-sheet), which can also be dragged down by its
   grip to close. All close on Escape and the scrim, lock the page behind
   them, and move focus inside. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'
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

const DRAG_CLOSE_PX = 90

export function BottomSheet({ label, onClose, children, maxHeight = '88%' }: {
  label: string; onClose: () => void; children: ReactNode; maxHeight?: string
}) {
  useOverlayBehaviour(onClose)
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<number | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => { sheet.current?.focus({ preventScroll: true }) }, [])

  function down(e: PointerEvent) {
    start.current = e.clientY
    setDragging(true)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (start.current != null) setDy(Math.max(0, e.clientY - start.current))
  }
  function up() {
    if (start.current == null) return
    start.current = null
    setDragging(false)
    if (dy > DRAG_CLOSE_PX) onClose()
    else setDy(0)
  }

  return (
    <>
      <div className="f-scrim" onClick={onClose} />
      <div ref={sheet} tabIndex={-1} className="f-sheet" role="dialog" aria-modal="true" aria-label={label}
        style={{ maxHeight, transform: dy ? `translateY(${dy}px)` : undefined, transition: dragging ? 'none' : 'transform 200ms var(--ease-out)', outline: 'none' }}>
        <div className="m-sheet-handle" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="f-sheet-grip" />
        </div>
        {children}
      </div>
    </>
  )
}
