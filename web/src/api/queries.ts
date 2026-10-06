/* TanStack Query hooks for every page read and auth action.
   Keys: ['me'], ['shelf'], ['recent'], ['book', id], ['profile', handle]. */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Me } from './me'
import type {
  BookEntryRead, LoginRequest, PublicShelfRead, RecentPage, ShelfRead, SignupRequest,
} from './types'

// ── Reads ────────────────────────────────────────────────────────────────

/** Newest books across Dora, 50 per page. */
export function useRecentBooks() {
  return useInfiniteQuery({
    queryKey: ['recent'],
    queryFn: ({ pageParam }) => api.get<RecentPage>(`/books/recent?offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  })
}

/** The signed-in user's whole shelf, hauls included. Pass enabled=false for guests. */
export function useMyShelf(enabled = true) {
  return useQuery({
    queryKey: ['shelf'],
    queryFn: () => api.get<ShelfRead>('/books/user_books'),
    enabled,
  })
}

/** A book already loaded by some list, so its record can render instantly
    while the full entry (with the viewer's shelf data) loads. */
function cachedEntry(qc: QueryClient, bookId: string): BookEntryRead | undefined {
  const shelf = qc.getQueryData<ShelfRead>(['shelf'])
  const mine = shelf?.entries.find((e) => e.book.id === bookId)
  if (mine) return { book: mine.book, added_by: mine.added_by, can_edit: mine.can_edit, on_shelf: true, shelf: mine }
  for (const [, data] of qc.getQueriesData<InfiniteData<RecentPage>>({ queryKey: ['recent'] })) {
    const hit = data?.pages.flatMap((p) => p.entries).find((e) => e.book.id === bookId)
    if (hit) return { ...hit, shelf: null }
  }
  for (const [, data] of qc.getQueriesData<PublicShelfRead>({ queryKey: ['profile'] })) {
    const hit = data?.entries.find((e) => e.book.id === bookId)
    if (hit) return { book: hit.book, added_by: hit.added_by, can_edit: hit.can_edit, on_shelf: false, shelf: null }
  }
  return undefined
}

/** One book with the viewer's context (works for a pasted ?book= link too). */
export function useBookEntry(bookId: string | null) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['book', bookId],
    queryFn: () => api.get<BookEntryRead>(`/books/${bookId}/entry`),
    enabled: !!bookId,
    placeholderData: () => (bookId ? cachedEntry(qc, bookId) : undefined),
  })
}

/** Someone's public shelf. Errors with status 404 when private or missing. */
export function usePublicProfile(handle: string, enabled = true) {
  return useQuery({
    queryKey: ['profile', handle],
    queryFn: () => api.get<PublicShelfRead>(`/profiles/${encodeURIComponent(handle)}`),
    enabled: enabled && !!handle,
  })
}

// ── Shelf actions ────────────────────────────────────────────────────────

/** Add a catalogue book to the signed-in user's shelf. */
export function useAddToShelf() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (bookId: string) => api.post<{ ok: boolean; already: boolean }>(`/books/user_books/add/${bookId}`),
    onSuccess: (_res, bookId) => {
      qc.invalidateQueries({ queryKey: ['shelf'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['book', bookId] })
      qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

// ── Auth ─────────────────────────────────────────────────────────────────

// Everything except the catalogue itself depends on who is looking
// (on_shelf flags, can_edit, the shelf), so a change of user refetches it.
function onUserChanged(qc: QueryClient, me: Me | null) {
  qc.setQueryData(['me'], me)
  qc.removeQueries({ queryKey: ['shelf'] })
  qc.invalidateQueries({ queryKey: ['recent'] })
  qc.invalidateQueries({ queryKey: ['book'] })
  qc.invalidateQueries({ queryKey: ['profile'] })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LoginRequest) => api.post<Me>('/auth/session', body),
    onSuccess: (me) => onUserChanged(qc, me),
  })
}

export function useSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SignupRequest) => api.post<Me>('/auth/account', body),
    onSuccess: (me) => onUserChanged(qc, me),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete<void>('/auth/session'),
    onSuccess: () => onUserChanged(qc, null),
  })
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => api.post<void>('/auth/password-reset-requests', { email }),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (body: { token: string; new_password: string }) => api.post<void>('/auth/password-resets', body),
  })
}
