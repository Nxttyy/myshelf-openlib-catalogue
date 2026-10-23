/* Films: reads, shelf edits and the add dialog's calls. Same shapes as
   the book hooks (queries.ts, shelf.ts, add.ts), under one key prefix:
   ['films', 'recent' | 'shelf' | 'entry' | 'profile', ...]. */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { filmQueue, toFilmBatchEntries } from '../lib/filmQueue'
import { api } from './client'
import type {
  BatchUserFilmResult, EntryLogWrite, FilmCatalogEntry, FilmEntryRead, FilmListJob, FilmRecentPage, FilmSearchPage, FilmShelfEntry,
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

export type FilmPatch = Partial<Pick<FilmShelfEntry, 'status' | 'is_public' | 'comment' | 'is_pinned'>> & { log?: EntryLogWrite }

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
      // The log is sent in its write shape; the saved one comes back on refetch.
      const { log: _log, ...fields } = patch
      updateFilmEntry(qc, id, (e) => ({ ...e, ...fields }))
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
    onSettled: (_r, _e, { patch }) => {
      qc.invalidateQueries({ queryKey: SHELF })
      qc.invalidateQueries({ queryKey: ['films', 'profile'] })
      qc.invalidateQueries({ queryKey: ['films', 'recent'] })
      if (patch.log) qc.invalidateQueries({ queryKey: ['films', 'entry'] })
    },
  })
}

/** Remove a film from your library, with its note, photos and log. */
export function useRemoveFilmEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/films/user_films/${id}`),
    onSuccess: () => invalidateAfterAdd(qc),
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

// The API takes at most this many films per request (BatchUserFilmRequest).
const SAVE_BATCH = 50

/** Save the whole film queue, SAVE_BATCH films per request (a pasted list
    can queue hundreds), reporting progress as each batch lands. Films
    already on the shelf are skipped server-side, so if a batch fails,
    saving again picks up where it stopped. The caller clears the queue
    once it knows something was saved. */
export function useSaveFilmQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (onProgress?: (saved: number, total: number) => void): Promise<BatchUserFilmResult> => {
      const entries = toFilmBatchEntries(filmQueue.get())
      const out: BatchUserFilmResult = { added: 0, errors: [] }
      for (let at = 0; at < entries.length; at += SAVE_BATCH) {
        const res = await api.post<BatchUserFilmResult>('/films/user_films/batch', { entries: entries.slice(at, at + SAVE_BATCH) })
        out.added += res.added
        out.errors.push(...res.errors)
        onProgress?.(Math.min(at + SAVE_BATCH, entries.length), entries.length)
      }
      return out
    },
    onSettled: () => invalidateAfterAdd(qc), // a failed later batch still saved the earlier ones
  })
}

// ── Pasted lists ─────────────────────────────────────────────────────────

/** Find every film in a pasted list. The server reads and matches it in the
    background; this polls until it's done, reporting progress. */
export async function findFilmList(text: string, signal: AbortSignal, onProgress: (job: FilmListJob) => void): Promise<FilmListJob> {
  const { job_id } = await api.post<{ job_id: string }>('/films/list-search', { text })
  for (let n = 0; n < 150; n++) {
    await new Promise((r) => setTimeout(r, 1500))
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const job = await api.get<FilmListJob>(`/films/list-search/${job_id}`)
    if (job.status === 'done' || job.status === 'failed') return job
    onProgress(job)
  }
  throw new Error('timeout')
}

// ── Ask Dora ─────────────────────────────────────────────────────────────

export type FilmVerdict = {
  kind: 'watch' | 'skip' | 'unsure' | 'none'; verdict: string; summary?: string | null
  predicted_enjoyment?: number | null; confidence?: 'low' | 'medium' | 'high' | null
  familiarity_to_taste: number; adventure_in_the_right_direction: number
}

export const askDoraFilms = (imdbIds: string[]) =>
  api.post<{ runs: { run_id: string; imdb_ids: string[] }[]; verdicts: Record<string, FilmVerdict>; failed: string[] }>('/dora/films/ask', { imdb_ids: imdbIds })

export const pollDoraFilms = (runId: string) =>
  api.get<{ status: string; verdicts: Record<string, FilmVerdict>; imdb_ids: string[] }>(`/dora/films/ask/${runId}`)
