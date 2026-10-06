/* Live barcode scanning from the camera. Uses the browser's own
   BarcodeDetector where it reads EAN-13 (Chrome on Android); elsewhere
   (iPhone Safari, Firefox) the same API from the barcode-detector package,
   backed by ZXing compiled to WebAssembly and served from our own origin.
   The fallback (~1MB) only downloads on devices that need it. */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { extractISBN } from './isbn'

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const
const DETECT_EVERY_MS = 180 // a few reads a second: fast enough, easy on the battery

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> }

async function makeDetector(): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: { new (o: object): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector
  if (Native) {
    try {
      if ((await Native.getSupportedFormats()).includes('ean_13')) return new Native({ formats: FORMATS })
    } catch { /* fall through to the WebAssembly reader */ }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  })
  return new BarcodeDetector({ formats: [...FORMATS] })
}

export type ScannerStatus = 'starting' | 'running' | 'denied' | 'unavailable'

export function useBarcodeScanner(
  video: RefObject<HTMLVideoElement | null>,
  { active, paused, onIsbn }: { active: boolean; paused: boolean; onIsbn: (isbn: string) => void },
) {
  const [status, setStatus] = useState<ScannerStatus>('starting')
  const onIsbnRef = useRef(onIsbn)
  const pausedRef = useRef(paused)
  useLayoutEffect(() => { onIsbnRef.current = onIsbn; pausedRef.current = paused })

  useEffect(() => {
    const v = video.current
    if (!active || !v) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    let last = 0
    let busy = false
    const recent = new Map<string, number>() // isbn -> time, to ignore the same code held in view

    async function start() {
      setStatus('starting')
      // No mediaDevices = not a secure context (plain HTTP on a phone) or no camera API.
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('unavailable'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        })
      } catch (err) {
        setStatus((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable')
        return
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
      // Attaching a stream means setting srcObject on the DOM node; the linter
      // reads it as mutating a hook argument, which it isn't.
      // oxlint-disable-next-line react/immutability
      v!.srcObject = stream
      v!.setAttribute('playsinline', '')
      v!.muted = true
      await v!.play().catch(() => {})
      const detector = await makeDetector().catch(() => null)
      if (stopped) return
      if (!detector) { setStatus('unavailable'); return }
      setStatus('running')

      const tick = async (t: number) => {
        if (stopped) return
        raf = requestAnimationFrame(tick)
        if (busy || pausedRef.current || t - last < DETECT_EVERY_MS || v!.readyState < 2) return
        last = t
        busy = true
        try {
          for (const { rawValue } of await detector!.detect(v!)) {
            const isbn = extractISBN(rawValue)
            if (!isbn) continue
            const seen = recent.get(isbn)
            if (seen && t - seen < 3000) continue
            recent.set(isbn, t)
            onIsbnRef.current(isbn)
          }
        } catch { /* a frame that couldn't be read */ }
        busy = false
      }
      raf = requestAnimationFrame(tick)
    }

    start()
    return () => {
      // The camera light goes off the moment scanning stops.
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      // oxlint-disable-next-line react/immutability
      v.srcObject = null
    }
  }, [active, video])

  return status
}
