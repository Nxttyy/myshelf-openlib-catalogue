/* Films on a shelf and in the catalogue (folio/films.jsx). FilmShelf: the
   poster grid with pin-on-hover and note bubbles. FilmList: the desktop
   table. FilmRows: phone list rows (like ShelfList for books).
   FilmCatalogGrid: Explore and Home, a grid on desktop and two columns on
   phones. */

import type { KeyboardEvent } from 'react'
import type { FilmCatalogEntry, FilmShelfEntry } from '../api/types'
import { credit, runtime } from '../lib/films'
import { useIsDesktop } from '../lib/useMediaQuery'
import { useViewportWidth } from '../lib/useViewportWidth'
import { OnShelfBadge } from './CatalogGrid'
import { Icon } from './Icon'
import { Poster } from './Poster'
import { StatusBadge, type ReadingStatus } from './StatusBadge'

const status = (e: FilmShelfEntry) => e.status as ReadingStatus

function activate(onOpen: () => void) {
  return {
    role: 'button' as const, tabIndex: 0, onClick: onOpen,
    onKeyDown: (ev: KeyboardEvent) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen() } },
  }
}

type ShelfProps = { entries: FilmShelfEntry[]; onOpen: (e: FilmShelfEntry) => void; onPin?: (e: FilmShelfEntry) => void }

export function FilmShelf({ entries, onOpen, onPin }: ShelfProps) {
  return (
    <div className="d-grid">
      {entries.map((e) => {
        const f = e.film
        const photos = e.images.length
        return (
          <div className="d-cell" key={e.id} aria-label={f.title} {...activate(() => onOpen(e))}>
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
            <Poster f={f} w={168} />
            <div className="meta">
              <div className="row" style={{ marginBottom: 6 }}>
                {e.is_pinned
                  ? <span className="pinflag"><Icon name="pin" size={10} sw={1.6} /> On top</span>
                  : <span className="f-label" style={{ fontSize: 9 }}>{runtime(f)}</span>}
                <StatusBadge status={status(e)} film />
              </div>
              <div className="ttl">{f.title}</div>
              <div className="aut">{credit(f)}{f.year ? ' · ' + f.year : ''}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function FilmList({ entries, onOpen }: ShelfProps) {
  return (
    <div className="d-flist">
      <div className="hd" aria-hidden="true"><span /><span>Title</span><span>Year</span><span>Runtime</span><span>IMDb</span><span>Status</span><span /></div>
      {entries.map((e) => {
        const f = e.film
        return (
          <button className="rw" key={e.id} onClick={() => onOpen(e)} aria-label={f.title}>
            <Poster f={f} w={34} hover={false} />
            <span className="t"><b>{f.title}</b><i>{credit(f)}{f.genres[0] ? ' · ' + f.genres[0] : ''}</i></span>
            <span className="m">{f.year ?? ''}</span>
            <span className="m">{runtime(f)}</span>
            <span className="m">{f.imdb_rating?.toFixed(1) ?? '·'}</span>
            <span><StatusBadge status={status(e)} film /></span>
            <span className="v" title={e.is_public ? 'Public' : 'Only me'}><Icon name={e.is_public ? 'eye' : 'lock'} size={14} /></span>
          </button>
        )
      })}
    </div>
  )
}

/** Phone rows, like the book list on phones. */
export function FilmRows({ entries, onOpen, onPin }: ShelfProps) {
  return (
    <div>
      {entries.map((e) => {
        const f = e.film
        return (
          <div className="f-card" key={e.id} aria-label={f.title} {...activate(() => onOpen(e))}>
            <Poster f={f} w={64} hover={false} />
            <div className="f-card-meta">
              <div className="f-card-title">{f.title}</div>
              <div className="f-card-author">{credit(f)}{f.year ? ' · ' + f.year : ''} · {runtime(f)}</div>
              <StatusBadge status={status(e)} film />
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
                : f.imdb_rating != null && <span className="f-card-idx">{f.imdb_rating.toFixed(1)}</span>}
              <Icon name="chevron_right" size={16} style={{ color: 'var(--ink-faint)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

type CatalogProps = { entries: FilmCatalogEntry[]; onOpen: (e: FilmCatalogEntry) => void }

export function FilmCatalogGrid(props: CatalogProps) {
  return useIsDesktop() ? <DesktopCatalog {...props} /> : <MobileCatalog {...props} />
}

function DesktopCatalog({ entries, onOpen }: CatalogProps) {
  return (
    <div className="d-grid">
      {entries.map((e) => (
        <div className="d-cell" key={e.film.id} aria-label={e.film.title} {...activate(() => onOpen(e))}>
          <Poster f={e.film} w={168} />
          <div className="meta">
            <div className="row" style={{ marginBottom: 6, minHeight: 14.5 }}>
              <span className="f-label" style={{ fontSize: 9 }}>{runtime(e.film)}</span>
              {e.on_shelf && <OnShelfBadge />}
            </div>
            <div className="ttl">{e.film.title}</div>
            <div className="aut">{credit(e.film)}{e.film.year ? ' · ' + e.film.year : ''}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function MobileCatalog({ entries, onOpen }: CatalogProps) {
  // two columns inside 18px gutters with an 18px gap, like the book grid
  const w = Math.floor((Math.min(useViewportWidth(), 600) - 36 - 18) / 2)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px 18px', padding: '0 18px 30px' }}>
      {entries.map((e) => (
        <div key={e.film.id} style={{ cursor: 'pointer' }} aria-label={e.film.title} {...activate(() => onOpen(e))}>
          <Poster f={e.film} w={w} hover={false} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
            <div className="f-label" style={{ fontSize: 8 }}>{runtime(e.film)}</div>
            {e.on_shelf && <OnShelfBadge />}
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.16, marginTop: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.film.title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 2 }}>{credit(e.film)}{e.film.year ? ' · ' + e.film.year : ''}</div>
        </div>
      ))}
    </div>
  )
}
