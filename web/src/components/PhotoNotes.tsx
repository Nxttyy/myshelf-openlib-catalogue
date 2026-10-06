/* Photos on a note, from the design's folio/media.jsx: thumbnail strip,
   add menu, lightbox, camera. Uploads are real (presigned POST straight to
   the bucket, see api/shelf.ts). "Take a photo" opens the phone's own camera
   app on touch devices, and an in-page viewfinder on desktop. */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MAX_PHOTOS, uploadPhotos, useDeletePhoto } from '../api/shelf'
import type { UserBookImage } from '../api/types'
import { useToast } from '../lib/toast'
import { useMediaQuery } from '../lib/useMediaQuery'
import { Icon } from './Icon'

type Props = { photos: UserBookImage[]; entryId?: string; editable: boolean; context: string }

export function PhotoNotes({ photos, entryId, editable, context }: Props) {
  const qc = useQueryClient()
  const toast = useToast()
  const del = useDeletePhoto()
  const [view, setView] = useState<number | null>(null)
  const [camera, setCamera] = useState(false)
  const [uploading, setUploading] = useState(0)

  async function upload(files: File[]) {
    if (!entryId) return
    const images = files.filter((f) => f.type.startsWith('image/'))
    const room = MAX_PHOTOS - photos.length
    if (!images.length) return
    if (room <= 0) { toast(`A note can have at most ${MAX_PHOTOS} photos.`, 'err'); return }
    const batch = images.slice(0, room)
    if (images.length > room) toast(`Only ${room} more fit. A note holds ${MAX_PHOTOS} photos.`, 'err')
    setUploading((n) => n + batch.length)
    const res = await uploadPhotos(qc, entryId, batch, () => setUploading((n) => n - 1))
    setUploading((n) => Math.max(0, n - res.failed.length))
    if (res.error) toast(res.error, 'err')
    else if (res.failed.length) toast(`Couldn't upload ${res.failed.join(', ')}.`, 'err')
  }

  function remove(p: UserBookImage) {
    if (!entryId) return
    del.mutate({ entryId, imageId: p.id }, { onError: () => toast("Couldn't remove that photo.", 'err') })
  }

  return (
    <>
      <PhotoStrip photos={photos} editable={editable} uploading={uploading} full={photos.length + uploading >= MAX_PHOTOS}
        onOpen={setView} onRemove={remove} onUpload={upload} onCamera={() => setCamera(true)} />
      {view != null && photos.length > 0 && createPortal(
        <Lightbox photos={photos} index={Math.min(view, photos.length - 1)} setIndex={setView}
          editable={editable} onRemove={remove} onClose={() => setView(null)} context={context} />,
        document.body)}
      {camera && createPortal(
        <CameraSheet onCapture={(f) => upload([f])} onClose={() => setCamera(false)} />, document.body)}
    </>
  )
}

function PhotoStrip({ photos, editable, uploading, full, onOpen, onRemove, onUpload, onCamera }: {
  photos: UserBookImage[]; editable: boolean; uploading: number; full: boolean
  onOpen: (i: number) => void; onRemove: (p: UserBookImage) => void
  onUpload: (files: File[]) => void; onCamera: () => void
}) {
  const [menu, setMenu] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const captureRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const touch = useMediaQuery('(pointer: coarse)')

  useEffect(() => {
    if (!menu) return
    const out = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [menu])

  const pick = (input: HTMLInputElement | null) => { setMenu(false); input?.click() }
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => { onUpload(Array.from(e.target.files ?? [])); e.target.value = '' }

  return (
    <div className="d-photos">
      {photos.map((p, i) => (
        <button className="d-photo" key={p.id} onClick={() => onOpen(i)} title="View photo" aria-label={`Photo ${i + 1} of ${photos.length}`}>
          <img src={p.url} alt="" loading="lazy" />
          {editable && (
            <span className="rm" role="button" aria-label="Remove photo" title="Remove"
              onClick={(e) => { e.stopPropagation(); onRemove(p) }}><Icon name="close" size={11} sw={2.2} /></span>
          )}
        </button>
      ))}
      {Array.from({ length: uploading }, (_, i) => (
        <div key={'up' + i} className="d-photo m-photo-pending" aria-label="Uploading"><span className="f-label">…</span></div>
      ))}
      {editable && !full && (
        <div className="d-addwrap" ref={wrapRef}>
          <button className={'d-photo-add' + (menu ? ' on' : '')} title="Add photos" aria-label="Add photos" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon name="camera" size={17} sw={1.6} />
          </button>
          {menu && (
            <div className="d-addpop" role="menu">
              <button role="menuitem" onClick={() => pick(fileRef.current)}><Icon name="upload" size={15} /> Upload from device</button>
              <button role="menuitem" onClick={() => (touch ? pick(captureRef.current) : (setMenu(false), onCamera()))}><Icon name="camera" size={15} /> Take a photo</button>
              <div className="hint">Up to {MAX_PHOTOS}. Quotes, covers, spreads.</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden onChange={onFiles} />
          <input ref={captureRef} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
        </div>
      )}
      {editable && photos.length === 0 && !uploading && (
        <span className="d-photo-hint">Add photos to this note: a quote you liked, the cover, a spread.</span>
      )}
    </div>
  )
}

function Lightbox({ photos, index, setIndex, editable, onRemove, onClose, context }: {
  photos: UserBookImage[]; index: number; setIndex: (i: number) => void; editable: boolean
  onRemove: (p: UserBookImage) => void; onClose: () => void; context: string
}) {
  useEffect(() => {
    // Capture phase + stopPropagation: Escape closes the lightbox only, not
    // the drawer or sheet underneath it.
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setIndex(Math.min(photos.length - 1, index + 1))
      else if (e.key === 'ArrowLeft') setIndex(Math.max(0, index - 1))
      else return
      e.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [photos.length, index, onClose, setIndex])

  const p = photos[index]
  function removeCurrent() {
    onRemove(p)
    if (photos.length <= 1) onClose()
    else setIndex(Math.min(index, photos.length - 2))
  }

  return (
    <div className="d-lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Photos of ${context}`}>
      <div className="lb-top" onClick={(e) => e.stopPropagation()}>
        <span className="f-label" style={{ color: 'rgba(237,230,214,0.6)' }}>{context}</span>
        <span className="lb-count">{index + 1} / {photos.length}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {editable && <button className="lb-btn" title="Remove from note" aria-label="Remove from note" onClick={removeCurrent}><Icon name="trash" size={15} /></button>}
          <button className="lb-btn" title="Close" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
      </div>
      <div className="lb-stage" onClick={(e) => e.stopPropagation()}>
        <button className="lb-nav" disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label="Previous"><Icon name="chevron_left" size={19} /></button>
        <figure className="lb-print" key={p.id}><img src={p.url} alt="" /></figure>
        <button className="lb-nav" disabled={index === photos.length - 1} onClick={() => setIndex(index + 1)} aria-label="Next"><Icon name="chevron_right" size={19} /></button>
      </div>
      {photos.length > 1 && (
        <div className="lb-strip" onClick={(e) => e.stopPropagation()}>
          {photos.map((f, i) => (
            <button key={f.id} className={i === index ? 'on' : ''} onClick={() => setIndex(i)} aria-label={`Photo ${i + 1}`}><img src={f.url} alt="" /></button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Desktop viewfinder. Each shot is handed to onCapture straight away;
    with `once`, the sheet closes after the first. */
export function CameraSheet({ onCapture, onClose, title = 'Camera · point at the page', caption = 'Shots land on this note', once = false }: {
  onCapture: (f: File) => void; onClose: () => void; title?: string; caption?: string; once?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [flash, setFlash] = useState(false)
  const [shots, setShots] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        stream = s
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}) }
      })
      .catch(() => setError('No camera available. Allow camera access, or upload a photo instead.'))
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => {
      // The camera light goes off the moment the sheet closes.
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  function snap() {
    const v = video.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth; canvas.height = v.videoHeight
    canvas.getContext('2d')!.drawImage(v, 0, 0)
    setFlash(true); setTimeout(() => setFlash(false), 260)
    canvas.toBlob((blob) => {
      if (!blob) return
      setShots((n) => n + 1)
      onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      if (once) onClose()
    }, 'image/jpeg', 0.9)
  }

  return (
    <>
      <div className="d-scrim m-cam-scrim" onClick={onClose} />
      <div className="d-camsheet" role="dialog" aria-modal="true" aria-label="Camera">
        <div className="hd">
          <span className="f-label">{title}</span>
          <button className="f-iconbtn" style={{ width: 30, height: 30 }} onClick={onClose} aria-label="Close camera"><Icon name="close" size={16} /></button>
        </div>
        <div className="f-cam">
          {error
            ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', color: 'var(--paper)', fontSize: 13 }}>{error}</div>
            : <video ref={video} playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
          <div className="reticle"><span className="c1" /><span className="c2" /></div>
          {flash && <div className="lb-flash" />}
        </div>
        <div className="ft">
          <span className="caption" style={{ flex: 1 }}>{shots === 0 ? caption : shots + (shots === 1 ? ' photo added' : ' photos added')}</span>
          <button className="d-shutter" onClick={snap} disabled={!!error} aria-label="Take photo"><span /></button>
          <button className="f-btn f-btn--ink" style={{ padding: '8px 16px', fontSize: 12.5, marginLeft: 'auto' }} onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  )
}
