/* Scan tab. Desktop starts with a QR code for the phone hand-off (the phone
   opens /mobile-scan/<token> and its scans appear here); phones, and
   desktops that switch, scan with the camera directly. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { scanSessionItems, startScanSession } from '../../api/add'
import { ApiError } from '../../api/client'
import { useBarcodeScanner } from '../../lib/scanner'
import { useToast } from '../../lib/toast'
import { Icon } from '../Icon'
import { useQueueActions } from './actions'

export function ScanTab({ desktop }: { desktop: boolean }) {
  const [mode, setMode] = useState<'qr' | 'camera'>(desktop ? 'qr' : 'camera')
  // Stable, because the phone session's effects depend on it: a new function
  // each render would start a new session each render.
  const toCamera = useCallback(() => setMode('camera'), [])
  const toQr = useCallback(() => setMode('qr'), [])
  return mode === 'qr'
    ? <PhoneHandoff onCamera={toCamera} />
    : <CameraScan onQr={desktop ? toQr : undefined} />
}

function CameraScan({ onQr }: { onQr?: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [paused, setPaused] = useState(false)
  const { addIsbn } = useQueueActions()
  const status = useBarcodeScanner(video, { active: true, paused, onIsbn: (isbn) => addIsbn(isbn) })
  const scanning = status === 'running' && !paused

  const problem = status === 'denied' ? 'Camera access is blocked. Allow it in your browser settings, or type the ISBN instead.'
    : status === 'unavailable' ? "There's no camera available here. Type the ISBN or search by title instead."
    : null

  return (
    <div>
      <div className="f-cam">
        <video ref={video} playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        {scanning && <div className="f-scanline" />}
        <div className="reticle"><span className="c1" /><span className="c2" /></div>
        {problem
          ? <div className="m-cam-msg">{problem}</div>
          : <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center' }}>
              <span className="f-label on-dark" style={{ color: 'rgba(244,238,226,0.8)' }}>
                {status === 'starting' ? 'Starting the camera…' : scanning ? 'Point at a barcode. Auto-detecting' : 'Camera paused'}
              </span>
            </div>}
        {status === 'running' && (
          <button onClick={() => setPaused((p) => !p)} className="m-cam-pause">{paused ? 'Resume' : 'Pause'}</button>
        )}
      </div>
      {onQr && (
        <button className="f-btn f-btn--ghost" style={{ marginTop: 14 }} onClick={onQr}>
          <Icon name="command" size={15} /> Show phone QR instead
        </button>
      )}
    </div>
  )
}

const POLL_MS = 2000

function PhoneHandoff({ onCamera }: { onCamera: () => void }) {
  const { addIsbn } = useQueueActions()
  const toast = useToast()
  const [session, setSession] = useState<{ token: string; scan_url: string } | null>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [received, setReceived] = useState(0)
  const [restart, setRestart] = useState(0)
  const failures = useRef(0)

  useEffect(() => {
    let alive = true
    startScanSession()
      .then(async (s) => {
        if (!alive) return
        setSession(s)
        setReceived(0)
        const QR = await import('qrcode') // only desktops showing the QR download it
        const out = await QR.toString(s.scan_url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#141B2E', light: '#00000000' } })
        if (alive) setSvg(out)
      })
      .catch(() => { if (alive) { toast("Couldn't start a phone session. Use this computer's camera instead.", 'err'); onCamera() } })
    return () => { alive = false }
  }, [restart, onCamera, toast])

  useEffect(() => {
    if (!session) return
    let seen = 0
    const id = setInterval(async () => {
      try {
        const data = await scanSessionItems(session.token, seen)
        failures.current = 0
        for (const isbn of data.isbns) addIsbn(isbn)
        seen += data.isbns.length
        setReceived(seen)
      } catch (err) {
        // Expired session: start a fresh one so the QR works again.
        if (err instanceof ApiError && err.status === 404) { clearInterval(id); setSession(null); setSvg(null); setRestart((n) => n + 1); return }
        if (++failures.current >= 5) { clearInterval(id); toast('Lost touch with your phone. Switching to this camera.', 'err'); onCamera() }
      }
    }, POLL_MS)
    return () => clearInterval(id)
  }, [session, addIsbn, onCamera, toast])

  return (
    <div style={{ textAlign: 'center', paddingTop: 6 }}>
      <div style={{ display: 'inline-block', padding: 14, background: 'var(--paper-2)', borderRadius: 12, border: '1px solid var(--hair)' }}>
        <div className="m-qr" aria-label="QR code for scanning with your phone" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}>
          {svg ? undefined : <span className="f-label">Making a code…</span>}
        </div>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.5, margin: '16px auto 0', maxWidth: 260 }}>
        Scan this with your phone to keep adding barcodes wherever you are. They show up right here in the queue.
      </div>
      <div className="f-label" style={{ marginTop: 10, color: received ? 'var(--st-read)' : undefined }}>
        {received ? `${received} ${received === 1 ? 'book' : 'books'} from your phone` : 'Waiting for your phone…'}
      </div>
      <button className="f-btn f-btn--ghost" style={{ marginTop: 16 }} onClick={onCamera}>
        <Icon name="scan" size={16} /> Use this computer's camera instead
      </button>
    </div>
  )
}
