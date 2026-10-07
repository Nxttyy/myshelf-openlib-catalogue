/* Home: the same landing for guests and signed-in users.
   Desktop: folio/desktop-app.jsx Landing (hero + cover fan, colophon,
   recently added grid, footer). Phone: folio/hero.jsx HeroStack, EssayNote,
   CommunityStrip and HomeFooter. */

import { Link } from 'react-router'
import { useRecentBooks } from '../api/queries'
import type { CatalogEntry } from '../api/types'
import { CatalogGrid } from '../components/CatalogGrid'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { Logo } from '../components/Logo'
import { coverFromBook } from '../lib/covers'
import { useOpenAdd, useOverlay } from '../lib/overlay'
import { LINKS } from '../lib/site'
import { useIsDesktop } from '../lib/useMediaQuery'

const HOME_SHELF = 12 // the home page shows the newest dozen; Explore has the rest

export default function Home() {
  const { data } = useRecentBooks()
  const entries = data?.pages[0]?.entries ?? []
  const onScan = useOpenAdd()
  const { open } = useOverlay('book')
  const onOpen = (e: CatalogEntry) => open(e.book.id)
  return useIsDesktop()
    ? <DesktopHome entries={entries} onScan={onScan} onOpen={onOpen} />
    : <MobileHome entries={entries} onScan={onScan} onOpen={onOpen} />
}

type HomeProps = { entries: CatalogEntry[]; onScan: () => void; onOpen: (e: CatalogEntry) => void }

// ── Desktop ──────────────────────────────────────────────────────────────

function DesktopHome({ entries, onScan, onOpen }: HomeProps) {
  const picks = entries.slice(0, 3)
  return (
    <div className="f-rise">
      <div className="d-hero">
        <div>
          <div className="f-label">Dora · a record of your books</div>
          <h1>Keep track of the books you own.</h1>
          <p style={{ fontSize: 16, color: 'var(--ink-soft)', lineHeight: 1.55, maxWidth: 440, marginTop: 18 }}>
            Scan a barcode. Dora finds the cover, author, and page count and adds the book to your shelf.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
            <button className="f-btn f-btn--amber" onClick={onScan} style={{ padding: '14px 22px', fontSize: 15 }}><Icon name="scan" size={18} sw={1.8} /> Scan a book</button>
            <Link to="/explore" className="f-btn f-btn--ghost" style={{ padding: '14px 22px', fontSize: 15 }}>Browse</Link>
          </div>
        </div>
        <div className="d-fan">
          {picks.map((e, i) => {
            const rot = [-12, 2, 13][i], x = [-40, 90, 220][i], y = [40, 0, 60][i], z = i === 1 ? 3 : 1
            return (
              <div key={e.book.id} style={{ position: 'absolute', left: x, top: y, transform: `rotate(${rot}deg)`, zIndex: z, cursor: 'pointer' }}
                onClick={() => onOpen(e)}>
                <Cover b={coverFromBook(e.book)} w={196} />
              </div>
            )
          })}
        </div>
      </div>

      <Colophon />

      <div style={{ marginTop: 44 }}>
        <div className="f-label" style={{ marginBottom: 4 }}>Recently added</div>
        <CatalogGrid entries={entries.slice(0, HOME_SHELF)} onOpen={onOpen} />
      </div>

      <Footer />
    </div>
  )
}

function Colophon() {
  return (
    <div className="d-colophon">
      <div className="aside">
        <div className="berry"><Logo size={40} /></div>
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
          <a href={LINKS.author} target="_blank" rel="noreferrer">nty.et <Icon name="external" size={12} /></a>
        </div>
      </div>
    </div>
  )
}

// ── Phone ────────────────────────────────────────────────────────────────

function MobileHome({ entries, onScan, onOpen }: HomeProps) {
  const picks = entries.slice(0, 3)
  return (
    <>
      <div className="f-rise" style={{ padding: '6px 18px 30px' }}>
        <div className="f-label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <span>Dora</span><span>a record of your books</span>
        </div>
        <h1 className="f-display" style={{ fontSize: 42, lineHeight: 0.98, margin: '0 0 18px' }}>Keep track of the books you own.</h1>
        <p style={{ fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.5, maxWidth: 320 }}>
          Scan a barcode. Dora finds the cover, author, and page count and adds the book to your shelf.
        </p>
        <div style={{ display: 'flex', gap: 9, marginTop: 22 }}>
          <button className="f-btn f-btn--amber" onClick={onScan} style={{ padding: '13px 18px', fontSize: 14.5 }}>
            <Icon name="scan" size={18} sw={1.8} /> Scan a book
          </button>
          <Link to="/explore" className="f-btn f-btn--ghost">Browse</Link>
        </div>

        {/* fanned covers */}
        <div style={{ position: 'relative', height: 230, marginTop: 30, display: 'flex', justifyContent: 'center' }}>
          {picks.map((e, i) => {
            const rot = [-13, 2, 14][i], x = [-96, 0, 96][i], y = [16, -8, 20][i]
            return (
              <div key={e.book.id} onClick={() => onOpen(e)}
                style={{ position: 'absolute', top: y, transform: `translateX(${x}px) rotate(${rot}deg)`, zIndex: i === 1 ? 3 : 1 }}>
                <Cover b={coverFromBook(e.book)} w={132} />
              </div>
            )
          })}
        </div>
      </div>

      <EssayNote />
      <CommunityStrip entries={entries.slice(0, HOME_SHELF)} onOpen={onOpen} />
      <HomeFooter />
    </>
  )
}

function EssayNote() {
  const linkStyle = { color: 'var(--ink)', textDecoration: 'none', boxShadow: 'inset 0 -1px 0 0 var(--amber)' }
  return (
    <div style={{ padding: '6px 18px 8px' }}>
      <div className="hero-rule" style={{ marginBottom: 20 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <span style={{ display: 'inline-flex', flexShrink: 0 }}><Logo size={20} /></span>
        <div className="f-label">A note · why this thing exists</div>
      </div>
      <p style={{ fontSize: 15.5, color: 'var(--ink)', lineHeight: 1.6, margin: '0 0 12px', letterSpacing: '-0.005em' }}>
        Dora keeps a record of the books you own: read, reading, and not yet started.
      </p>
      <p style={{ fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '0 0 12px' }}>
        Book details come from <a href={LINKS.openLibrary} target="_blank" rel="noreferrer" style={linkStyle}>Open Library</a>, the free and editable record of the world's books: covers, page counts, publishers and more. Dora adds your shelf, your notes, your photos and your hauls.
      </p>
      <p style={{ fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: 0 }}>
        It's free and open source. I built it for myself and put it online in case it's useful to you. The code, and the rest of my work, is at <a href={LINKS.author} target="_blank" rel="noreferrer" style={linkStyle}>nty.et</a>.
      </p>
      <p style={{ fontSize: 13, color: 'var(--ink-faint)', lineHeight: 1.6, margin: '12px 0 0' }}>
        The name Dora is borrowed twice: from Freud's most famous case study, and from the explorer. Both kept intriguing notes.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
        {([['nty.et', LINKS.author, 'globe'], ['Open source', LINKS.source, 'link']] as const).map(([label, href, ic]) => (
          <a key={label} href={href} target="_blank" rel="noreferrer" className="f-link"><Icon name={ic} size={12} />{label}</a>
        ))}
      </div>
    </div>
  )
}

function CommunityStrip({ entries, onOpen }: { entries: CatalogEntry[]; onOpen: (e: CatalogEntry) => void }) {
  return (
    <div style={{ padding: '4px 0 24px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 18px 12px' }}>
        <div className="f-label">Recently added</div>
        <Link to="/explore" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', color: 'var(--ink)', textTransform: 'uppercase', textDecoration: 'none', padding: '8px 0' }}>
          All →
        </Link>
      </div>
      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', padding: '4px 18px 8px', scrollbarWidth: 'none' }}>
        {entries.map((e) => (
          <div key={e.book.id} style={{ flexShrink: 0, width: 110, cursor: 'pointer' }} role="button" tabIndex={0}
            aria-label={e.book.title} onClick={() => onOpen(e)} onKeyDown={(ev) => { if (ev.key === 'Enter') onOpen(e) }}>
            <Cover b={coverFromBook(e.book)} w={110} />
            <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{e.book.title}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>{e.book.authors?.[0]?.name}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HomeFooter() {
  const link = { fontSize: 14, color: 'var(--ink-soft)', textDecoration: 'none' }
  return (
    <div style={{ padding: '24px 18px 30px', marginTop: 8, borderTop: '1px solid var(--hair)' }}>
      <Logo size={18} />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.04em', lineHeight: 1.6, margin: '12px 0 18px', maxWidth: 260 }}>
        A record of the books you own. Free and open source.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        <Link to="/guide" style={link}>User guide</Link>
        <a href={LINKS.openLibrary} target="_blank" rel="noreferrer" style={link}>Open Library</a>
        <a href={LINKS.author} target="_blank" rel="noreferrer" style={link}>nty.et</a>
      </div>
    </div>
  )
}
