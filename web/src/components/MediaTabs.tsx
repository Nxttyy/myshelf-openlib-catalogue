/* Books / Films: the library tabs in the navbar (folio/films.jsx
   MediaTabs), and in the phone header. Counts show for your own library
   when you're signed in. B and F switch too (lib/media.ts). */

import { useMe } from '../api/me'
import { useMedia, useSetMedia, type Media } from '../lib/media'

export function MediaTabs() {
  const media = useMedia()
  const setMedia = useSetMedia()
  const { data: me } = useMe()
  const n: Record<Media, number> | null = me ? { books: me.book_count, films: me.film_count } : null
  return (
    <div className="d-mtabs" role="tablist" aria-label="Library">
      {([['books', 'Books'], ['films', 'Films']] as const).map(([id, label]) => (
        <button key={id} role="tab" aria-selected={media === id} className={media === id ? 'on' : ''} onClick={() => setMedia(id)}
          title={`Show ${label.toLowerCase()} · press ${label[0]}`}>
          {label}{n && <sup>{n[id]}</sup>}
        </button>
      ))}
    </div>
  )
}
