/* Small film formatting helpers shared by the film views. */

import type { Film } from '../api/types'
import type { ReadingStatus } from '../components/StatusBadge'

// Films share the book statuses (and their colours); only the words change.
export const FILM_LABELS: Record<ReadingStatus, string> = { unread: 'Not watched', reading: 'Watching', read: 'Watched' }

/** 89 → "1h 29m", as in the design. */
export const runtime = (f: Pick<Film, 'runtime_min'>) => {
  const m = f.runtime_min ?? 0
  return m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : 'Not set'
}

export const credit = (f: Pick<Film, 'director' | 'type'>) => f.director || (f.type === 'series' ? 'Series' : 'Unknown')

export function filmLinks(f: Pick<Film, 'imdb_id' | 'title' | 'year'>) {
  const q = encodeURIComponent(`${f.title} ${f.year ?? ''}`.trim())
  return [
    { label: 'IMDb', href: `https://www.imdb.com/title/${f.imdb_id}/` },
    { label: 'Letterboxd', href: `https://letterboxd.com/imdb/${f.imdb_id}/` },
    { label: 'JustWatch', href: `https://www.justwatch.com/us/search?q=${q}` },
  ]
}
