/* TanStack Query hooks for every page read and auth action.
   Keys: ['me'], ['shelf'], ['recent'], ['book', id], ['profile', handle]. */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
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

/** One book with the viewer's context, for a ?book= link opened directly. */
export function useBookEntry(bookId: string | null) {
  return useQuery({
    queryKey: ['book', bookId],
    queryFn: () => api.get<BookEntryRead>(`/books/${bookId}/entry`),
    enabled: !!bookId,
  })
}

/** Someone's public shelf. Errors with status 404 when private or missing. */
export function usePublicProfile(handle: string) {
  return useQuery({
    queryKey: ['profile', handle],
    queryFn: () => api.get<PublicShelfRead>(`/profiles/${encodeURIComponent(handle)}`),
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
