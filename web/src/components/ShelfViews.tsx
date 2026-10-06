/* A person's shelf, three ways. ShelfGrid: the design's desktop shelf
   (folio/desktop.jsx Shelf) with pin-on-hover and note bubbles. ShelfList:
   the mobile design's list rows (folio/components.jsx BookCard), which open
   the book sheet instead of expanding inline. Hauls: the timeline
   (folio/desktop.jsx Hauls), headed by date since hauls have no names. */

import type { KeyboardEvent } from 'react'
import type { Haul, ShelfEntry } from '../api/types'
import { coverFromBook } from '../lib/covers'
import { Cover } from './Cover'
import { Icon } from './Icon'
import { StatusBadge, type ReadingStatus } from './StatusBadge'

const pad = (n: number) => String(n).padStart(2, '0')
const status = (e: ShelfEntry) => e.status as ReadingStatus
const author = (e: ShelfEntry) => e.book.authors?.[0]?.name ?? 'Unknown'

type ViewProps = { entries: ShelfEntry[]; onOpen: (e: ShelfEntry) => void; onPin?: (e: ShelfEntry) => void }

function activate(onOpen: () => void) {
  return {
    role: 'button' as const, tabIndex: 0, onClick: onOpen,
    onKeyDown: (ev: KeyboardEvent) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen() } },
  }
}

function PinFlag({ size = 10 }: { size?: number }) {
  return <span className="pinflag"><Icon name="pin" size={size} sw={1.6} /> On top</span>
}

export function ShelfGrid({ entries, onOpen, onPin }: ViewProps) {
  return (
    <div className="d-grid">
      {entries.map((e, i) => {
        const photos = e.images.length
        return (
          <div className="d-cell" key={e.id} aria-label={e.book.title} {...activate(() => onOpen(e))}>
            {onPin && (
              <button className={'d-pin' + (e.is_pinned ? ' on' : '')}
                title={e.is_pinned ? 'Remove from top' : 'Move to top'} aria-label={e.is_pinned ? 'Remove from top' : 'Move to top'}
                aria-pressed={e.is_pinned} onClick={(ev) => { ev.stopPropagation(); onPin(e) }}>
                <Icon name="pin" size={16} sw={1.6} />
              </button>
            )}
            {(e.comment || photos > 0) && (
              <div className="d-bubble">
                {e.comment && <span className="txt">{e.comment}</span>}
                {photos > 0 && (
                  <span className="prints">
                    <span className="fan"><i /><i /><i /></span>
                    {photos} {photos === 1 ? 'photo' : 'photos'}
                  </span>
                )}
              </div>
            )}
            <Cover b={coverFromBook(e.book)} w={168} />
            <div className="meta">
              <div className="row" style={{ marginBottom: 6 }}>
                {e.is_pinned ? <PinFlag /> : <span className="f-label" style={{ fontSize: 9 }}>№ {pad(i + 1)}</span>}
                <StatusBadge status={status(e)} />
              </div>
              <div className="ttl">{e.book.title}</div>
              <div className="aut">{author(e)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ShelfList({ entries, onOpen, onPin }: ViewProps) {
  return (
    <div>
      {entries.map((e, i) => (
        <div className="f-card" key={e.id} aria-label={e.book.title} {...activate(() => onOpen(e))}>
          <Cover b={coverFromBook(e.book)} w={64} tilt={false} />
          <div className="f-card-meta">
            <div className="f-card-title">{e.book.title}</div>
            <div className="f-card-author">{e.book.authors?.map((a) => a.name).join(', ') || 'Unknown'}{e.book.subtitle ? ' · ' + e.book.subtitle : ''}</div>
            <StatusBadge status={status(e)} />
            {(e.comment || e.images.length > 0) && (
              <div className="m-card-note">
                {e.images.length > 0 && <span className="m-card-photos"><Icon name="camera" size={12} sw={1.6} />{e.images.length}</span>}
                {e.comment}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            {onPin && (
              <button className={'f-pinbtn' + (e.is_pinned ? ' on' : '')} aria-label={e.is_pinned ? 'Remove from top' : 'Move to top'}
                aria-pressed={e.is_pinned} onClick={(ev) => { ev.stopPropagation(); onPin(e) }}>
                <Icon name="pin" size={15} sw={1.6} />
              </button>
            )}
            {e.is_pinned
              ? <span className="f-card-idx m-pinned"><Icon name="pin" size={9} sw={1.6} style={{ fill: 'currentColor' }} />On top</span>
              : <span className="f-card-idx">{pad(i + 1)}</span>}
            <Icon name="chevron_right" size={16} style={{ color: 'var(--ink-faint)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Hauls({ hauls, entries, onOpen, coverW = 116 }: {
  hauls: Haul[]; entries: ShelfEntry[]; onOpen: (e: ShelfEntry) => void; coverW?: number
}) {
  const byId = new Map(entries.map((e) => [e.id, e]))
  return (
    <div className="d-hauls">
      {hauls.map((h, hi) => {
        const items = h.user_book_ids.map((id) => byId.get(id)).filter((e): e is ShelfEntry => !!e)
        if (!items.length) return null
        return (
          <div className="d-haul" key={h.number}>
            <div className="rail">
              <span className="dot" />
              {hi < hauls.length - 1 && <span className="line" />}
            </div>
            <div className="body">
              <span className="f-label">Haul {h.number}</span>
              <h3>{h.heading}</h3>
              <div className="sub">{items.length} {items.length === 1 ? 'book' : 'books'} · {h.total_pages.toLocaleString()} pages</div>
              <div className="pile">
                {items.map((e, i) => (
                  <div className="pcell" key={e.id} style={{ ['--rot' as string]: (((i % 3) - 1) * 2.4) + 'deg', zIndex: i + 1 }}
                    aria-label={e.book.title} {...activate(() => onOpen(e))}>
                    <Cover b={coverFromBook(e.book)} w={coverW} tilt={false} />
                    <div className="pmeta"><span className="t">{e.book.title}</span><span className="a">{author(e)}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
