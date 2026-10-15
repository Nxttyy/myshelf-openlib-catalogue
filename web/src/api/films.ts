/* Films: reads, shelf edits and the add dialog's calls. Same shapes as
   the book hooks (queries.ts, shelf.ts, add.ts), under one key prefix:
   ['films', 'recent' | 'shelf' | 'entry' | 'profile', ...]. */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { filmQueue, toFilmBatchEntries } from '../lib/filmQueue'
import { api } from './client'
import type {
  BatchUserFilmResult, FilmCatalogEntry, FilmEntryRead, FilmRecentPage, FilmSearchPage, FilmShelfEntry,
  FilmShelfRead, PublicFilmShelfRead,
} from './types'

const SHELF = ['films', 'shelf']

// ── Reads ────────────────────────────────────────────────────────────────

/** Newest films on public shelves across Dora, 50 per page. */
export function useRecentFilms() {
  return useInfiniteQuery({
    queryKey: ['films', 'recent'],
    queryFn: ({ pageParam }) => api.get<FilmRecentPage>(`/films/recent?offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  })
}

/** The signed-in user's films. Pass enabled=false for guests. */
export function useMyFilms(enabled = true) {
  return useQuery({ queryKey: SHELF, queryFn: () => api.get<FilmShelfRead>('/films/user_films'), enabled })
}

/** Someone's public films. Errors with status 404 when private or missing. */
export function usePublicFilms(handle: string, enabled = true) {
  return useQuery({
    queryKey: ['films', 'profile', handle],
    queryFn: () => api.get<PublicFilmShelfRead>(`/profiles/${encodeURIComponent(handle)}/films`),
    enabled: enabled && !!handle,
  })
}

/** A film some list already holds, so its record shows at once. */
function cachedEntry(qc: QueryClient, filmId: string): FilmEntryRead | undefined {
  const mine = qc.getQueryData<FilmShelfRead>(SHELF)?.entries.find((e) => e.film.id === filmId)
  if (mine) return { film: mine.film, on_shelf: true, shelf: mine }
  for (const [, data] of qc.getQueriesData<InfiniteData<FilmRecentPage>>({ queryKey: ['films', 'recent'] })) {
    const hit = data?.pages.flatMap((p) => p.entries).find((e) => e.film.id === filmId)
    if (hit) return { ...hit, shelf: null }
  }
  for (const [, data] of qc.getQueriesData<PublicFilmShelfRead>({ queryKey: ['films', 'profile'] })) {
    const hit = data?.entries.find((e) => e.film.id === filmId)
    if (hit) return { film: hit.film, on_shelf: data!.viewer_film_ids.includes(filmId), shelf: null }
  }
  return undefined
}

/** One film with the viewer's context (works for a pasted ?film= link too). */
export function useFilmEntry(filmId: string | null) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['films', 'entry', filmId],
    queryFn: () => api.get<FilmEntryRead>(`/films/${filmId}/entry`),
    enabled: !!filmId,
    placeholderData: () => (filmId ? cachedEntry(qc, filmId) : undefined),
  })
}

// ── Shelf edits ──────────────────────────────────────────────────────────

export type FilmPatch = Partial<Pick<FilmShelfEntry, 'status' | 'is_public' | 'comment' | 'is_pinned'>>

function sortEntries(entries: FilmShelfEntry[]) {
  return [...entries].sort((a, b) =>
    Number(b.is_pinned) - Number(a.is_pinned) || b.created_at.localeCompare(a.created_at))
}

function recount(entries: FilmShelfEntry[]): FilmShelfRead['counts'] {
  const reading = entries.filter((e) => e.status === 'reading').length
  const watched = entries.filter((e) => e.status === 'read')
  return {
    all: entries.length, reading, read: watched.length, unread: entries.length - reading - watched.length,
    minutes_watched: watched.reduce((s, e) => s + (e.film.runtime_min ?? 0), 0),
  }
}

/** Apply `fn` to one film entry, in the shelf list and in its open record. */
export function updateFilmEntry(qc: QueryClient, entryId: string, fn: (e: FilmShelfEntry) => FilmShelfEntry) {
  qc.setQueryData<FilmShelfRead>(SHELF, (shelf) => {
    if (!shelf) return shelf
    const entries = shelf.entries.map((e) => (e.id === entryId ? fn(e) : e))
    return { ...shelf, entries, counts: recount(entries) }
  })
  for (const [key, rec] of qc.getQueriesData<FilmEntryRead>({ queryKey: ['films', 'entry'] })) {
    if (rec?.shelf?.id === entryId) qc.setQueryData(key, { ...rec, shelf: fn(rec.shelf) })
  }
}

export function useUpdateFilmEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: FilmPatch }) =>
      api.patch<{ ok: boolean }>(`/films/user_films/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: SHELF })
      const before = qc.getQueryData<FilmShelfRead>(SHELF)
      updateFilmEntry(qc, id, (e) => ({ ...e, ...patch }))
      if (patch.is_pinned !== undefined) {
        // One pinned film at a time, like books.
        qc.setQueryData<FilmShelfRead>(SHELF, (shelf) => shelf && {
          ...shelf,
          entries: sortEntries(shelf.entries.map((e) =>
            e.id === id ? e : patch.is_pinned ? { ...e, is_pinned: false } : e)),
        })
      }
      return { before }
    },
    onError: (_err, _vars, ctx) => { if (ctx?.before) qc.setQueryData(SHELF, ctx.before) },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: SHELF })
      qc.invalidateQueries({ queryKey: ['films', 'profile'] })
      qc.invalidateQueries({ queryKey: ['films', 'recent'] })
    },
  })
}

function invalidateAfterAdd(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['films'] })
  qc.invalidateQueries({ queryKey: ['me'] }) // library counts on the tabs
}

/** Add a catalogue film (from Explore or a profile) to your shelf. */
export function useAddFilmToShelf() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (filmId: string) => api.post<{ ok: boolean; already: boolean }>(`/films/user_films/add/${filmId}`),
    onSuccess: () => invalidateAfterAdd(qc),
  })
}

// ── Add dialog ───────────────────────────────────────────────────────────

export const searchFilms = (q: string, page = 1) =>
  api.get<FilmSearchPage>(`/films/search?q=${encodeURIComponent(q)}&page=${page}`)

export const lookupFilm = (imdbId: string) =>
  api.get<FilmCatalogEntry>(`/films/lookup/${encodeURIComponent(imdbId)}`)

/** Save the whole film queue in one request. The caller clears the queue
    once it knows something was saved. */
export function useSaveFilmQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<BatchUserFilmResult>('/films/user_films/batch', { entries: toFilmBatchEntries(filmQueue.get()) }),
    onSuccess: () => invalidateAfterAdd(qc),
  })
}
