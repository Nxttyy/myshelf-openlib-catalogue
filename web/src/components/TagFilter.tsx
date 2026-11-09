/* Shelf search and the hashtag bar, from the design's v2.jsx TagSearch and
   TagFilter (the `noSearch` form the profile uses, with the search box up in
   the profile header instead). */

import { useState } from 'react'
import { collectTags, EMPTY_FILTER, isFiltering, type ShelfFilter, type Taggable } from '../lib/tagFilter'
import { Icon } from './Icon'

export function TagSearch({ value, onChange, placeholder }: { value: ShelfFilter; onChange: (f: ShelfFilter) => void; placeholder: string }) {
  return (
    <label className="tf-search">
      <Icon name="search" size={16} />
      <input value={value.q} onChange={(e) => onChange({ ...value, q: e.target.value })} placeholder={placeholder}
        aria-label={placeholder} enterKeyHint="search" />
      {value.q && <button className="x" onClick={() => onChange({ ...value, q: '' })} aria-label="Clear search"><Icon name="close" size={14} /></button>}
    </label>
  )
}

export function TagFilter({ items, value, onChange, shown, kindWord, mine }: {
  items: Taggable[]; value: ShelfFilter; onChange: (f: ShelfFilter) => void; shown: number; kindWord: 'books' | 'films'; mine: boolean
}) {
  const [more, setMore] = useState(false)
  const lim = 12 // tags shown before "+N more"
  const all = collectTags(items)
  const active = all.filter((x) => value.tags.includes(x.t))
  const rest = all.filter((x) => !value.tags.includes(x.t))
  const room = Math.max(0, lim - active.length)
  const list = [...active, ...(more ? rest : rest.slice(0, room))]
  const toggle = (t: string) => onChange({ ...value, tags: value.tags.includes(t) ? value.tags.filter((x) => x !== t) : [...value.tags, t] })
  const busy = isFiltering(value)
  if (!all.length && !busy) return null
  return (
    <div className="tf">
      <div className="tf-top">
        <span className="f-label" role="status">{busy ? `Showing ${shown} of ${items.length} ${kindWord}` : 'Filter by tag'}</span>
        <button className={'tf-clear tf-clear--btn' + (busy ? '' : ' off')} disabled={!busy} onClick={() => onChange(EMPTY_FILTER)}>
          <Icon name="close" size={12} /> Clear filters
        </button>
      </div>
      <div className="tf-tags">
        {list.map((x) => (
          <button key={x.t} className={'tf-tag' + (value.tags.includes(x.t) ? ' on' : '') + (x.g === 'p' ? ' p' : '')}
            aria-pressed={value.tags.includes(x.t)} onClick={() => toggle(x.t)}>
            <i>#</i>{x.t}<span className="ct">{x.n}</span>
          </button>
        ))}
        {rest.length > room && <button className="tf-more" onClick={() => setMore((m) => !m)}>{more ? 'Fewer' : `+${rest.length - room} more`}</button>}
      </div>
      {busy && shown === 0 && <div className="tf-empty">Nothing on {mine ? 'your' : 'this'} shelf matches. Try removing a tag.</div>}
    </div>
  )
}
