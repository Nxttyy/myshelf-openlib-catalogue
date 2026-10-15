/* Books / Films: the big word tabs at the top of Home, Explore and
   profiles (folio/films.jsx MediaTabs). Counts show for your own library
   when you're signed in. */

import { useMe } from '../api/me'
import { useMedia, useSetMedia, type Media } from '../lib/media'
import { useIsDesktop } from '../lib/useMediaQuery'

export function MediaTabs({ counts = true }: { counts?: boolean }) {
  const media = useMedia()
  const setMedia = useSetMedia()
  const { data: me } = useMe()
  const desktop = useIsDesktop()
  const n: Record<Media, number> | null = me && counts ? { books: me.book_count, films: me.film_count } : null
  return (
    <div className="d-mtabs" role="tablist" aria-label="Library">
      {([['books', 'Books'], ['films', 'Films']] as const).map(([id, label]) => (
        <button key={id} role="tab" aria-selected={media === id} className={media === id ? 'on' : ''} onClick={() => setMedia(id)}>
          {label}{n && <sup>{n[id]}</sup>}
        </button>
      ))}
      {desktop && <span className="hint">Press B or F</span>}
    </div>
  )
}
