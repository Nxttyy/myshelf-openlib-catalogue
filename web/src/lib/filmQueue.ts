/* The film queue: films picked in the add dialog, waiting to be saved.
   Same idea as the book queue (lib/queue.ts), kept apart so the two never
   mix: it lives outside the dialog and in sessionStorage, so closing the
   dialog, switching pages or signing in halfway keeps it. */

import { useSyncExternalStore } from 'react'
import type { Batch } from './queue'

export type FilmQueueItem = {
  imdb_id: string
  title: string
  year: string | null
  type: string
  poster_url: string | null
  /** known when the film came from a lookup; search hits don't carry them */
  director?: string | null
  rated?: string | null
}

type State = { items: FilmQueueItem[]; batch: Batch }

const KEY = 'dora.filmqueue.v1'
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

export const filmQueue = {
  get: () => state,
  has: (imdbId: string) => state.items.some((i) => i.imdb_id === imdbId),
  /** Appends, as in the design. Returns false if already queued. */
  add(item: FilmQueueItem) {
    if (filmQueue.has(item.imdb_id)) return false
    set({ ...state, items: [...state.items, item] })
    return true
  },
  remove(imdbId: string) { set({ ...state, items: state.items.filter((i) => i.imdb_id !== imdbId) }) },
  clear() { set({ ...state, items: [] }) },
  setBatch(batch: Partial<Batch>) { set({ ...state, batch: { ...state.batch, ...batch } }) },
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useFilmQueue = () => useSyncExternalStore(subscribe, filmQueue.get)

/** The batch endpoint's entries, with the dialog-wide status and visibility. */
export function toFilmBatchEntries(s: State) {
  return s.items.map((i) => ({ imdb_id: i.imdb_id, status: s.batch.status, is_public: s.batch.visibility === 'public' }))
}
