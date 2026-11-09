/* Cover grid for catalogue books (Explore, Home): the design's d-grid
   shelf, two across on phones (styles/mobile.css). */

import type { CatalogEntry } from '../api/types'
import { coverFromBook } from '../lib/covers'
import { Cover } from './Cover'

const pad = (n: number) => String(n).padStart(2, '0')

export function OnShelfBadge() {
  return <span className="f-status" data-s="read"><span className="pip" />On shelf</span>
}

type Props = { entries: CatalogEntry[]; onOpen: (e: CatalogEntry) => void; startIndex?: number }

function cellProps(e: CatalogEntry, onOpen: Props['onOpen']) {
  return {
    role: 'button', tabIndex: 0, 'aria-label': e.book.title,
    onClick: () => onOpen(e),
    onKeyDown: (ev: React.KeyboardEvent) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(e) } },
  } as const
}

export function CatalogGrid({ entries, onOpen, startIndex = 1 }: Props) {
  return (
    <div className="d-grid">
      {entries.map((e, i) => (
        <div className="d-cell" key={e.book.id} {...cellProps(e, onOpen)}>
          <Cover b={coverFromBook(e.book)} w={168} />
          <div className="meta">
            {/* min height of a status badge, so rows line up whether or not one shows */}
            <div className="row" style={{ marginBottom: 6, minHeight: 14.5 }}>
              <span className="f-label" style={{ fontSize: 9 }}>№ {pad(startIndex + i)}</span>
              {e.on_shelf && <OnShelfBadge />}
            </div>
            <div className="ttl">{e.book.title}</div>
            <div className="aut">{e.book.authors?.[0]?.name}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
