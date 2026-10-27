/* Sharing: the design's share popover (link, Copy, email / copy / more),
   first made for the profile and used for books, films and note photos too.
   Phones get the system share sheet instead. */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useSetProfileVisibility } from '../api/shelf'
import type { ShareLink } from '../lib/share'
import { useToast } from '../lib/toast'
import { useMediaQuery } from '../lib/useMediaQuery'
import { Icon } from './Icon'

/** The popover's contents. */
export function SharePanel({ heading, note, url, short, emailSubject, onDone, channels }: {
  heading: string; note: ReactNode; url: string; short: string; emailSubject: string
  onDone: () => void; channels?: boolean
}) {
  const toast = useToast()
  async function copy() {
    try { await navigator.clipboard.writeText(url); toast('Link copied.') } catch { toast("Couldn't copy. Select the link instead.", 'err') }
    onDone()
  }
  return (
    <>
      <div className="f-label">{heading}</div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 8, lineHeight: 1.5 }}>{note}</div>
      <div className="row">
        <div className="d-share-link" title={url}>{short}</div>
        <button className="f-btn f-btn--ink" onClick={copy} style={{ padding: '0 16px', height: 40 }}><Icon name="copy" size={15} /> Copy</button>
      </div>
      {channels && (
        <div className="d-share-channels">
          <a title="Share by email" aria-label="Share by email" className="m-share-channel" onClick={onDone}
            href={`mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(url)}`}><Icon name="send" size={16} /></a>
          <button title="Copy link" aria-label="Copy link" onClick={copy}><Icon name="link" size={16} /></button>
          <button title="More" aria-label="More ways to share" onClick={async () => {
            if (navigator.share) { try { await navigator.share({ url }) } catch { /* dismissed */ } onDone() } else copy()
          }}><Icon name="more" size={16} /></button>
        </div>
      )}
    </>
  )
}

/** Anchored under its button; closes on a click outside or Escape. */
export function SharePopover({ onClose, style, children }: { onClose: () => void; style?: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    // Capture phase + stopPropagation: Escape closes the popover only, not
    // the drawer or lightbox it sits in.
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', out)
    window.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', out); window.removeEventListener('keydown', key, true) }
  }, [onClose])
  return <div className="d-share-pop" ref={ref} style={style} onClick={(e) => e.stopPropagation()}>{children}</div>
}

/** Ask for the preview card now, so it's drawn and cached by the time a chat
    app or social site fetches it for the link. */
const warm = (card: string) => { new Image().src = card }

/** A share button for one link. Touch screens open the system share sheet;
    elsewhere it opens the popover, under the button's right edge, or with
    `inParent`, under the nearest positioned parent's (so it can line up with
    a column rather than a small button near the middle). */
export function ShareButton({ link, title, heading, className, label, inParent, iconSize = 15 }: {
  link: ShareLink; title: string; heading: string; className: string; label?: string
  inParent?: boolean; iconSize?: number
}) {
  const [open, setOpen] = useState(false)
  const touch = useMediaQuery('(pointer: coarse)')

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!link.blocked) warm(link.card)
    if (touch && navigator.share && !link.blocked) {
      try { await navigator.share({ title, url: link.url }) } catch { /* dismissed */ }
    } else setOpen((o) => !o)
  }

  return (
    <div className="d-share-wrap" style={{ display: 'inline-block', position: inParent ? 'static' : 'relative' }}>
      <button className={className} onClick={onClick} aria-expanded={open} aria-label={label ? undefined : heading} title={label ? undefined : heading}>
        <Icon name="share" size={iconSize} />{label && <> {label}</>}
      </button>
      {open && (
        <SharePopover onClose={() => setOpen(false)}
          style={{ maxWidth: 'calc(100vw - 32px)', textAlign: 'left' }}>
          {link.blocked
            ? <Blocked heading={heading} link={link} />
            : <SharePanel heading={heading} note={link.note} url={link.url} short={link.short}
              emailSubject={`${title} on Dora`} onDone={() => setOpen(false)} channels />}
        </SharePopover>
      )}
    </div>
  )
}

/** Nothing to share yet. A private shelf can be opened from here, and the
    popover then turns into the link; a private copy is changed in the note. */
function Blocked({ heading, link }: { heading: string; link: ShareLink }) {
  const set = useSetProfileVisibility()
  const toast = useToast()
  return (
    <>
      <div className="f-label">{heading}</div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 8, lineHeight: 1.5 }}>{link.note}</div>
      {link.blocked === 'shelf' && (
        <button className="f-btn f-btn--ink" disabled={set.isPending} style={{ marginTop: 14, height: 40, padding: '0 16px' }}
          onClick={() => set.mutate(true, {
            onSuccess: () => toast('Your shelf is public.'),
            onError: () => toast("Couldn't change that. Try again.", 'err'),
          })}>Make my shelf public</button>
      )}
    </>
  )
}
