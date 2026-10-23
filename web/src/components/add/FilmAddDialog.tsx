/* "Add to library · Films" (folio/films.jsx FilmAddDialog, films-mobile.jsx
   MFilmAdd). Search one title, paste a whole list (the server reads it and
   finds one film per line), or paste IMDb IDs or links. Ask Dora whether a
   film fits before adding it. Picks wait in the film queue until saved.
   Desktop: two columns, queue on the right, and an IMDb ID tab. Phone: a
   full-height sheet with save pinned at the bottom; the search box takes
   IDs too, so it has no tabs. Addressed by ?addfilm=search|ids, so Back
   closes it. */

import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../../api/client'
import { findFilmList, lookupFilm, searchFilms, useSaveFilmQueue } from '../../api/films'
import { useMe } from '../../api/me'
import type { Film, FilmListJob, FilmSearchHit, FilmSearchPage } from '../../api/types'
import { filmQueue, useFilmQueue, type FilmQueueItem } from '../../lib/filmQueue'
import { runtime } from '../../lib/films'
import { askFilms } from '../../lib/filmTaste'
import { useOverlay } from '../../lib/overlay'
import type { Batch } from '../../lib/queue'
import { useToast } from '../../lib/toast'
import { useIsDesktop } from '../../lib/useMediaQuery'
import { Icon } from '../Icon'
import { BottomSheet, Dialog } from '../Overlay'
import { Poster } from '../Poster'
import { AskBtn, FilmAsk } from './AskDora'

type Tab = 'search' | 'ids'
const IMDB_ID = /tt\d{7,8}/g
const parseIds = (s: string) => [...new Set(s.match(IMDB_ID) ?? [])]
const kind = (type: string) => (type === 'series' ? 'Series' : 'Movie')

export function FilmAddOverlay() {
  const { value, open, close } = useOverlay('addfilm')
  if (!value) return null
  return <FilmAddDialog tab={value === 'ids' ? 'ids' : 'search'} setTab={(t) => open(t, { replace: true })} onClose={close} />
}

function FilmAddDialog({ tab, setTab, onClose }: { tab: Tab; setTab: (t: Tab) => void; onClose: () => void }) {
  const desktop = useIsDesktop()
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: desktop ? '20px 28px 16px' : '8px 20px 14px' }}>
      <div>
        <div className="f-label">Add to library · Films</div>
        <div style={{ fontSize: desktop ? 21 : 18, fontWeight: 600, letterSpacing: '-0.025em', marginTop: desktop ? 4 : 3 }}>{desktop ? 'Find a film' : 'Find films'}</div>
      </div>
      <button className="f-iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
    </div>
  )
  const seg = (
    <div style={{ padding: '0 28px 18px' }}>
      <div className="f-seg" role="tablist" style={{ maxWidth: 360 }}>
        <button role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
          <Icon name="search" size={15} /> Search titles
        </button>
        <button role="tab" aria-selected={tab === 'ids'} className={tab === 'ids' ? 'on' : ''} onClick={() => setTab('ids')}>
          <Icon name="edit" size={15} /> Enter IMDb ID
        </button>
      </div>
    </div>
  )
  const content = tab === 'ids' && desktop ? <IdsTab /> : <SearchTab desktop={desktop} />

  if (desktop) {
    return (
      <Dialog label="Add films" onClose={onClose}>
        {header}
        {seg}
        <div className="d-dialog-cols">
          <div className="d-dialog-left">
            {content}
            <BatchSettings style={{ marginTop: 22 }} />
          </div>
          <div className="d-dialog-right">
            <QueueList desktop />
            <div style={{ marginTop: 16 }}><SaveFooter /></div>
          </div>
        </div>
      </Dialog>
    )
  }
  return (
    <BottomSheet label="Add films" onClose={onClose} maxHeight="94%">
      {header}
      <div style={{ overflowY: 'auto', padding: '0 20px', scrollbarWidth: 'none', flex: 1, minHeight: 0 }}>
        {content}
        <BatchSettings style={{ margin: '16px 0 14px' }} />
        <QueueList desktop={false} />
        <div style={{ height: 16 }} />
      </div>
      <div style={{ padding: '12px 20px 18px', borderTop: '1px solid var(--hair)', background: 'var(--paper)' }}>
        <SaveFooter />
      </div>
    </BottomSheet>
  )
}

/** A search hit or a looked-up film, as the queue keeps it. */
function queueItem(f: FilmSearchHit | Film): FilmQueueItem {
  return {
    imdb_id: f.imdb_id, title: f.title, year: f.year ?? null, type: f.type, poster_url: f.poster_url ?? null,
    ...('director' in f ? { director: f.director, rated: f.rated } : {}),
  }
}

// ── Search: one title, or a whole list (folio/taste.jsx FilmFinder) ──────

/** Several lines (or titles split by ; or " | ") make a list. */
function isList(text: string) {
  const lines = text.split('\n').filter((l) => l.trim())
  return lines.length > 1 || /;|\s\|\s/.test(text)
}

/** One result row. `n` numbers list rows; `film` is null for a line with no match. */
type Row = {
  key: string; n?: string; line?: string; note?: string | null
  film: (FilmSearchHit | Film) | null; onShelf: boolean; dup?: boolean; guessed?: boolean
}

type Found =
  | { mode: 'single'; pages: FilmSearchPage[] }
  | { mode: 'id'; rows: Row[] }
  | { mode: 'list'; job: FilmListJob }
  | { mode: 'progress'; job: FilmListJob | null }
  | { mode: 'error'; msg: string; signIn?: boolean }

function errorOf(err: unknown, what: string): Found {
  if (err instanceof ApiError && err.status === 401) return { mode: 'error', msg: 'Sign in to search a whole list at once.', signIn: true }
  if (err instanceof ApiError && (err.status === 503 || err.status === 413)) return { mode: 'error', msg: err.message }
  return { mode: 'error', msg: `Couldn't ${what}. Check your connection and try again.` }
}

function SearchTab({ desktop }: { desktop: boolean }) {
  const [q, setQ] = useState('')
  // Searches run on Enter or the search button, never per keystroke: the
  // free OMDb key allows 1,000 calls a day.
  const [query, setQuery] = useState('')
  // Each answer remembers which query it was for; anything else is stale.
  const [answer, setAnswer] = useState<{ q: string; found: Found } | null>(null)
  const [more, setMore] = useState(false)
  const [askedAll, setAskedAll] = useState(false)
  const { items } = useFilmQueue()
  const toast = useToast()
  const queued = new Set(items.map((i) => i.imdb_id))

  useEffect(() => {
    if (query.length < 2) return
    const abort = new AbortController()
    const put = (found: Found) => { if (!abort.signal.aborted) setAnswer({ q: query, found }) }
    const id = query.match(/tt\d{7,8}/)?.[0]
    if (isList(query)) {
      put({ mode: 'progress', job: null })
      findFilmList(query, abort.signal, (job) => put({ mode: 'progress', job }))
        .then((job) => put(job.status === 'failed' ? { mode: 'error', msg: job.error ?? "Couldn't read that list. Try again." } : { mode: 'list', job }))
        .catch((err) => { if ((err as Error).name !== 'AbortError') put(errorOf(err, 'read that list')) })
    } else if (id) {
      // one line with an IMDb ID or link: a plain lookup, no sign-in needed
      lookupFilm(id)
        .then(({ film, on_shelf }) => put({ mode: 'id', rows: [{ key: film.imdb_id, film, onShelf: on_shelf }] }))
        .catch((err) => put(err instanceof ApiError && err.status === 404
          ? { mode: 'id', rows: [{ key: id, line: id, film: null, onShelf: false }] }
          : errorOf(err, 'reach the film catalogue')))
    } else {
      searchFilms(query)
        .then((page) => put({ mode: 'single', pages: [page] }))
        .catch((err) => put(errorOf(err, 'reach the film catalogue')))
    }
    return () => abort.abort()
  }, [query])

  function go(text: string) {
    setQuery(text.trim())
    setAskedAll(false)
  }

  const found = answer?.q === query ? answer.found : null

  async function loadMore() {
    if (found?.mode !== 'single') return
    setMore(true)
    try {
      const next = await searchFilms(query, found.pages.length + 1)
      setAnswer((a) => (a?.q === query && a.found.mode === 'single' ? { q: query, found: { mode: 'single', pages: [...a.found.pages, next] } } : a))
    } catch { toast("Couldn't load more. Try again.", 'err') }
    setMore(false)
  }

  function add(films: (FilmSearchHit | Film)[]) {
    const fresh = films.filter((f) => filmQueue.add(queueItem(f)))
    if (!fresh.length) toast('Already in your library', 'err')
    else toast(fresh.length === 1 ? 'Added · ' + fresh[0].title : `Added ${fresh.length} films`)
  }

  let body: React.ReactNode
  if (query.length < 2) body = <div className="t-empty">One title finds matches. A list finds one match per line.</div>
  else if (!found) body = <div className="t-empty">Searching…</div>
  else if (found.mode === 'error') {
    body = <div className="t-empty">{found.msg}{found.signIn && <> <SignInLink /></>}</div>
  } else if (found.mode === 'progress') {
    const job = found.job
    body = <div className="t-empty" aria-live="polite">
      {job?.status === 'matching' && job.total ? `Finding films · ${job.done} of ${job.total}` : 'Reading your list…'}
    </div>
  } else if (found.mode === 'single') {
    const hits = found.pages.flatMap((p) => p.results)
    const total = found.pages[0]?.total ?? 0
    body = hits.length ? <>
      {hits.map((h) => <FilmRow key={h.imdb_id} row={{ key: h.imdb_id, film: h, onShelf: h.on_shelf }} queued={queued} onAdd={add} />)}
      {hits.length < total && (
        <button className="f-btn f-btn--ghost" style={{ alignSelf: 'center', fontSize: 12.5, padding: '6px 14px' }} onClick={loadMore} disabled={more}>
          {more ? 'Loading…' : 'More results'}
        </button>
      )}
    </> : <div className="t-empty">No films found. Check the spelling, or paste the IMDb ID.</div>
  } else if (found.mode === 'id') {
    body = found.rows.map((r) => <FilmRow key={r.key} row={r} queued={queued} onAdd={add} />)
  } else {
    const rows: Row[] = found.job.rows.map((r, i) => ({
      key: String(i), n: String(i + 1).padStart(2, '0'), line: r.text, note: r.error,
      film: r.film ?? null, onShelf: r.on_shelf, dup: r.dup, guessed: r.guessed,
    }))
    const hits = rows.filter((r) => r.film && !r.dup)
    const inLib = hits.filter((r) => r.onShelf)
    const misses = rows.filter((r) => !r.film)
    const addable = hits.filter((r) => !r.onShelf && !queued.has(r.film!.imdb_id)).map((r) => r.film!)
    // Not in your library yet: still worth asking about, queued or not.
    const askable = hits.filter((r) => !r.onShelf).map((r) => r.film!.imdb_id)
    const lines = new Set(found.job.rows.map((r) => r.line)).size
    body = <>
      <div className="t-listbar">
        <span className="sum">
          {lines} {lines === 1 ? 'line' : 'lines'} · {hits.length} found
          {inLib.length ? ` · ${inLib.length} in library` : ''}{misses.length ? ` · ${misses.length} not found` : ''}
        </span>
        {askable.length > 0 && !askedAll && (
          <AskBtn q="watch or skip, all of them?" onClick={() => { setAskedAll(true); askFilms(askable) }} />
        )}
        <button className="f-btn f-btn--ink t-add" disabled={!addable.length} onClick={() => add(addable)}>
          {addable.length ? `Add all ${addable.length}` : 'All added'}
        </button>
      </div>
      {rows.map((r) => <FilmRow key={r.key} row={r} queued={queued} onAdd={add} />)}
    </>
  }

  const rowsShown = Math.min(7, Math.max(1, q.split('\n').length))
  return (
    <div style={{ paddingTop: 4 }}>
      <label className="f-label" htmlFor="film-search" style={{ display: 'block', marginBottom: 8 }}>Titles or IMDb IDs</label>
      <form className="t-findrow" role="search" onSubmit={(e) => { e.preventDefault(); go(q) }}>
        <textarea id="film-search" className="f-input t-findbox" rows={rowsShown} value={q} onChange={(e) => setQ(e.target.value)}
          // Desktop: Enter searches, Shift + Enter adds a line. Phones keep
          // Enter for new lines and search with the button.
          onKeyDown={(e) => { if (desktop && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(q) } }}
          placeholder="Columbus, or paste a list" autoComplete="off" autoFocus={desktop} spellCheck={false} />
        <button type="submit" className="f-btn f-btn--ink t-findbtn" aria-label="Search" title="Search"><Icon name="search" size={17} sw={1.8} /></button>
      </form>
      <div className="t-hint">
        Put one film on each line to add a list.{desktop ? ' Press Enter to search, Shift + Enter for a new line.' : ''}
      </div>
      <div className={'t-results' + (desktop ? '' : ' flow')}>{body}</div>
    </div>
  )
}

function SignInLink() {
  const location = useLocation()
  return <Link className="t-linkbtn" to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</Link>
}

function FilmRow({ row, queued, onAdd }: { row: Row; queued: Set<string>; onAdd: (films: (FilmSearchHit | Film)[]) => void }) {
  const f = row.film
  if (!f) {
    return (
      <div className="t-row miss">
        <div className="top">
          {row.n && <span className="n">{row.n}</span>}
          <div className="m">
            <div className="t">{row.line}</div>
            <div className="a">{row.note || 'No match. Check the spelling or use the IMDb ID.'}</div>
          </div>
        </div>
      </div>
    )
  }
  const state = row.onShelf ? 'library' : row.dup ? 'dup' : queued.has(f.imdb_id) ? 'added' : 'add'
  const credit = f.type === 'series' ? 'Series' : 'director' in f ? f.director : kind(f.type)
  const meta = [f.year, credit, 'runtime_min' in f && f.runtime_min ? runtime(f) : null, row.guessed ? 'guessed' : null]
  return (
    <div className="t-row">
      <div className="top">
        {row.n && <span className="n">{row.n}</span>}
        <Poster f={f} w={30} hover={false} />
        <div className="m">
          <div className="t" title={f.title}>{f.title}</div>
          <div className="a" title={row.guessed ? `Guessed from "${row.line}"` : undefined}>{meta.filter(Boolean).join(' · ')}</div>
        </div>
        {state === 'add' && <FilmAsk imdbId={f.imdb_id} part="button" />}
        {state === 'library' ? <span className="t-lib">In library</span>
          : state === 'dup' ? <span className="t-lib">Repeat</span>
          : <button className="f-btn f-btn--ink t-add" disabled={state === 'added'} onClick={() => onAdd([f])}>{state === 'added' ? 'Added' : 'Add'}</button>}
      </div>
      {(state === 'add' || state === 'added') && <FilmAsk imdbId={f.imdb_id} part="answer" />}
    </div>
  )
}

// ── IMDb IDs ─────────────────────────────────────────────────────────────

type IdResult = { id: string; state: 'added' | 'dup' | 'bad'; note: string }

function IdsTab() {
  const [raw, setRaw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<IdResult[]>([])
  const toast = useToast()

  async function lookUp() {
    const ids = parseIds(raw)
    if (!ids.length) { setErr("That doesn't look like an IMDb ID. It starts with tt."); return }
    setBusy(true); setErr('')
    const out = await Promise.all(ids.map(async (id): Promise<IdResult> => {
      if (filmQueue.has(id)) return { id, state: 'dup', note: 'Already in the queue' }
      try {
        const { film, on_shelf } = await lookupFilm(id)
        if (on_shelf) return { id, state: 'dup', note: film.title + ' is already in your library' }
        filmQueue.add({ imdb_id: film.imdb_id, title: film.title, year: film.year ?? null, type: film.type, poster_url: film.poster_url ?? null, director: film.director, rated: film.rated })
        return { id, state: 'added', note: film.title }
      } catch (e) {
        return { id, state: 'bad', note: e instanceof ApiError && e.status !== 404 ? e.message : 'No film found. Check the ID.' }
      }
    }))
    setBusy(false)
    setResults(out)
    const added = out.filter((r) => r.state === 'added')
    if (added.length) {
      setRaw('')
      toast(added.length === 1 ? 'Added · ' + added[0].note : `Added ${added.length} films`)
    } else if (out.length === 1) setErr(out[0].note)
    else {
      const dups = out.filter((r) => r.state === 'dup').length
      const bad = out.filter((r) => r.state === 'bad')
      setErr([
        bad.length ? `${bad[0].id}: ${bad[0].note}${bad.length > 1 ? ` (and ${bad.length - 1} more)` : ''}` : '',
        dups ? `${dups} already added.` : '',
      ].filter(Boolean).join(' '))
    }
  }

  const ids = parseIds(raw)
  return (
    <div style={{ paddingTop: 4 }}>
      <label className="f-label" htmlFor="film-ids" style={{ display: 'block', marginBottom: 8 }}>IMDb ID or link</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="film-ids" className="f-input d-idpaste" value={raw} style={{ flex: 1, minWidth: 0 }} autoFocus
          onChange={(e) => { setRaw(e.target.value); setErr('') }} onKeyDown={(e) => { if (e.key === 'Enter') lookUp() }}
          placeholder="tt0340377" autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="go" />
        <button className="f-btn f-btn--ink" onClick={lookUp} disabled={busy} style={{ padding: '0 20px' }}>{busy ? 'Adding…' : 'Add'}</button>
      </div>
      {ids.length > 1 && !err && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {ids.map((id) => <span key={id} className="d-idchip">{id}</span>)}
        </div>
      )}
      {err
        ? <div role="alert" style={{ fontSize: 12.5, color: 'var(--status-error)', marginTop: 10 }}>{err}</div>
        : <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', lineHeight: 1.5, marginTop: 10 }}>
            Try <button className="m-inline-link" onClick={() => setRaw('tt6111130')}>tt6111130</button>. The ID is in the film's IMDb link. Paste several to add them at once.
          </div>}
      {results.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {results.map((r) => <span key={r.id} title={r.note} className={'d-idchip' + (r.state === 'added' ? '' : ' ' + r.state)}>{r.id}</span>)}
        </div>
      )}
    </div>
  )
}

// ── Batch settings, queue, save ──────────────────────────────────────────

function BatchSettings({ style }: { style: React.CSSProperties }) {
  const { batch } = useFilmQueue()
  return (
    <div style={{ display: 'flex', gap: 10, ...style }}>
      <div style={{ flex: 1 }}>
        <label className="f-label" htmlFor="film-batch-status" style={{ display: 'block', marginBottom: 7 }}>Watch status</label>
        <select id="film-batch-status" className="f-select" style={{ width: '100%' }} value={batch.status}
          onChange={(e) => filmQueue.setBatch({ status: e.target.value as Batch['status'] })}>
          <option value="unread">Not watched</option><option value="reading">Watching</option><option value="read">Watched</option>
        </select>
      </div>
      <div style={{ flex: 1 }}>
        <label className="f-label" htmlFor="film-batch-visibility" style={{ display: 'block', marginBottom: 7 }}>Visibility</label>
        <select id="film-batch-visibility" className="f-select" style={{ width: '100%' }} value={batch.visibility}
          onChange={(e) => filmQueue.setBatch({ visibility: e.target.value as Batch['visibility'] })}>
          <option value="public">Public</option><option value="private">Only me</option>
        </select>
      </div>
    </div>
  )
}

function QueueList({ desktop }: { desktop: boolean }) {
  const { items } = useFilmQueue()
  const n = items.length
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: desktop ? 12 : 10 }}>
        <div className="f-label">Queue</div>
        <span aria-live="polite" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, background: n ? 'var(--amber)' : 'var(--paper-2)', color: n ? 'var(--accent-fg)' : 'var(--ink-faint)', borderRadius: 7, padding: '3px 9px', transition: 'all 180ms var(--ease-out)' }}>
          {n} {n === 1 ? 'film' : 'films'}
        </span>
      </div>
      <div style={desktop ? { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120 } : { display: 'flex', flexDirection: 'column', gap: 8 }}>
        {n === 0 && <div style={{ border: '1px dashed var(--hair-strong)', borderRadius: 9, padding: desktop ? 18 : 16, textAlign: 'center', fontSize: 13, color: 'var(--ink-faint)' }}>Films stay here until you save.</div>}
        {items.map((f) => (
          <div className="f-queue-chip t-qchip" key={f.imdb_id}>
            <div className="top">
              <Poster f={f} w={30} hover={false} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.title}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>{f.imdb_id}{f.year ? ' · ' + f.year : ''}</div>
              </div>
              <button onClick={() => filmQueue.remove(f.imdb_id)} className="f-iconbtn" style={{ width: 28, height: 28, flexShrink: 0 }} aria-label={`Remove ${f.title}`}><Icon name="close" size={15} /></button>
            </div>
            <FilmAsk imdbId={f.imdb_id} />
          </div>
        ))}
      </div>
    </>
  )
}

function SaveFooter() {
  const { data: me } = useMe()
  const { items } = useFilmQueue()
  const save = useSaveFilmQueue()
  const [progress, setProgress] = useState<string | null>(null)
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const n = items.length

  // Back to this page with the dialog open, after signing in.
  const params = new URLSearchParams(location.search)
  ;['film', 'book', 'add'].forEach((k) => params.delete(k))
  params.set('addfilm', 'search')
  const here = `${location.pathname}?${params}`

  if (!me) {
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
          <Icon name="lock" size={13} style={{ verticalAlign: '-2px', marginRight: 5, color: 'var(--ink-faint)' }} />
          Sign in to save your films.
        </div>
        <Link to={`/login?next=${encodeURIComponent(here)}`} state={{ reason: 'Sign in to save your films' }} className="f-btn f-btn--ink">Sign in</Link>
      </div>
    )
  }

  function onSave() {
    setProgress(null)
    save.mutate((saved, total) => { if (total > 50 && saved < total) setProgress(`Saving ${saved} of ${total}…`) }, {
      onSuccess: ({ added, errors }) => {
        if (errors.length && !added) { toast(errors[0], 'err'); return } // nothing saved: keep the queue
        filmQueue.clear()
        toast(added ? `${added} ${added === 1 ? 'film' : 'films'} saved.` : 'Those films were already on your shelf.')
        if (errors.length) setTimeout(() => toast(errors[0], 'err'), 600)
        navigate('/profile/films', { replace: true })
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 401) {
          toast('Please sign in again to save. Your queue is kept.', 'err')
          navigate(`/login?next=${encodeURIComponent(here)}`)
        } else toast("Couldn't save. Your queue is kept, try again.", 'err')
      },
    })
  }

  return (
    <button className="f-btn f-btn--amber f-btn--block" disabled={!n || save.isPending} onClick={onSave} style={{ opacity: n ? 1 : 0.45 }}>
      <Icon name="check" size={18} sw={2} /> {save.isPending ? progress ?? 'Saving…' : `Done · save ${n || ''} to library`}
    </button>
  )
}
