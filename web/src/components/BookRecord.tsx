/* A book's catalogue record, opened from any cover via ?book=<id>.
   Desktop: the design's DetailDrawer (folio/desktop.jsx), non-editable
   branch. Phone: the mobile design's DetailSheet (folio/screens.jsx).
   Editing your own shelf entry (status, note, photos) arrives in phase 4. */

import { Link, useLocation } from 'react-router'
import { useMe } from '../api/me'
import { useAddToShelf, useBookEntry } from '../api/queries'
import type { BookEntryRead } from '../api/types'
import { coverFromBook } from '../lib/covers'
import { editionLinks } from '../lib/links'
import { useOverlay } from '../lib/overlay'
import { useToast } from '../lib/toast'
import { useIsDesktop } from '../lib/useMediaQuery'
import { OnShelfBadge } from './CatalogGrid'
import { Cover } from './Cover'
import { Icon } from './Icon'
import { BottomSheet, Drawer } from './Overlay'
import { StatusBadge, SubjectPill, type ReadingStatus } from './StatusBadge'

export function BookOverlay() {
  const { value: id, close } = useOverlay('book')
  if (!id) return null
  return <BookRecord key={id} id={id} onClose={close} />
}

function BookRecord({ id, onClose }: { id: string; onClose: () => void }) {
  const isDesktop = useIsDesktop()
  const { data, isError } = useBookEntry(id)
  const body = data
    ? <RecordBody entry={data} desktop={isDesktop} />
    : <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 14 }}>
        {isError ? "We couldn't find that book." : 'Loading…'}
      </div>

  return isDesktop
    ? <Drawer label="Catalog record" onClose={onClose}>{body}</Drawer>
    : <BottomSheet label="Catalog record" onClose={onClose}>
        <div style={{ overflowY: 'auto', padding: '14px 20px 30px', scrollbarWidth: 'none' }}>{body}</div>
      </BottomSheet>
}

const notSet = 'Not set'
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s)

function RecordBody({ entry, desktop }: { entry: BookEntryRead; desktop: boolean }) {
  const b = entry.book
  const authors = b.authors?.map((a) => a.name).join(', ') || 'Unknown'
  const meta: [string, string][] = [
    ['Published', b.publish_date || notSet],
    ['Pages', b.number_of_pages ? b.number_of_pages.toLocaleString() : notSet],
    ['Publisher', b.publishers?.map((p) => p.name).join(', ') || notSet],
    ['ISBN', b.isbns?.[0] || notSet],
  ]
  const status = entry.shelf?.status as ReadingStatus | undefined
  const badge = status ? <StatusBadge status={status} /> : entry.on_shelf ? <OnShelfBadge /> : null

  return (
    <>
      {/* cover + title block */}
      <div style={{ display: 'flex', gap: desktop ? 22 : 16, marginBottom: desktop ? 24 : 18 }}>
        <Cover b={coverFromBook(b)} w={desktop ? 132 : 104} />
        <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
          <h2 style={desktop
            ? { fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.05, margin: '0 0 8px' }
            : { fontSize: 21, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.08, margin: '0 0 6px' }}>{b.title}</h2>
          {b.subtitle && <div style={{ fontSize: desktop ? 14 : 13.5, color: 'var(--ink-soft)', marginBottom: 6 }}>{b.subtitle}</div>}
          <div style={{ fontSize: desktop ? 14 : 13.5, color: 'var(--ink-soft)', marginBottom: desktop ? 14 : 12 }}>{authors}</div>
          {badge}
          {!desktop && entry.added_by && <div className="f-label" style={{ marginTop: 12 }}>Added by @{entry.added_by}</div>}
        </div>
      </div>

      {!!b.subjects?.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: desktop ? 7 : 6, marginBottom: desktop ? 22 : 16 }}>
          {b.subjects.slice(0, 8).map((s) => <SubjectPill key={s.name}>{s.name}</SubjectPill>)}
        </div>
      )}

      <div className="f-metagrid" style={desktop ? { marginBottom: 22 } : undefined}>
        {meta.map(([k, v]) => (
          <div className="f-metacell" key={k}>
            <div className="k">{k}</div>
            <div className="v" style={k === 'ISBN' ? { fontFamily: 'var(--font-mono)', fontSize: 12 } : undefined}>{v}</div>
          </div>
        ))}
      </div>

      {b.description && (
        <>
          <div className="f-label" style={{ marginBottom: desktop ? 9 : 8 }}>About</div>
          <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55, margin: `0 0 ${desktop ? 22 : 16}px`, textWrap: 'pretty' }}>{clip(b.description, 600)}</p>
        </>
      )}

      <div className="f-label" style={{ margin: desktop ? '0 0 9px' : '4px 0 8px' }}>Find this edition</div>
      <div className="f-links" style={desktop ? { marginBottom: 24 } : undefined}>
        {editionLinks(b).map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="f-link">{l.label}<Icon name="external" size={11} /></a>
        ))}
      </div>

      {desktop && entry.added_by && <div className="f-label" style={{ marginBottom: 18 }}>Added by @{entry.added_by}</div>}
      <ShelfAction entry={entry} />
    </>
  )
}

/** The current drawer's "add to shelf" control, which the design leaves out. */
function ShelfAction({ entry }: { entry: BookEntryRead }) {
  const { data: me } = useMe()
  const add = useAddToShelf()
  const toast = useToast()
  const location = useLocation()

  if (entry.on_shelf) {
    return (
      <div className="f-btn f-btn--ghost f-btn--block" style={{ cursor: 'default' }}>
        <Icon name="check" size={17} sw={2} /> On your shelf
      </div>
    )
  }
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Link to={`/login?next=${next}`} className="f-btn f-btn--ink f-btn--block"><Icon name="lock" size={15} /> Sign in to add it to your shelf</Link>
  }
  return (
    <button className="f-btn f-btn--amber f-btn--block" disabled={add.isPending}
      onClick={() => add.mutate(entry.book.id, {
        onSuccess: () => toast('Added to your shelf.'),
        onError: () => toast("Couldn't add it. Try again.", 'err'),
      })}>
      <Icon name="plus" size={18} sw={1.9} /> {add.isPending ? 'Adding…' : 'Add to your shelf'}
    </button>
  )
}
