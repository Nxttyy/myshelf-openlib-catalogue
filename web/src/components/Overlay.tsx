/* Overlay shells. Desktop: the design's right-hand drawer (d-drawer).
   Phone: the mobile design's bottom sheet (f-sheet), which can also be
   dragged down by its grip to close. Both close on Escape and the scrim,
   lock the page behind them, and move focus inside. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { Icon } from './Icon'

function useOverlayBehaviour(onClose: () => void) {
  const close = useRef(onClose)
  useLayoutEffect(() => { close.current = onClose })
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    window.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', key)
      document.body.style.overflow = prev
    }
  }, [])
}

export function Drawer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useOverlayBehaviour(onClose)
  const closeBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeBtn.current?.focus({ preventScroll: true }) }, [])
  return (
    <>
      <div className="d-scrim" onClick={onClose} />
      <div className="d-drawer" role="dialog" aria-modal="true" aria-label={label}>
        <div className="d-drawer-head">
          <span className="f-label">{label}</span>
          <button ref={closeBtn} className="f-iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
        </div>
        <div className="d-drawer-body">{children}</div>
      </div>
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
