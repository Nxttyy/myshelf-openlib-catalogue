/* Explore: newest books (or films) across Dora. Desktop: the explore view
   in folio/desktop-app.jsx, and FilmExplore in folio/films.jsx. Phone:
   folio/screens.jsx Explore. More pages load as you near the bottom. */

import { useRecentFilms } from '../api/films'
import { useRecentBooks } from '../api/queries'
import type { CatalogEntry, FilmCatalogEntry } from '../api/types'
import { CatalogGrid } from '../components/CatalogGrid'
import { FilmCatalogGrid } from '../components/FilmViews'
import { MediaTabs } from '../components/MediaTabs'
import { useMedia } from '../lib/media'
import { useOverlay } from '../lib/overlay'
import { useInView } from '../lib/useInView'
import { useIsDesktop } from '../lib/useMediaQuery'

export default function Explore() {
  const films = useMedia() === 'films'
  return (
    <>
      <MediaTabs />
      <div className="f-swap" key={films ? 'films' : 'books'}>{films ? <FilmExplore /> : <BookExplore />}</div>
    </>
  )
}

function BookExplore() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, isError } = useRecentBooks()
  const entries = data?.pages.flatMap((p) => p.entries) ?? []
  const { open } = useOverlay('book')
  const sentinel = useInView<HTMLDivElement>(() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage() })
  const status = isPending ? 'Loading…' : isError ? "Couldn't load books. Pull to refresh or try again." : isFetchingNextPage ? 'Loading more…' : null
  return (
    <div className="f-rise">
      <Masthead label="Community" text="The newest books added across Dora." pick="cover" />
      <CatalogGrid entries={entries} onOpen={(e: CatalogEntry) => open(e.book.id)} />
      <div ref={sentinel} />
      {status && <div className="f-label" style={{ textAlign: 'center', padding: '28px 0' }}>{status}</div>}
    </div>
  )
}

function FilmExplore() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, isError } = useRecentFilms()
  const entries = data?.pages.flatMap((p) => p.entries) ?? []
  const { open } = useOverlay('film')
  const sentinel = useInView<HTMLDivElement>(() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage() })
  const status = isPending ? 'Loading…'
    : isError ? "Couldn't load films. Pull to refresh or try again."
    : isFetchingNextPage ? 'Loading more…'
    : !entries.length ? 'No films yet. Add the first one.' : null
  return (
    <div className="f-rise">
      <Masthead label="Community · Films" text="The newest films added across Dora." pick="poster" />
      <FilmCatalogGrid entries={entries} onOpen={(e: FilmCatalogEntry) => open(e.film.id)} />
      <div ref={sentinel} />
      {status && <div className="f-label" style={{ textAlign: 'center', padding: '28px 0' }}>{status}</div>}
    </div>
  )
}

function Masthead({ label, text, pick }: { label: string; text: string; pick: 'cover' | 'poster' }) {
  const isDesktop = useIsDesktop()
  return isDesktop ? (
    <div className="d-masthead">
      <div>
        <div className="f-label" style={{ marginBottom: 12 }}>{label}</div>
        <h1 style={{ fontWeight: 600, fontSize: 44, letterSpacing: '-0.04em', margin: 0 }}>Recently added</h1>
        <p style={{ fontSize: 15, color: 'var(--ink-soft)', marginTop: 10, maxWidth: 460 }}>{text} Click a {pick} for its record.</p>
      </div>
    </div>
  ) : (
    <>
      <div style={{ padding: '6px 18px 16px' }}>
        <div className="f-label" style={{ marginBottom: 10 }}>{label}</div>
        <h1 className="f-display" style={{ fontSize: 30, marginBottom: 8 }}>Recently added</h1>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>{text} Tap a {pick} for its record.</p>
      </div>
      <div className="hero-rule" style={{ margin: '0 18px 18px' }} />
    </>
  )
}
