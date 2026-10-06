/* App shell. Desktop (>=900px) gets the design's top navbar; phones get the
   mobile design's header and bottom tab bar. Both render, CSS picks one
   (see styles/app.css), so a resize never remounts the page underneath. */

import { lazy, Suspense, useEffect } from 'react'
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useSearchParams } from 'react-router'
import { initials, useMe, type Me } from '../api/me'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/icons'
import { BookOverlay } from '../components/BookRecord'
import { useQueue } from '../lib/queue'
import { Logo } from '../components/Logo'
import { useOpenAdd } from '../lib/overlay'
import { pageImports } from '../router'

// The add dialog (scanner, search, by-hand form) loads on first open, or
// earlier when the browser is idle.
const loadAddDialog = () => import('../components/add/AddDialog')
const AddOverlay = lazy(() => loadAddDialog().then((m) => ({ default: m.AddOverlay })))

/** Fetch the other pages' code once the first page has settled. */
function usePrefetchPages() {
  useEffect(() => {
    const go = () => { Object.values(pageImports).forEach((load) => load()); loadAddDialog() }
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    const id = idle(go)
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(id)
  }, [])
}

type ShellProps = { me: Me | null | undefined; queueCount: number; onAdd: () => void }

const NAV: [string, string][] = [['/', 'Home'], ['/explore', 'Explore'], ['/guide', 'Guide']]

function Navbar({ me, queueCount, onAdd }: ShellProps) {
  const links = me ? [...NAV, ['/profile', 'Profile'] as [string, string]] : NAV
  return (
    <div className="d-nav">
      <Link to="/" aria-label="Dora home" className="home-link"><Logo size={21} /></Link>
      <nav className="d-navlinks">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'd-navlink' + (isActive ? ' on' : '')}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      <button className="f-btn f-btn--amber d-addbtn" onClick={onAdd} style={{ padding: '10px 16px' }}>
        <Icon name="plus" size={18} sw={1.9} /> Add book
        {queueCount > 0 && <span className="badge">{queueCount}</span>}
      </button>
      {me
        ? <Link to="/profile" className="d-avatar" aria-label="Your profile">{initials(me)}</Link>
        : <Link to="/login" className="f-btn f-btn--ink">Sign in</Link>}
    </div>
  )
}

function MobileHeader({ me, queueCount, onAdd }: ShellProps) {
  return (
    <div className="f-header m-header">
      <Link to="/" aria-label="Dora home" className="home-link"><Logo /></Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button className="f-iconbtn" onClick={onAdd} aria-label="Add book">
          <Icon name="plus" size={22} sw={1.8} />
          {queueCount > 0 && <span className="badge">{queueCount}</span>}
        </button>
        {me
          ? <Link to="/profile" className="f-iconbtn" aria-label="Your profile"><span className="m-avatar">{initials(me)}</span></Link>
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

function TabBar({ me }: { me: Me | null | undefined }) {
  const { pathname } = useLocation()
  // Pages without a tab of their own (guide, 404, ...) light up Home, as in the design.
  const active = pathname.startsWith('/explore') ? 'explore' : pathname.startsWith('/profile') ? 'profile' : 'home'
  return (
    <nav className="f-tabbar">
      {TABS.map((t) => {
        const on = active === t.id
        const to = t.id === 'profile' && !me ? '/login' : t.to
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
  const onAdd = useOpenAdd()
  const queueCount = useQueue().items.length

  return (
    <div className="d-app f-grain kc th-navy">
      <Navbar me={me} queueCount={queueCount} onAdd={onAdd} />
      <MobileHeader me={me} queueCount={queueCount} onAdd={onAdd} />
      <main className="d-scroll"><div className="d-wrap"><Outlet /></div></main>
      <TabBar me={me} />
      <BookOverlay />
      {params.has('add') && <Suspense fallback={null}><AddOverlay /></Suspense>}
      {/* keyed by path, so opening an overlay (a ?param change) keeps your place */}
      <ScrollRestoration getKey={(loc) => loc.pathname} />
    </div>
  )
}
