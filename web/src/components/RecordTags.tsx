/* Hashtags inside a record, from the design's v2.jsx RecordTags: the book's
   authors and subjects, or the film's director and genres. Picking one
   closes the record and filters a shelf by it: the profile you're on, or
   your own. Signed out and away from a profile there's no shelf to filter,
   so they're plain labels. */

import { useSyncExternalStore } from 'react'
import { useLocation, useMatch, useNavigate } from 'react-router'
import { useMe } from '../api/me'
import { currentTags, subscribeTags, uniqueTags, type Tag } from '../lib/tagFilter'

export function RecordTags({ tags, kind }: { tags: Tag[]; kind: 'book' | 'film' }) {
  const on = useSyncExternalStore(subscribeTags, currentTags)
  const { data: me } = useMe()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const films = kind === 'film'
  // a profile of the same kind as this record: /profile, /u/x (books) or their /films twins
  const own = useMatch(films ? '/profile/films' : '/profile')
  const theirs = useMatch(films ? '/u/:handle/films' : '/u/:handle')
  const target = own || theirs ? pathname : me ? (films ? '/profile/films' : '/profile') : null
  if (!tags.length) return null

  // replace the record's history entry, so Back returns to before it opened
  const pick = (t: string) => target && navigate(target, { replace: target === pathname, state: { tag: t } })
  return (
    <div className="tf-tags" style={{ marginBottom: 20 }}>
      {uniqueTags(tags).map((x) => {
        const cls = 'tf-tag' + (x.g === 'p' ? ' p' : '') + (on.includes(x.t) ? ' on' : '')
        return target
          ? <button key={x.t} className={cls} onClick={() => pick(x.t)} title={'Show everything tagged ' + x.t}><i>#</i>{x.t}</button>
          : <span key={x.t} className={cls} style={{ cursor: 'default' }}><i>#</i>{x.t}</span>
      })}
    </div>
  )
}
