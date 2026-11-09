/* Home: the same landing for guests and signed-in users, for books or
   films: folio/desktop-app-v2.jsx Landing (hero + cover fan, colophon,
   recently added grid, footer), reflowed for phones by styles/mobile.css
   (the fan above the headline, one column). */

import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useRecentFilms } from '../api/films'
import { useRecentBooks } from '../api/queries'
import type { CatalogEntry, FilmCatalogEntry } from '../api/types'
import { CatalogGrid } from '../components/CatalogGrid'
import { Cover } from '../components/Cover'
import { FilmCatalogGrid } from '../components/FilmViews'
import { Icon } from '../components/Icon'
import { Logo } from '../components/Logo'
import { Poster } from '../components/Poster'
import { coverFromBook } from '../lib/covers'
import { credit } from '../lib/films'
import { useMedia } from '../lib/media'
import { useOpenAdd, useOverlay } from '../lib/overlay'
import { LINKS } from '../lib/site'

const HOME_SHELF = 12 // the home page shows the newest dozen; Explore has the rest

/** One cover or poster in the hero fan and the phone's strip. */
type Pick = { key: string; title: string; sub: string; art: (w: number) => ReactNode; open: () => void }

type HomeProps = { films: boolean; picks: Pick[]; grid: ReactNode; onScan: () => void }

export default function Home() {
  const films = useMedia() === 'films'
  return <div className="f-swap" key={films ? 'films' : 'books'}>{films ? <FilmsHome /> : <BooksHome />}</div>
}

function BooksHome() {
  const { data } = useRecentBooks()
  const entries = data?.pages[0]?.entries ?? []
  const { open } = useOverlay('book')
  const onOpen = (e: CatalogEntry) => open(e.book.id)
  const picks: Pick[] = entries.slice(0, HOME_SHELF).map((e) => ({
    key: e.book.id, title: e.book.title, sub: e.book.authors?.[0]?.name ?? '',
    art: (w) => <Cover b={coverFromBook(e.book)} w={w} />, open: () => onOpen(e),
  }))
  return <Landing films={false} picks={picks} grid={<CatalogGrid entries={entries.slice(0, HOME_SHELF)} onOpen={onOpen} />} />
}

function FilmsHome() {
  const { data } = useRecentFilms()
  const entries = data?.pages[0]?.entries ?? []
  const { open } = useOverlay('film')
  const onOpen = (e: FilmCatalogEntry) => open(e.film.id)
  const picks: Pick[] = entries.slice(0, HOME_SHELF).map((e) => ({
    key: e.film.id, title: e.film.title, sub: credit(e.film),
    art: (w) => <Poster f={e.film} w={w} />, open: () => onOpen(e),
  }))
  return <Landing films picks={picks} grid={<FilmCatalogGrid entries={entries.slice(0, HOME_SHELF)} onOpen={onOpen} />} />
}

function Landing(props: Omit<HomeProps, 'onScan'>) {
  return <LandingPage {...props} onScan={useOpenAdd()} />
}

const HERO = {
  books: {
    label: 'a record of your books', title: 'Keep track of the books you own.',
    text: 'Scan a barcode. Dora finds the cover, author, and page count and adds the book to your shelf.',
  },
  films: {
    label: 'a record of your films', title: 'Keep track of the films you watch.',
    text: 'Search a title or paste a whole list. Dora finds the details and asks if each film fits your taste.',
  },
}

function HeroButton({ films, onScan, style }: { films: boolean; onScan: () => void; style: React.CSSProperties }) {
  return (
    <button className="f-btn f-btn--amber" onClick={onScan} style={style}>
      {films ? <><Icon name="plus" size={18} sw={1.8} /> Add films</> : <><Icon name="scan" size={18} sw={1.8} /> Scan a book</>}
    </button>
  )
}

function LandingPage({ films, picks, grid, onScan }: HomeProps) {
  const hero = HERO[films ? 'films' : 'books']
  return (
    <div className="f-rise">
      <div className="d-hero">
        <div>
          <div className="f-label">Dora · {hero.label}</div>
          <h1>{hero.title}</h1>
          <p style={{ fontSize: 16, color: 'var(--ink-soft)', lineHeight: 1.55, maxWidth: 440, marginTop: 18 }}>{hero.text}</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
            <HeroButton films={films} onScan={onScan} style={{ padding: '14px 22px', fontSize: 15 }} />
            <Link to={films ? '/explore/films' : '/explore'} className="f-btn f-btn--ghost" style={{ padding: '14px 22px', fontSize: 15 }}>Browse</Link>
          </div>
        </div>
        <div className="d-fan">
          {picks.slice(0, 3).map((p, i) => {
            const rot = [-12, 2, 13][i], x = [-40, 90, 220][i], y = [40, 0, 60][i], z = i === 1 ? 3 : 1
            return (
              <div key={p.key} style={{ position: 'absolute', left: x, top: y, transform: `rotate(${rot}deg)`, zIndex: z, cursor: 'pointer' }}
                onClick={p.open}>
                {p.art(196)}
              </div>
            )
          })}
        </div>
      </div>

      <Colophon />

      <div style={{ marginTop: 44 }}>
        <div className="f-label" style={{ marginBottom: 4 }}>Recently added</div>
        {grid}
      </div>

      <Footer />
    </div>
  )
}

function Colophon() {
  return (
    <div className="d-colophon">
      <div className="aside">
        <div className="f-label cap">A note · why this thing exists</div>
      </div>
      <div className="essay">
        <p>Dora keeps a record of the books you own: read, reading, and not yet started.</p>
        <p>
          Book details come from <a href={LINKS.openLibrary} target="_blank" rel="noreferrer">Open Library</a>, the free and editable record of the world's books: covers, page counts, publishers and more. Dora adds your shelf, your notes, your photos and your hauls.
        </p>
        <p>It's free and open source. I built it for myself and put it online in case it's useful to you. The code, and the rest of my work, is at <a href={LINKS.author} target="_blank" rel="noreferrer">nty.et</a>.</p>
        <p style={{ fontSize: 14, color: 'var(--ink-faint)' }}>The name Dora is borrowed twice: from Freud's most famous case study, and from the explorer. Both kept intriguing notes.</p>
        <div className="meta">
          <a href={LINKS.author} target="_blank" rel="noreferrer"><Icon name="globe" size={13} /> nty.et</a>
          <a href={LINKS.source} target="_blank" rel="noreferrer"><Icon name="link" size={13} /> Open source</a>
        </div>
      </div>
    </div>
  )
}

function Footer() {
  return (
    <div className="d-footer">
      <div>
        <Logo size={19} />
        <div className="fine" style={{ marginTop: 14 }}>A record of the books you own. Free and open source.</div>
      </div>
      <div className="cols">
        <div className="col">
          <div className="f-label" style={{ marginBottom: 4 }}>Dora</div>
          <Link to="/">Home</Link>
          <Link to="/explore">Explore</Link>
          <Link to="/guide">User guide</Link>
        </div>
        <div className="col">
          <div className="f-label" style={{ marginBottom: 4 }}>Built on</div>
          <a href={LINKS.openLibrary} target="_blank" rel="noreferrer">Open Library <Icon name="external" size={12} /></a>
          <a href={LINKS.omdb} target="_blank" rel="noreferrer">OMDb <Icon name="external" size={12} /></a>
          <a href={LINKS.author} target="_blank" rel="noreferrer">nty.et <Icon name="external" size={12} /></a>
        </div>
      </div>
    </div>
  )
}
