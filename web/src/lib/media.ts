/* Books or films: which library a page shows. The URL says so, so a
   films page can be shared and reloaded: /explore/films, /profile/films,
   /u/:handle/films, and /?m=films for home (/films itself is the API).
   Pages with one view only (guide, 404) keep the last choice, and the
   navbar tabs switch it there without leaving the page. */

import { useEffect, useSyncExternalStore } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

export type Media = 'books' | 'films'

const FILMS_PAGE = /^\/(explore|profile|u\/[^/]+)\/films\/?$/
const BOOKS_PAGE = /^\/(explore|profile|u\/[^/]+)\/?$/

let last: Media = 'books'
const listeners = new Set<() => void>()
function remember(m: Media) {
  if (m === last) return
  last = m
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

function mediaOf(pathname: string, search: string): Media | null {
  if (FILMS_PAGE.test(pathname)) return 'films'
  if (pathname === '/') return new URLSearchParams(search).get('m') === 'films' ? 'films' : 'books'
  if (BOOKS_PAGE.test(pathname)) return 'books'
  return null
}

export function useMedia(): Media {
  const { pathname, search } = useLocation()
  const m = mediaOf(pathname, search)
  const remembered = useSyncExternalStore(subscribe, () => last)
  useEffect(() => { if (m) remember(m) }, [m])
  return m ?? remembered
}

/** Where a base page (/, /explore, /profile, /u/:handle) lives for `media`. */
export function mediaPath(base: string, media: Media) {
  if (base === '/') return media === 'films' ? '/?m=films' : '/'
  return media === 'films' ? base.replace(/\/$/, '') + '/films' : base
}

/** Switch to the other library: the same page's twin where it has one,
    otherwise just the remembered choice (navbar links and Add follow it). */
export function useSetMedia() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  return (media: Media) => {
    const current = mediaOf(pathname, search)
    remember(media)
    if (current === null || current === media) return
    const base = pathname.replace(/\/films\/?$/, '') || '/'
    navigate(mediaPath(base, media))
  }
}

/** B and F switch libraries, as in the design. Off while typing, with a
    modifier held, or when an overlay is open. */
export function useMediaKeys() {
  const setMedia = useSetMedia()
  const [params] = useSearchParams()
  const overlay = ['add', 'addfilm', 'book', 'film'].some((p) => params.has(p))
  useEffect(() => {
    if (overlay) return
    function key(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const t = e.target as HTMLElement
      if (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable) return
      if (e.key === 'b' || e.key === 'B') setMedia('books')
      else if (e.key === 'f' || e.key === 'F') setMedia('films')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
}
