/* The ISBN, Search and By hand tabs of the add dialog. */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { searchCatalogue, searchOpenLibrary, uploadCover, useEditManualBook, type LocalHit } from '../../api/add'
import { useBookEntry } from '../../api/queries'
import type { ManualBookCreate } from '../../api/types'
import { extractISBN } from '../../lib/isbn'
import { useQueue, type SearchHit } from '../../lib/queue'
import { useToast } from '../../lib/toast'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { Icon } from '../Icon'
import { CameraSheet } from '../PhotoNotes'
import { useQueueActions } from './actions'
import { SearchResultRow } from './shared'

const join = (parts: (string | number | null | undefined)[]) => parts.filter(Boolean).join(' · ')

// ── ISBN ──────────────────────────────────────────────────────────────────

export function IsbnTab() {
  const [value, setValue] = useState('')
  const { addIsbn } = useQueueActions()
  const toast = useToast()
  function add(e: FormEvent) {
    e.preventDefault()
    const isbn = extractISBN(value)
    if (!isbn) { toast("That ISBN doesn't look right. It's 10 or 13 digits.", 'err'); return }
    if (!addIsbn(isbn)) toast('Already in the queue', 'err')
    setValue('')
  }
  return (
    <form onSubmit={add} style={{ paddingTop: 4 }}>
      <div className="f-field">
        <label className="f-label" htmlFor="isbn-input" style={{ display: 'block', marginBottom: 8 }}>ISBN-10 or ISBN-13</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="isbn-input" className="f-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="978…"
            inputMode="numeric" autoComplete="off" enterKeyHint="go" style={{ flex: 1 }} autoFocus />
          <button type="submit" className="f-btn f-btn--ink" style={{ padding: '0 20px' }}>Add</button>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
        Enter the 10 or 13-digit ISBN from the back of the book. Dora looks it up on Open Library.
      </div>
    </form>
  )
}

// ── Search ────────────────────────────────────────────────────────────────

type Found = { local: LocalHit[]; remote: SearchHit[] } | 'error'

export function SearchTab({ onByHand, desktop }: { onByHand: (title: string) => void; desktop: boolean }) {
  const [q, setQ] = useState('')
  // Each answer remembers which query it was for; anything else is stale.
  const [answer, setAnswer] = useState<{ q: string; found: Found } | null>(null)
  const { items } = useQueue()
  const { addSearchHit, addCatalogue } = useQueueActions()
  const queued = new Set(items.map((i) => i.key))
  const query = q.trim()

  useEffect(() => {
    if (query.length < 2) return
    let alive = true
    const t = setTimeout(async () => {
      // Hand-typed books exist only in our catalogue, so search both. One side
      // failing shouldn't blank the other.
      const [local, remote] = await Promise.all([
        searchCatalogue(query).catch(() => null),
        searchOpenLibrary(query).catch(() => null),
      ])
      if (alive) setAnswer({ q: query, found: local === null && remote === null ? 'error' : { local: local ?? [], remote: remote ?? [] } })
    }, 500)
    return () => { alive = false; clearTimeout(t) }
  }, [query])

  const results = answer?.q === query ? answer.found : null
  const busy = query.length >= 2 && !results
  const empty = results && results !== 'error' && !results.local.length && !results.remote.length
  return (
    <div style={{ paddingTop: 4 }}>
      <label className="f-label" htmlFor="search-input" style={{ display: 'block', marginBottom: 8 }}>Search by title or author</label>
      <input id="search-input" className="f-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. the hobbit tolkien"
        type="search" enterKeyHint="search" autoComplete="off" autoFocus />
      <div className="d-results" style={desktop ? undefined : { maxHeight: 'none' }}>
        {query.length < 2 && <div className="empty">Type a title or an author.</div>}
        {busy && <div className="empty">Searching…</div>}
        {!busy && results === 'error' && <div className="empty">Couldn't reach the catalogue. Check your connection.</div>}
        {!busy && empty && (
          <div className="empty">
            Nothing on Open Library for that. Check the spelling, or{' '}
            <button className="m-inline-link" onClick={() => onByHand(query)}>add it by hand</button>.
          </div>
        )}
        {!busy && results && results !== 'error' && (
          <>
            {results.local.length > 0 && <div className="m-results-head">Already on Dora</div>}
            {results.local.map((b) => (
              <SearchResultRow key={b.book_id} id={b.book_id} title={b.title} coverUrl={b.cover_url} author={b.authors[0]}
                meta={join([b.authors.join(', '), b.publish_date])}
                tag={b.source === 'manual' ? (b.added_by ? `Added by @${b.added_by}` : 'Community entry') : null}
                candidate={{ title: b.title, authors: b.authors, isbn: b.isbn, context: null }}
                added={queued.has(b.book_id)} onAdd={() => addCatalogue(b)} />
            ))}
            {results.local.length > 0 && results.remote.length > 0 && <div className="m-results-head">From Open Library</div>}
            {results.remote.map((b) => (
              <SearchResultRow key={b.key} id={b.key} title={b.title} coverUrl={b.cover_url} author={b.authors[0]}
                meta={join([b.authors.join(', '), b.first_publish_year])}
                candidate={{ title: b.title, authors: b.authors, isbn: b.isbns[0] ?? null, context: b.first_publish_year ? `First published ${b.first_publish_year}` : null }}
                added={queued.has(b.key)} onAdd={() => addSearchHit(b)} />
            ))}
            {(results.local.length > 0 || results.remote.length > 0) && (
              <div className="m-results-foot">Not here? <button className="m-inline-link" onClick={() => onByHand(query)}>Add it by hand</button></div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── By hand ───────────────────────────────────────────────────────────────

const split = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean)
const EMPTY = { title: '', authors: '', subtitle: '', publishers: '', year: '', pages: '', isbns: '', subjects: '', description: '' }
type Fields = typeof EMPTY

/** For books with no copy to scan and no Open Library record. With `editId`,
    corrects the details of a book you typed in earlier instead. */
export function ManualTab({ editId, initialTitle = '', onEdited }: { editId?: string; initialTitle?: string; onEdited?: () => void }) {
  const { data: editing, isError } = useBookEntry(editId ?? null)
  if (!editId) return <ManualForm initial={{ ...EMPTY, title: initialTitle }} />
  if (isError) return <div className="f-label" style={{ padding: '30px 0', textAlign: 'center' }}>Couldn't load this book.</div>
  if (!editing) return <div className="f-label" style={{ padding: '30px 0', textAlign: 'center' }}>Loading…</div>
  const b = editing.book
  const c = b.covers?.[0]
  return (
    <ManualForm editId={editId} onEdited={onEdited} initialCover={c?.medium || c?.small || null}
      initial={{
        title: b.title ?? '', authors: (b.authors ?? []).map((a) => a.name).join(', '), subtitle: b.subtitle ?? '',
        publishers: (b.publishers ?? []).map((p) => p.name).join(', '), year: b.publish_date ?? '',
        pages: b.number_of_pages ? String(b.number_of_pages) : '', isbns: (b.isbns ?? []).join(', '),
        subjects: (b.subjects ?? []).map((x) => x.name).join(', '), description: b.description ?? '',
      }} />
  )
}

function ManualForm({ initial, initialCover = null, editId, onEdited }: {
  initial: Fields; initialCover?: string | null; editId?: string; onEdited?: () => void
}) {
  const [f, setF] = useState<Fields>(initial)
  const [more, setMore] = useState(() => Object.entries(initial).some(([k, v]) => k !== 'title' && k !== 'authors' && v))
  const [cover, setCover] = useState<{ key: string | null; preview: string | null; busy: boolean }>({ key: null, preview: initialCover, busy: false })
  const [camera, setCamera] = useState(false)
  const [dupes, setDupes] = useState<{ q: string; hits: LocalHit[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const captureRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const touch = useMediaQuery('(pointer: coarse)')
  const toast = useToast()
  const { addManual, addCatalogue } = useQueueActions()
  const edit = useEditManualBook()
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  // While typing a new title, offer books already on Dora instead.
  const titleQ = f.title.trim()
  useEffect(() => {
    if (editId || titleQ.length < 3) return
    let alive = true
    const t = setTimeout(() => { searchCatalogue(titleQ, 3).then((hits) => alive && setDupes({ q: titleQ, hits })).catch(() => {}) }, 600)
    return () => { alive = false; clearTimeout(t) }
  }, [titleQ, editId])
  const dupeHits = !editId && dupes?.q === titleQ ? dupes.hits : []

  async function pickCover(file: File | undefined) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { toast('That image is too large. The limit is 10MB.', 'err'); return }
    const preview = URL.createObjectURL(file)
    setCover({ key: null, preview, busy: true })
    try {
      setCover({ key: await uploadCover(file), preview, busy: false })
    } catch {
      setCover({ key: null, preview: null, busy: false })
      toast("Couldn't upload the cover. Try again.", 'err')
    }
  }

  function draft(): ManualBookCreate | null {
    const title = f.title.trim()
    if (!title) { toast('A title is required.', 'err'); titleRef.current?.focus(); return null }
    const pages = parseInt(f.pages, 10)
    return {
      title, authors: split(f.authors), subtitle: f.subtitle.trim() || null, publishers: split(f.publishers),
      publish_date: f.year.trim() || null, number_of_pages: Number.isFinite(pages) ? pages : null,
      isbns: split(f.isbns), subjects: split(f.subjects), description: f.description.trim() || null,
      cover_key: cover.key,
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (cover.busy) { toast('Hold on, the cover is still uploading.', 'err'); return }
    const d = draft()
    if (!d) return
    if (editId) {
      edit.mutate({ id: editId, data: d }, {
        onSuccess: () => { toast('Book details updated.'); onEdited?.() },
        onError: (err) => toast(err.message, 'err'),
      })
      return
    }
    addManual(d, cover.preview)
    setF(EMPTY); setMore(false); setCover({ key: null, preview: null, busy: false }); setDupes(null)
    titleRef.current?.focus()
  }

  return (
    <form onSubmit={submit} style={{ paddingTop: 4 }}>
      <div className="m-create-top">
        <div className="m-cover-pick">
          <button type="button" className={'m-cover-face' + (cover.preview ? ' has' : '')} onClick={() => fileRef.current?.click()} aria-label="Choose a cover image">
            {cover.preview
              ? <img src={cover.preview} alt="" />
              : <><Icon name="image" size={16} sw={1.7} /><span>Cover<br />photo</span></>}
            {cover.busy && <span className="m-cover-busy">Uploading…</span>}
          </button>
          <button type="button" className="m-cover-cam" onClick={() => (touch ? captureRef.current?.click() : setCamera(true))}>
            <Icon name="camera" size={12} sw={1.8} /> Photo
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = '' }} />
          <input ref={captureRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="f-field">
            <label className="f-label" htmlFor="create-title">Title</label>
            <input ref={titleRef} id="create-title" className="f-input" placeholder="Required" value={f.title} onChange={set('title')} autoComplete="off" autoFocus={!editId} />
          </div>
          <div className="f-field" style={{ marginBottom: 0 }}>
            <label className="f-label" htmlFor="create-authors">Author(s)</label>
            <input id="create-authors" className="f-input" placeholder="Separate with commas" value={f.authors} onChange={set('authors')} autoComplete="off" />
          </div>
        </div>
      </div>

      {dupeHits.length > 0 && (
        <div className="d-results" style={{ maxHeight: 'none', marginTop: 14 }}>
          <div className="m-results-head">Already on Dora. Add one of these instead?</div>
          {dupeHits.map((b) => (
            <SearchResultRow key={b.book_id} id={b.book_id} title={b.title} coverUrl={b.cover_url} author={b.authors[0]}
              meta={join([b.authors.join(', '), b.publish_date])}
              tag={b.source === 'manual' ? (b.added_by ? `Added by @${b.added_by}` : 'Community entry') : null}
              candidate={{ title: b.title, authors: b.authors, isbn: b.isbn, context: null }} added={false}
              onAdd={() => { addCatalogue(b); setF(EMPTY); setDupes(null) }} />
          ))}
        </div>
      )}

      <details className="m-create-more" open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
        <summary>More details, all optional</summary>
        <div className="f-field"><label className="f-label" htmlFor="create-subtitle">Subtitle</label>
          <input id="create-subtitle" className="f-input" value={f.subtitle} onChange={set('subtitle')} autoComplete="off" /></div>
        <div className="m-create-grid">
          <div className="f-field"><label className="f-label" htmlFor="create-publisher">Publisher</label>
            <input id="create-publisher" className="f-input" value={f.publishers} onChange={set('publishers')} autoComplete="off" /></div>
          <div className="f-field"><label className="f-label" htmlFor="create-year">Published</label>
            <input id="create-year" className="f-input" placeholder="e.g. 1979" value={f.year} onChange={set('year')} autoComplete="off" /></div>
        </div>
        <div className="m-create-grid">
          <div className="f-field"><label className="f-label" htmlFor="create-pages">Pages</label>
            <input id="create-pages" className="f-input" inputMode="numeric" value={f.pages} onChange={set('pages')} autoComplete="off" /></div>
          <div className="f-field"><label className="f-label" htmlFor="create-isbn">ISBN</label>
            <input id="create-isbn" className="f-input" placeholder="If it has one" inputMode="numeric" value={f.isbns} onChange={set('isbns')} autoComplete="off" /></div>
        </div>
        <div className="f-field"><label className="f-label" htmlFor="create-subjects">Subjects</label>
          <input id="create-subjects" className="f-input" placeholder="poetry, translation…" value={f.subjects} onChange={set('subjects')} autoComplete="off" /></div>
        <div className="f-field"><label className="f-label" htmlFor="create-description">Description</label>
          <textarea id="create-description" className="f-textarea" rows={3} placeholder="What is this book?" value={f.description} onChange={set('description')} /></div>
      </details>

      <button type="submit" className="f-btn f-btn--ink f-btn--block" style={{ marginTop: 14 }} disabled={edit.isPending}>
        {editId ? (edit.isPending ? 'Saving…' : 'Save changes') : 'Add to queue'}
      </button>
      {editId && <button type="button" className="f-btn f-btn--ghost f-btn--block" style={{ marginTop: 8 }} onClick={onEdited}>Cancel</button>}
      <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.5, marginTop: 10 }}>
        {editId
          ? 'Corrections apply everywhere this book appears, including other readers’ shelves.'
          : 'Saved to the shared catalogue, so anyone searching for it later will find your entry. You can edit it afterwards.'}
      </p>
      {camera && createPortal(
        <CameraSheet title="Camera · the front cover" caption="Fill the frame with the cover" once
          onCapture={(file) => pickCover(file)} onClose={() => setCamera(false)} />, document.body)}
    </form>
  )
}
