/* Explore: newest books across Dora. Desktop: the explore view in
   folio/desktop-app.jsx. Phone: folio/screens.jsx Explore. More pages load
   as you near the bottom. */

import { useRecentBooks } from '../api/queries'
import type { CatalogEntry } from '../api/types'
import { CatalogGrid } from '../components/CatalogGrid'
import { useOverlay } from '../lib/overlay'
import { useInView } from '../lib/useInView'
import { useIsDesktop } from '../lib/useMediaQuery'

export default function Explore() {
  const isDesktop = useIsDesktop()
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, isError } = useRecentBooks()
  const entries = data?.pages.flatMap((p) => p.entries) ?? []
  const { open } = useOverlay('book')
  const onOpen = (e: CatalogEntry) => open(e.book.id)
  const sentinel = useInView<HTMLDivElement>(() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage() })

  const status = isPending ? 'Loading…' : isError ? "Couldn't load books. Pull to refresh or try again." : isFetchingNextPage ? 'Loading more…' : null

  return (
    <div className="f-rise">
      {isDesktop ? (
        <div className="d-masthead">
          <div>
            <div className="f-label" style={{ marginBottom: 12 }}>Community</div>
            <h1 style={{ fontWeight: 600, fontSize: 44, letterSpacing: '-0.04em', margin: 0 }}>Recently added</h1>
            <p style={{ fontSize: 15, color: 'var(--ink-soft)', marginTop: 10, maxWidth: 460 }}>The newest books added across Dora. Click a cover for its record.</p>
          </div>
        </div>
      ) : (
        <>
          <div style={{ padding: '6px 18px 16px' }}>
            <div className="f-label" style={{ marginBottom: 10 }}>Community</div>
            <h1 className="f-display" style={{ fontSize: 30, marginBottom: 8 }}>Recently added</h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>The newest books added across Dora. Tap a cover for its record.</p>
          </div>
          <div className="hero-rule" style={{ margin: '0 18px 18px' }} />
        </>
      )}

      <CatalogGrid entries={entries} onOpen={onOpen} />
      <div ref={sentinel} />
      {status && <div className="f-label" style={{ textAlign: 'center', padding: '28px 0' }}>{status}</div>}
    </div>
  )
}
