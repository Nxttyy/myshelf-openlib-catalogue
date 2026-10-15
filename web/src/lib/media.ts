/* Books or films: which library a page shows. The URL says so, so a
   films page can be shared and reloaded: /explore/films, /profile/films,
   /u/:handle/films, and /?m=films for home (/films itself is the API).
   Pages without the tabs (guide, 404) keep the last one, so the navbar
   and the Add button don't flip back to books there. */

import { useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

export type Media = 'books' | 'films'

const FILMS_PAGE = /^\/(explore|profile|u\/[^/]+)\/films\/?$/
const BOOKS_PAGE = /^\/(explore|profile|u\/[^/]+)\/?$/

let last: Media = 'books'

function mediaOf(pathname: string, search: string): Media | null {
  if (FILMS_PAGE.test(pathname)) return 'films'
  if (pathname === '/') return new URLSearchParams(search).get('m') === 'films' ? 'films' : 'books'
  if (BOOKS_PAGE.test(pathname)) return 'books'
  return null
}

export function useMedia(): Media {
  const { pathname, search } = useLocation()
  const m = mediaOf(pathname, search)
  useEffect(() => { if (m) last = m }, [m])
  return m ?? last
}

/** Where a base page (/, /explore, /profile, /u/:handle) lives for `media`. */
export function mediaPath(base: string, media: Media) {
  if (base === '/') return media === 'films' ? '/?m=films' : '/'
  return media === 'films' ? base.replace(/\/$/, '') + '/films' : base
}

/** Switch the current page to the other library, keeping any open overlay out. */
export function useSetMedia() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  return (media: Media) => {
    if (mediaOf(pathname, search) === media) return
    last = media
    const base = pathname.replace(/\/films\/?$/, '') || '/'
    navigate(mediaPath(base, media))
  }
}

/** B and F switch libraries, as in the design. Off while typing, with a
    modifier held, or when an overlay is open. */
export function useMediaKeys() {
  const setMedia = useSetMedia()
  const [params] = useSearchParams()
  const { pathname, search } = useLocation()
  const tabbed = mediaOf(pathname, search) !== null
  const overlay = ['add', 'addfilm', 'book', 'film'].some((p) => params.has(p))
  useEffect(() => {
    if (!tabbed || overlay) return
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
