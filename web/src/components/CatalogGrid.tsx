/* Cover grids for catalogue books (Explore, Home). Desktop is the design's
   d-grid shelf; phones get the mobile Explore screen's two-column grid. */

import type { CatalogEntry } from '../api/types'
import { coverFromBook } from '../lib/covers'
import { useIsDesktop } from '../lib/useMediaQuery'
import { useViewportWidth } from '../lib/useViewportWidth'
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

export function CatalogGrid(props: Props) {
  return useIsDesktop() ? <DesktopGrid {...props} /> : <MobileGrid {...props} />
}

function DesktopGrid({ entries, onOpen, startIndex = 1 }: Props) {
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

function MobileGrid({ entries, onOpen, startIndex = 1 }: Props) {
  // two columns inside 18px gutters with an 18px gap, as in the mobile design
  const w = Math.floor((Math.min(useViewportWidth(), 600) - 36 - 18) / 2)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px 18px', padding: '0 18px 30px' }}>
      {entries.map((e, i) => (
        <div key={e.book.id} style={{ cursor: 'pointer' }} {...cellProps(e, onOpen)}>
          <Cover b={coverFromBook(e.book)} w={w} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
            <div className="f-label" style={{ fontSize: 8 }}>№ {pad(startIndex + i)}</div>
            {e.on_shelf && <OnShelfBadge />}
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.16, marginTop: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.book.title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 2 }}>{e.book.authors?.[0]?.name}</div>
        </div>
      ))}
    </div>
  )
}
