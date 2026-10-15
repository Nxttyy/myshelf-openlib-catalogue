/* App shell. Desktop (>=900px) gets the design's top navbar; phones get the
   mobile design's header and bottom tab bar. Both render, CSS picks one
   (see styles/app.css), so a resize never remounts the page underneath. */

import { lazy, Suspense, useEffect } from 'react'
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useSearchParams } from 'react-router'
import { initials, useMe, type Me } from '../api/me'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/icons'
import { BookOverlay } from '../components/BookRecord'
import { useFilmQueue } from '../lib/filmQueue'
import { mediaPath, useMedia, useMediaKeys, type Media } from '../lib/media'
import { useQueue } from '../lib/queue'
import { Logo } from '../components/Logo'
import { MediaTabs } from '../components/MediaTabs'
import { useOpenAdd } from '../lib/overlay'
import { pageImports } from '../router'

// The add dialog (scanner, search, by-hand form) loads on first open, or
// earlier when the browser is idle.
const loadAddDialog = () => import('../components/add/AddDialog')
const AddOverlay = lazy(() => loadAddDialog().then((m) => ({ default: m.AddOverlay })))
// Films: the add dialog and the film record, also on demand.
const loadFilmDialog = () => import('../components/add/FilmAddDialog')
const FilmAddOverlay = lazy(() => loadFilmDialog().then((m) => ({ default: m.FilmAddOverlay })))
const FilmOverlay = lazy(() => import('../components/FilmRecord').then((m) => ({ default: m.FilmOverlay })))

/** Fetch the other pages' code once the first page has settled. */
function usePrefetchPages() {
  useEffect(() => {
    const go = () => { Object.values(pageImports).forEach((load) => load()); loadAddDialog(); loadFilmDialog() }
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    const id = idle(go)
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(id)
  }, [])
}

type ShellProps = { me: Me | null | undefined; queueCount: number; onAdd: () => void; media: Media }

const NAV: [string, string][] = [['/', 'Home'], ['/explore', 'Explore'], ['/guide', 'Guide']]

function Navbar({ me, queueCount, onAdd, media }: ShellProps) {
  const links = me ? [...NAV, ['/profile', 'Profile'] as [string, string]] : NAV
  return (
    <div className="d-nav">
      <Link to="/" aria-label="Dora home" className="home-link"><Logo size={21} /></Link>
      <nav className="d-navlinks">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to === '/guide' ? to : mediaPath(to, media)} end={to === '/'} className={({ isActive }) => 'd-navlink' + (isActive ? ' on' : '')}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      <MediaTabs />
      <button className="f-btn f-btn--amber d-addbtn" onClick={onAdd} style={{ padding: '10px 16px' }}>
        <Icon name="plus" size={18} sw={1.9} /> {media === 'films' ? 'Add film' : 'Add book'}
        {queueCount > 0 && <span className="badge">{queueCount}</span>}
      </button>
      {me
        ? <Link to={mediaPath('/profile', media)} className="d-avatar" aria-label="Your profile">{initials(me)}</Link>
        : <Link to="/login" className="f-btn f-btn--ink">Sign in</Link>}
    </div>
  )
}

function MobileHeader({ me, queueCount, onAdd, media }: ShellProps) {
  return (
    <div className="f-header m-header">
      <Link to="/" aria-label="Dora home" className="home-link"><Logo /></Link>
      <MediaTabs />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button className="f-iconbtn" onClick={onAdd} aria-label={media === 'films' ? 'Add film' : 'Add book'}>
          <Icon name="plus" size={22} sw={1.8} />
          {queueCount > 0 && <span className="badge">{queueCount}</span>}
        </button>
        {me
          ? <Link to={mediaPath('/profile', media)} className="f-iconbtn" aria-label="Your profile"><span className="m-avatar">{initials(me)}</span></Link>
          : <Link to="/login" className="f-btn f-btn--ink">Sign in</Link>}
      </div>
    </div>
  )
}

const TABS: { id: string; to: string; label: string; icon: IconName }[] = [
  { id: 'home', to: '/', label: 'Home', icon: 'home' },
  { id: 'explore', to: '/explore', label: 'Explore', icon: 'compass' },
  { id: 'profile', to: '/profile', label: 'Profile', icon: 'user' },
]

function TabBar({ me, media }: { me: Me | null | undefined; media: Media }) {
  const { pathname } = useLocation()
  // Pages without a tab of their own (guide, 404, ...) light up Home, as in the design.
  const active = pathname.startsWith('/explore') ? 'explore' : pathname.startsWith('/profile') ? 'profile' : 'home'
  return (
    <nav className="f-tabbar">
      {TABS.map((t) => {
        const on = active === t.id
        const to = t.id === 'profile' && !me ? '/login' : mediaPath(t.to, media)
        return (
          <Link key={t.id} to={to} className={'f-tab' + (on ? ' active' : '')} aria-current={on ? 'page' : undefined}>
            <Icon name={t.icon} size={22} sw={on ? 2 : 1.6} />
            <span>{t.label}</span>
            <span className="dot" />
          </Link>
        )
      })}
    </nav>
  )
}

export default function AppLayout() {
  const { data: me } = useMe()
  const [params] = useSearchParams()
  usePrefetchPages()
  useMediaKeys()
  const media = useMedia()
  const onAdd = useOpenAdd()
  const bookQueue = useQueue().items.length
  const filmQueue = useFilmQueue().items.length
  const queueCount = media === 'films' ? filmQueue : bookQueue

  return (
    <div className="d-app f-grain kc th-navy">
      <Navbar me={me} queueCount={queueCount} onAdd={onAdd} media={media} />
      <MobileHeader me={me} queueCount={queueCount} onAdd={onAdd} media={media} />
      <main className="d-scroll"><div className="d-wrap"><Outlet /></div></main>
      <TabBar me={me} media={media} />
      <BookOverlay />
      {params.has('add') && <Suspense fallback={null}><AddOverlay /></Suspense>}
      {params.has('film') && <Suspense fallback={null}><FilmOverlay /></Suspense>}
      {params.has('addfilm') && <Suspense fallback={null}><FilmAddOverlay /></Suspense>}
      {/* keyed by path, so opening an overlay (a ?param change) keeps your place */}
      <ScrollRestoration getKey={(loc) => loc.pathname} />
    </div>
  )
}
