/* Books / Films: the sliding two-way switch (folio/taste.jsx MediaSwitch),
   in the navbar, and full width under the phone header. Counts show for
   your own library when you're signed in. B and F switch too (lib/media.ts). */

import { useMe } from '../api/me'
import { useMedia, useSetMedia, type Media } from '../lib/media'
import { Icon } from './Icon'

export function MediaTabs({ wide }: { wide?: boolean }) {
  const media = useMedia()
  const setMedia = useSetMedia()
  const { data: me } = useMe()
  const n: Record<Media, number> | null = me ? { books: me.book_count, films: me.film_count } : null
  return (
    <div className={'m-switch' + (wide ? ' m-switch--wide' : '')} data-on={media} role="tablist" aria-label="Library">
      <span className="thumb" aria-hidden="true" />
      {([['books', 'Books', 'bookopen'], ['films', 'Films', 'film']] as const).map(([id, label, icon]) => (
        <button key={id} role="tab" aria-selected={media === id} className={media === id ? 'on' : ''} onClick={() => setMedia(id)}
          title={`Show ${label.toLowerCase()}` + (wide ? '' : ` · press ${label[0]}`)}>
          <Icon name={icon} size={wide ? 18 : 15} sw={1.7} />{label}{n && <span className="ct">{n[id]}</span>}
        </button>
      ))}
    </div>
  )
}
