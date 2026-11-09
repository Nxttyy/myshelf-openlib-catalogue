/* Search, hashtags and status for a shelf: the design's v2.jsx DoraFilter.
   Books are tagged by their authors (people) and subjects; films by their
   director (people) and genres. A shelf entry matches when it has every
   picked tag, the picked status, and the search text somewhere in its
   title, people or tags.

   Open Library subjects are noisy (catalogue housekeeping, a hundred per
   book on some editions), so a book contributes only its first few real
   subjects, the same ones its record shows. */

import type { Book, FilmShelfEntry, ShelfEntry } from '../api/types'

export type Tag = { t: string; g: 'p' | 'g' } // p: a person, g: a subject / genre
export type ShelfFilter = { q: string; tags: string[]; status: string | null }
export const EMPTY_FILTER: ShelfFilter = { q: '', tags: [], status: null }

const SUBJECTS_PER_BOOK = 8
const JUNK = [
  /^general$/i, /^accessible book$/i, /^protected daisy$/i, /^in library$/i, /^lending library$/i,
  /large type/i, /new york times/i, /^nyt:/i, /long now manual/i, /^translations into /i,
  /^early works to /i, /^readers$/i, /^sources$/i, /^open[_ ]syllabus/i, /^overdrive/i, /^internet archive/i,
]
const tidy = (s: string) => s.trim().replace(/\s+/g, ' ')

/** The subjects worth showing for a book: no catalogue noise, no near-duplicates. */
export function bookSubjects(book: Pick<Book, 'subjects'>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of book.subjects ?? []) {
    const name = tidy(s.name)
    const key = name.toLowerCase()
    if (!name || name.length > 40 || JUNK.some((re) => re.test(name)) || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length === SUBJECTS_PER_BOOK) break
  }
  return out
}

export function bookTags(book: Book): Tag[] {
  return [
    ...(book.authors ?? []).map((a) => ({ t: tidy(a.name), g: 'p' as const })),
    ...bookSubjects(book).map((t) => ({ t, g: 'g' as const })),
  ].filter((x) => x.t)
}

const split = (v?: string | null) => (v && v !== 'N/A' ? v.split(',').map(tidy).filter(Boolean) : [])

export function filmTags(film: FilmShelfEntry['film']): Tag[] {
  return [...split(film.director).map((t) => ({ t, g: 'p' as const })), ...film.genres.map(tidy).filter(Boolean).map((t) => ({ t, g: 'g' as const }))]
}

export type Taggable = { status: string; tags: Tag[]; text: string }

export function taggableBook(e: ShelfEntry): Taggable {
  const tags = bookTags(e.book)
  return { status: e.status, tags, text: [e.book.title, e.book.subtitle ?? '', ...tags.map((x) => x.t)].join(' ').toLowerCase() }
}

export function taggableFilm(e: FilmShelfEntry): Taggable {
  const tags = filmTags(e.film)
  return { status: e.status, tags, text: [e.film.title, e.film.actors ?? '', e.film.writer ?? '', ...tags.map((x) => x.t)].join(' ').toLowerCase() }
}

export const isFiltering = (f: ShelfFilter) => !!(f.q.trim() || f.tags.length || f.status)

export function matches(it: Taggable, f: ShelfFilter) {
  if (f.status && it.status !== f.status) return false
  if (f.tags.length) {
    const names = it.tags.map((x) => x.t)
    if (!f.tags.every((t) => names.includes(t))) return false
  }
  const q = f.q.trim().toLowerCase()
  return !q || it.text.includes(q)
}

export type TagCount = Tag & { n: number }

/** One of each tag name (an author can also be listed as a subject). */
export function uniqueTags(tags: Tag[]): Tag[] {
  const seen = new Set<string>()
  return tags.filter((x) => !seen.has(x.t) && seen.add(x.t))
}

/** Every tag on the shelf with how many entries carry it, most used first
    (people before subjects on a tie, then A to Z). */
export function collectTags(items: Taggable[]): TagCount[] {
  const m = new Map<string, TagCount>()
  for (const it of items) for (const { t, g } of uniqueTags(it.tags)) {
    const k = m.get(t) ?? { t, g, n: 0 }
    k.n++
    m.set(t, k)
  }
  return [...m.values()].sort((a, b) => b.n - a.n || (a.g === b.g ? 0 : a.g === 'p' ? -1 : 1) || a.t.localeCompare(b.t))
}

// The tags filtering the profile on screen, so a record opened over it can
// show which of its own tags are already on (the design's DoraCurrentTags).
let current: string[] = []
const listeners = new Set<() => void>()
export function publishTags(tags: string[]) {
  current = tags
  listeners.forEach((l) => l())
}
export const subscribeTags = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const currentTags = () => current
