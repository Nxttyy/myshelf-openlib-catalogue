/* App shell, from the design's desktop-app-v2.jsx: one navbar for every
   screen size, with the install banner under it. Below 900px the shell gets
   the design's `.mob` class (styles/mobile.css reflows the same components
   for a phone) and the bottom tabs. */

import { lazy, Suspense, useEffect } from 'react'
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useSearchParams } from 'react-router'
import { useMe, type Me } from '../api/me'
import { AccountMenu } from '../components/AccountMenu'
import { InstallBanner, InstallSheet } from '../components/InstallApp'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/icons'
import { BookOverlay } from '../components/BookRecord'
import { useFilmQueue } from '../lib/filmQueue'
import { mediaPath, useMedia, useMediaKeys, type Media } from '../lib/media'
import { useQueue } from '../lib/queue'
import { Logo } from '../components/Logo'
import { MediaTabs } from '../components/MediaTabs'
import { useOpenAdd } from '../lib/overlay'
import { useSplashDone } from '../lib/splash'
import { themeClass, useMobileShell, useTheme } from '../lib/theme'
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

/** The design's navbar. On phones (.mob, styles/mobile.css) the same bar
    wraps: logo, add, avatar, then Books / Films full width; the page links
    move to the bottom tabs. */
function Navbar({ me, queueCount, onAdd, media }: ShellProps) {
  const links = me ? [...NAV, ['/profile', 'Profile'] as [string, string]] : NAV
  return (
    <div className="d-nav">
      <Link to={mediaPath('/', media)} aria-label="Dora home" className="home-link"><Logo size={21} /></Link>
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
        ? <AccountMenu me={me} media={media} />
        : <Link to="/login" className="f-btn f-btn--ink">Sign in</Link>}
    </div>
  )
}

/** Phones: Home, Explore, and Profile once you're signed in. */
function MobileTabs({ me, media }: { me: Me | null | undefined; media: Media }) {
  const { pathname } = useLocation()
  const active = pathname === '/' ? 'home' : pathname.startsWith('/explore') ? 'explore' : pathname.startsWith('/profile') ? 'profile' : null
  const tabs: [string, string, string, IconName][] = [['home', '/', 'Home', 'home'], ['explore', '/explore', 'Explore', 'compass']]
  if (me) tabs.push(['profile', '/profile', 'Profile', 'user'])
  return (
    <nav className="mob-tabs">
      {tabs.map(([id, to, label, icon]) => {
        const on = active === id
        return (
          <Link key={id} to={mediaPath(to, media)} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
            <Icon name={icon} size={21} sw={on ? 2 : 1.6} /><span>{label}</span>
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
  const [theme] = useTheme()
  useSplashDone()
  const mob = useMobileShell()

  return (
    <div className={'d-app f-grain kc ' + themeClass(theme) + ' v2' + (mob ? ' mob' : '')}>
      <header className="app-top">
        <Navbar me={me} queueCount={queueCount} onAdd={onAdd} media={media} />
        <InstallBanner mobile={mob} />
      </header>
      <main className="d-scroll"><div className="d-wrap"><Outlet /></div></main>
      {mob && <MobileTabs me={me} media={media} />}
      <InstallSheet mobile={mob} />
      <BookOverlay />
      {params.has('add') && <Suspense fallback={null}><AddOverlay /></Suspense>}
      {params.has('film') && <Suspense fallback={null}><FilmOverlay /></Suspense>}
      {params.has('addfilm') && <Suspense fallback={null}><FilmAddOverlay /></Suspense>}
      {/* keyed by path, so opening an overlay (a ?param change) keeps your place */}
      <ScrollRestoration getKey={(loc) => loc.pathname} />
    </div>
  )
}
