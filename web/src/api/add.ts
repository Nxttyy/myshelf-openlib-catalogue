/* API calls behind the add dialog. */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Book, ManualBookCreate } from './types'
import { queue, toBatchEntries, type SearchHit } from '../lib/queue'

export type LocalHit = {
  book_id: string; title: string; authors: string[]; cover_url: string | null
  publish_date: string | null; isbn: string | null; source: string; added_by: string | null
}

export const lookupIsbn = (isbn: string) => api.get<Book>(`/books/lookup/${encodeURIComponent(isbn)}`)

export const searchOpenLibrary = (q: string) =>
  api.get<(SearchHit & { isbn: string | null })[]>(`/books/search?q=${encodeURIComponent(q)}`)

export const searchCatalogue = (q: string, limit = 12) =>
  api.get<LocalHit[]>(`/books/search/local?q=${encodeURIComponent(q)}&limit=${limit}`)

export type BatchResult = { added: number; errors: string[] }

/** Save the whole queue in one request. The queue is cleared by the caller
    only once it knows something was saved. */
export function useSaveQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<BatchResult>('/books/user_books/batch', { entries: toBatchEntries(queue.get()) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shelf'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['book'] })
      qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

/** Correct the details of a book you typed in yourself. */
export function useEditManualBook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ManualBookCreate }) => api.patch<Book>(`/books/${id}`, data),
    onSuccess: (_b, { id }) => {
      qc.invalidateQueries({ queryKey: ['book', id] })
      qc.invalidateQueries({ queryKey: ['shelf'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

/** Upload a hand-typed book's cover straight to the bucket; returns its key. */
export async function uploadCover(file: File): Promise<string> {
  const p = await api.post<{ key: string; upload_url: string; fields: Record<string, string> }>(
    '/books/covers/presign', { content_type: file.type, byte_size: file.size })
  const form = new FormData()
  Object.entries(p.fields).forEach(([k, v]) => form.append(k, v))
  form.append('file', file)
  const up = await fetch(p.upload_url, { method: 'POST', body: form })
  if (!up.ok) throw new Error('Cover upload failed')
  return p.key
}

// ── Phone hand-off (desktop QR) ───────────────────────────────────────────

export const startScanSession = () => api.post<{ token: string; scan_url: string }>('/scan/session')
export const scanSessionItems = (token: string, after: number) =>
  api.get<{ isbns: string[]; total: number }>(`/scan/session/${token}/items?after=${after}`)

// ── Ask Dora ──────────────────────────────────────────────────────────────

export type Verdict = {
  kind: 'buy' | 'hold' | 'skip'; verdict: string
  familiarity_to_taste: number; adventure_in_the_right_direction: number; reason?: string | null
}
export type AskCandidate = { title: string; authors: string[]; isbn: string | null; context: string | null }

/** Fire a taste run and poll until Dora answers (usually 10-30s). */
export async function askDora(c: AskCandidate, signal: AbortSignal): Promise<Verdict> {
  const { run_id } = await api.post<{ run_id: string }>('/dora/ask', c)
  for (let n = 0; n < 40; n++) {
    await new Promise((r) => setTimeout(r, 3000))
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const res = await api.get<{ status: string; verdict?: Verdict }>(`/dora/ask/${run_id}`)
    if (res.status === 'completed' && res.verdict) return res.verdict
    if (res.status === 'failed') throw new Error('failed')
  }
  throw new Error('timeout')
}
