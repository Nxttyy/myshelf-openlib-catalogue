/* The frame around every auth page, from folio/auth.jsx AuthPage: a split
   screen (art panel with the drifting wall of covers, form on the right),
   which phones reflow to a band of art over the form (styles/mobile.css). It's a layout route, so
   moving between sign in / create account / reset keeps the frame (and the
   wall's animation) in place and only the form fades. */

import { useCallback, useEffect } from 'react'
import { Link, Outlet, useNavigate } from 'react-router'
import { useRecentFilms } from '../../api/films'
import { useRecentBooks } from '../../api/queries'
import { Icon } from '../../components/Icon'
import { Logo } from '../../components/Logo'
import { coverFromBook, jacketFor, PALETTES, type PaletteName } from '../../lib/covers'
import { useSplashDone } from '../../lib/splash'
import { themeClass, useMobileShell, useTheme } from '../../lib/theme'

export default function AuthLayout() {
  const [theme] = useTheme()
  useSplashDone()
  const mob = useMobileShell()
  const navigate = useNavigate()
  // Links between auth pages replace the history entry, so one step back
  // leaves the auth pages. A fresh tab (idx 0) has nowhere to go back to.
  const close = useCallback(() => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
    else navigate('/')
  }, [navigate])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [close])

  return (
    <div className={'d-app f-grain kc ' + themeClass(theme) + ' v2 auth-page' + (mob ? ' mob' : '')}>
      <div className="au-d">
        <div className="au-art">
          <AuthWall w={118} cols={5} /><div className="au-scrim" />
          <div className="au-art-top"><Link to="/" aria-label="Dora home" style={{ display: 'inline-block' }}><Logo size={22} /></Link></div>
          <div className="au-art-copy">
            <h2>Your books and films, in one place.</h2>
            <p>Keep track of what you own and what you've watched, write down what stayed with you, and see what friends are into.</p>
          </div>
        </div>
        <div className="au-d-main">
          <div className="au-d-top">
            <button className="au-back" onClick={close}><Icon name="arrow_left" size={16} /> Back to Dora</button>
            <span className="au-kbd">Esc</span>
          </div>
          <div className="au-d-center"><Outlet /></div>
        </div>
      </div>
    </div>
  )
}

type Tile = { key: string; title: string; palette: PaletteName; film: boolean }

/** Recently added books and films, interleaved, as flat typographic tiles
    drifting in tilted columns. Same data (and cache) as the home page. */
function AuthWall({ w, cols }: { w: number; cols: number }) {
  const books = useRecentBooks().data?.pages[0]?.entries ?? []
  const films = useRecentFilms().data?.pages[0]?.entries ?? []
  const items: Tile[] = []
  for (let i = 0; i < Math.max(books.length, films.length); i++) {
    const b = books[i]?.book, f = films[i]?.film
    if (b) items.push({ key: 'b' + b.id, title: b.title, palette: coverFromBook(b).palette, film: false })
    if (f) items.push({ key: 'f' + f.imdb_id, title: f.title, palette: jacketFor(f.imdb_id).palette, film: true })
  }
  if (!items.length) return null

  const columns = Array.from({ length: cols }, (_, c) => {
    const col = items.filter((_, i) => i % cols === c).slice(0, 4)
    return col.length ? col : items.slice(c % items.length, c % items.length + 3)
  })
  return (
    <div className="au-wall" aria-hidden="true">
      {columns.map((col, ci) => (
        <div key={ci} className={'au-col ' + (ci % 2 ? 'dn' : 'up')} style={{ animationDuration: (64 + ci * 9) + 's', marginTop: ci % 2 ? w * 0.6 : 0 }}>
          {[...col, ...col].map((x, i) => {
            const [bg, ink] = PALETTES[x.palette]
            return (
              <div key={x.key + i} className="au-item">
                <div className={'au-flat' + (x.film ? ' pf' : '')} style={{ width: w, background: bg, color: ink }}>
                  <span style={{ fontSize: Math.round(w * 0.11) }}>{x.title}</span>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
