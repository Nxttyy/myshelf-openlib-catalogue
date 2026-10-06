/* Mutations on the signed-in user's own shelf, profile and photos.
   Shelf edits update the ['shelf'] cache first (instant pins, statuses),
   then roll back if the server refuses. */

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'
import type { Me } from './me'
import type { BookEntryRead, ShelfEntry, ShelfRead, UserBookImage } from './types'

export type ShelfPatch = Partial<Pick<ShelfEntry, 'status' | 'is_public' | 'comment' | 'is_pinned'>>

// Same order as the API: pinned first, then newest.
function sortEntries(entries: ShelfEntry[]) {
  return [...entries].sort((a, b) =>
    Number(b.is_pinned) - Number(a.is_pinned) || b.created_at.localeCompare(a.created_at))
}

function recount(entries: ShelfEntry[]): ShelfRead['counts'] {
  const reading = entries.filter((e) => e.status === 'reading').length
  const read = entries.filter((e) => e.status === 'read').length
  return { all: entries.length, reading, read, unread: entries.length - reading - read }
}

/** Apply `fn` to one shelf entry, in the shelf list and in its open record. */
function updateEntry(qc: QueryClient, entryId: string, fn: (e: ShelfEntry) => ShelfEntry) {
  let bookId: string | undefined
  qc.setQueryData<ShelfRead>(['shelf'], (shelf) => {
    if (!shelf) return shelf
    const entries = shelf.entries.map((e) => (e.id === entryId ? ((bookId = e.book.id), fn(e)) : e))
    return { ...shelf, entries, counts: recount(entries) }
  })
  for (const [key, rec] of qc.getQueriesData<BookEntryRead>({ queryKey: ['book'] })) {
    if (rec?.shelf?.id === entryId) qc.setQueryData(key, { ...rec, shelf: fn(rec.shelf) })
  }
  return bookId
}

export function useUpdateShelfEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ShelfPatch }) =>
      api.patch<{ ok: boolean }>(`/books/user_books/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['shelf'] })
      const before = qc.getQueryData<ShelfRead>(['shelf'])
      updateEntry(qc, id, (e) => ({ ...e, ...patch }))
      if (patch.is_pinned !== undefined) {
        // The API allows one pin at a time: pinning a book unpins the others.
        qc.setQueryData<ShelfRead>(['shelf'], (shelf) => shelf && {
          ...shelf,
          entries: sortEntries(shelf.entries.map((e) =>
            e.id === id ? e : patch.is_pinned ? { ...e, is_pinned: false } : e)),
        })
      }
      return { before }
    },
    onError: (_err, _vars, ctx) => { if (ctx?.before) qc.setQueryData(['shelf'], ctx.before) },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['shelf'] })
      qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

export function useSetProfileVisibility() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (isPublic: boolean) => api.patch<{ ok: boolean }>('/auth/profile', { is_profile_public: isPublic }),
    onMutate: (isPublic) => {
      const before = qc.getQueryData<Me | null>(['me'])
      if (before) qc.setQueryData(['me'], { ...before, is_profile_public: isPublic })
      qc.setQueryData<ShelfRead>(['shelf'], (s) => s && { ...s, owner: { ...s.owner, is_profile_public: isPublic } })
      return { before }
    },
    onError: (_e, _v, ctx) => { if (ctx?.before) qc.setQueryData(['me'], ctx.before) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['shelf'] }),
  })
}

export function useSetUsername() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (username: string) => api.patch<{ ok: boolean; username: string }>('/auth/username', { username }),
    onSuccess: ({ username }) => {
      qc.setQueryData<Me | null>(['me'], (me) => me && { ...me, handle: username })
      qc.setQueryData<ShelfRead>(['shelf'], (s) => s && { ...s, owner: { ...s.owner, handle: username } })
      qc.invalidateQueries({ queryKey: ['recent'] }) // "Added by @…" on manual books
    },
  })
}

// ── Photos on notes ───────────────────────────────────────────────────────

export const MAX_PHOTOS = 6 // the API's storage.MAX_IMAGES_PER_BOOK

type Presigned = { image_id: string; key: string; upload_url: string; fields: Record<string, string> }

/** presign -> POST the file straight to the bucket -> confirm, per file.
    Calls onAdded as each photo lands, and returns the ones that failed. */
export async function uploadPhotos(
  qc: QueryClient, entryId: string, files: File[], onAdded?: (img: UserBookImage) => void,
): Promise<{ added: number; failed: string[]; error?: string }> {
  let presigned: Presigned[]
  try {
    presigned = await api.post<Presigned[]>(`/books/user_books/${entryId}/images/presign`, {
      files: files.map((f) => ({ content_type: f.type, byte_size: f.size })),
    })
  } catch (err) {
    return { added: 0, failed: files.map((f) => f.name), error: err instanceof ApiError ? err.message : "Couldn't start the upload." }
  }

  let added = 0
  const failed: string[] = []
  for (const [i, p] of presigned.entries()) {
    const file = files[i]
    try {
      const form = new FormData()
      Object.entries(p.fields).forEach(([k, v]) => form.append(k, v))
      form.append('file', file)
      const up = await fetch(p.upload_url, { method: 'POST', body: form })
      if (!up.ok) throw new Error(`bucket said ${up.status}`)
      const img = await api.post<UserBookImage>(`/books/user_books/${entryId}/images/${p.image_id}/confirm`)
      updateEntry(qc, entryId, (e) => ({ ...e, images: [...e.images, img] }))
      onAdded?.(img)
      added++
    } catch {
      failed.push(file.name)
    }
  }
  qc.invalidateQueries({ queryKey: ['profile'] })
  return { added, failed }
}

export function useDeletePhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ entryId, imageId }: { entryId: string; imageId: string }) =>
      api.delete<{ ok: boolean }>(`/books/user_books/${entryId}/images/${imageId}`),
    onSuccess: (_r, { entryId, imageId }) => {
      updateEntry(qc, entryId, (e) => ({ ...e, images: e.images.filter((i) => i.id !== imageId) }))
      qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}
