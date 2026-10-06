import { useCallback } from 'react'
import { lookupIsbn, type LocalHit } from '../../api/add'
import { ApiError } from '../../api/client'
import type { ManualBookCreate } from '../../api/types'
import { queue, type SearchHit } from '../../lib/queue'
import { useToast } from '../../lib/toast'

const join = (parts: (string | number | null | undefined)[]) => parts.filter(Boolean).join(' · ')
let manualSeq = 0

/** Everything that puts a book into the queue. Each returns false if that
    book was already queued. */
export function useQueueActions() {
  const toast = useToast()

  const addIsbn = useCallback((isbn: string, { quiet = false } = {}) => {
    const added = queue.add({
      key: isbn, title: isbn, sub: isbn, coverUrl: null, state: 'looking',
      source: { isbn }, ask: { title: '', authors: [], isbn, context: null },
    })
    if (!added) return false
    navigator.vibrate?.(30) // a little tap when a scan lands
    // Look the title up in the background; the queue already holds the ISBN.
    lookupIsbn(isbn).then((b) => {
      const cover = b.covers?.[0]
      const authors = b.authors?.map((a) => a.name) ?? []
      queue.update(isbn, {
        state: 'ready', title: b.title, sub: join([authors.join(', '), isbn]),
        coverUrl: cover?.small || cover?.medium || null,
        ask: { title: b.title, authors, isbn, context: null },
      })
      if (!quiet) toast('Added · ' + b.title)
    }).catch((err) => {
      queue.update(isbn, { state: err instanceof ApiError && err.status === 429 ? 'limited' : 'notfound' })
    })
    return true
  }, [toast])

  const addSearchHit = useCallback((b: SearchHit) => {
    const ok = queue.add({
      key: b.key, title: b.title || 'Untitled', sub: join([b.authors.join(', '), b.first_publish_year]) || b.isbns[0] || '·',
      coverUrl: b.cover_url, state: 'ready', source: { book: b },
      ask: { title: b.title, authors: b.authors, isbn: b.isbns[0] ?? null, context: b.first_publish_year ? `First published ${b.first_publish_year}` : null },
    })
    if (ok) toast('Added · ' + (b.title || 'book'))
    return ok
  }, [toast])

  const addCatalogue = useCallback((b: LocalHit) => {
    const ok = queue.add({
      key: b.book_id, title: b.title || 'Untitled', sub: join([b.authors.join(', '), b.publish_date]) || b.isbn || '·',
      coverUrl: b.cover_url, state: 'ready', source: { book_id: b.book_id },
      ask: { title: b.title, authors: b.authors, isbn: b.isbn, context: null },
    })
    if (ok) toast('Added · ' + (b.title || 'book'))
    return ok
  }, [toast])

  const addManual = useCallback((draft: ManualBookCreate, preview: string | null) => {
    queue.add({
      key: 'manual:' + Date.now() + ':' + ++manualSeq, title: draft.title,
      sub: draft.authors?.join(', ') || 'Added by hand', coverUrl: preview, state: 'ready',
      source: { manual: { ...draft, cover_preview: preview } },
      ask: { title: draft.title, authors: draft.authors ?? [], isbn: draft.isbns?.[0] ?? null, context: null },
    })
    toast('Added · ' + draft.title)
  }, [toast])

  return { addIsbn, addSearchHit, addCatalogue, addManual }
}
