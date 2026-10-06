/* The scan queue: books picked in the add dialog, waiting to be saved.
   It lives outside the dialog (the navbar badge shows its size) and in
   sessionStorage, so closing the dialog, changing pages, or signing in
   halfway through keeps it. */

import { useSyncExternalStore } from 'react'
import type { ManualBookCreate } from '../api/types'

export type SearchHit = {
  key: string; title: string; authors: string[]; isbns: string[]
  cover_url: string | null; first_publish_year: number | null
}

/** Exactly one source per item, matching BatchUserBookEntry in the API. */
export type QueueSource =
  | { isbn: string }
  | { book: SearchHit }
  | { book_id: string }
  | { manual: ManualBookCreate & { cover_preview?: string | null } }

export type QueueItem = {
  key: string
  title: string
  sub: string
  coverUrl: string | null
  /** isbn items resolve their title in the background */
  state: 'ready' | 'looking' | 'notfound' | 'limited'
  source: QueueSource
  /** what Ask Dora is asked about */
  ask: { title: string; authors: string[]; isbn: string | null; context: string | null }
}

export type Batch = { status: 'unread' | 'reading' | 'read'; visibility: 'public' | 'private' }

type State = { items: QueueItem[]; batch: Batch }

const KEY = 'dora.queue.v1'
const listeners = new Set<() => void>()

function load(): State {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch { /* storage blocked or corrupt: start empty */ }
  return { items: [], batch: { status: 'unread', visibility: 'public' } }
}

let state: State = load()

function set(next: State) {
  state = next
  try { sessionStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
  listeners.forEach((l) => l())
}

export const queue = {
  get: () => state,
  has: (key: string) => state.items.some((i) => i.key === key),
  /** Newest first, as the old queue showed them. Returns false if already queued. */
  add(item: QueueItem) {
    if (queue.has(item.key)) return false
    set({ ...state, items: [item, ...state.items] })
    return true
  },
  update(key: string, patch: Partial<QueueItem>) {
    set({ ...state, items: state.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) })
  },
  remove(key: string) { set({ ...state, items: state.items.filter((i) => i.key !== key) }) },
  clear() { set({ ...state, items: [] }) },
  setBatch(batch: Partial<Batch>) { set({ ...state, batch: { ...state.batch, ...batch } }) },
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useQueue = () => useSyncExternalStore(subscribe, queue.get)

/** The batch endpoint's entries, with the dialog-wide status/visibility.
    Oldest first (the queue shows newest first), so books land on the shelf
    in the order they were scanned, as before. */
export function toBatchEntries(s: State) {
  return [...s.items].reverse().map((i) => {
    const base = { is_public: s.batch.visibility === 'public', status: s.batch.status, comment: '' }
    const src = i.source
    if ('manual' in src) { const { cover_preview: _p, ...manual } = src.manual; return { ...base, manual } }
    if ('book_id' in src) return { ...base, book_id: src.book_id }
    if ('book' in src) return { ...base, book: src.book }
    return { ...base, isbn: src.isbn }
  })
}
