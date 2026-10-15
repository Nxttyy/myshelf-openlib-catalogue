/* "Add to library · Films" (folio/films.jsx FilmAddDialog). Search OMDb by
   title, or paste IMDb IDs or links (one or many). Picks wait in the film
   queue until saved. Desktop: two columns, queue on the right. Phone: a
   full-height sheet with save pinned at the bottom. Addressed by
   ?addfilm=search|ids, so Back closes it. */

import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../../api/client'
import { lookupFilm, searchFilms, useSaveFilmQueue } from '../../api/films'
import { useMe } from '../../api/me'
import type { FilmSearchHit, FilmSearchPage } from '../../api/types'
import { filmQueue, useFilmQueue, type FilmQueueItem } from '../../lib/filmQueue'
import { useOverlay } from '../../lib/overlay'
import type { Batch } from '../../lib/queue'
import { useToast } from '../../lib/toast'
import { useIsDesktop } from '../../lib/useMediaQuery'
import { Icon } from '../Icon'
import { BottomSheet, Dialog } from '../Overlay'
import { Poster } from '../Poster'

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
        <div style={{ fontSize: desktop ? 21 : 18, fontWeight: 600, letterSpacing: '-0.025em', marginTop: desktop ? 4 : 3 }}>Find a film</div>
      </div>
      <button className="f-iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
    </div>
  )
  const seg = (
    <div style={{ padding: desktop ? '0 28px 18px' : '0 20px 14px' }}>
      <div className="f-seg" role="tablist" style={desktop ? { maxWidth: 360 } : undefined}>
        <button role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
          <Icon name="search" size={desktop ? 15 : 14} /> Search title
        </button>
        <button role="tab" aria-selected={tab === 'ids'} className={tab === 'ids' ? 'on' : ''} onClick={() => setTab('ids')}>
          <Icon name="edit" size={desktop ? 15 : 14} /> {desktop ? 'Enter IMDb ID' : 'IMDb ID'}
        </button>
      </div>
    </div>
  )
  const content = tab === 'ids' ? <IdsTab /> : <SearchTab desktop={desktop} />

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
      {seg}
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

function queueHit(h: FilmSearchHit): FilmQueueItem {
  return { imdb_id: h.imdb_id, title: h.title, year: h.year ?? null, type: h.type, poster_url: h.poster_url ?? null }
}

// ── Search ───────────────────────────────────────────────────────────────

type Found = { pages: FilmSearchPage[] } | 'error' | { error: string }

function SearchTab({ desktop }: { desktop: boolean }) {
  const [q, setQ] = useState('')
  // Searches run on Enter or the search button, never per keystroke: the
  // free OMDb key allows 1,000 calls a day.
  const [query, setQuery] = useState('')
  // Each answer remembers which query it was for; anything else is stale.
  const [answer, setAnswer] = useState<{ q: string; found: Found } | null>(null)
  const [more, setMore] = useState(false)
  const { items } = useFilmQueue()
  const toast = useToast()
  const queued = new Set(items.map((i) => i.imdb_id))

  useEffect(() => {
    if (query.length < 2) return
    let alive = true
    searchFilms(query)
      .then((page) => { if (alive) setAnswer({ q: query, found: { pages: [page] } }) })
      .catch((err) => { if (alive) setAnswer({ q: query, found: err instanceof ApiError && err.status === 503 ? { error: err.message } : 'error' }) })
    return () => { alive = false }
  }, [query])

  const found = answer?.q === query ? answer.found : null
  const pages = found && typeof found === 'object' && 'pages' in found ? found.pages : null
  const hits = pages?.flatMap((p) => p.results) ?? []
  const total = pages?.[0]?.total ?? 0
  const busy = query.length >= 2 && !found

  async function loadMore() {
    if (!pages) return
    setMore(true)
    try {
      const next = await searchFilms(query, pages.length + 1)
      setAnswer((a) => (a?.q === query && a.found && typeof a.found === 'object' && 'pages' in a.found
        ? { q: query, found: { pages: [...a.found.pages, next] } } : a))
    } catch { toast("Couldn't load more. Try again.", 'err') }
    setMore(false)
  }

  function add(h: FilmSearchHit) {
    if (filmQueue.add(queueHit(h))) toast('Added · ' + h.title)
  }

  return (
    <div style={{ paddingTop: 4 }}>
      <label className="f-label" htmlFor="film-search" style={{ display: 'block', marginBottom: 8 }}>Search by title</label>
      <form className="d-searchrow" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()) }}>
        <input id="film-search" className="f-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try columbus, tampopo, paterson"
          type="search" enterKeyHint="search" autoComplete="off" autoFocus style={{ boxSizing: 'border-box' }} />
        <button type="submit" className="f-btn f-btn--ink d-searchbtn" aria-label="Search" title="Search"><Icon name="search" size={17} sw={1.8} /></button>
      </form>
      <div className="d-results" style={desktop ? undefined : { maxHeight: 'none' }}>
        {query.length < 2 && <div className="empty">Type a film or series title, then press Enter.</div>}
        {busy && <div className="empty">Searching…</div>}
        {found === 'error' && <div className="empty">Couldn't reach the film catalogue. Check your connection.</div>}
        {found && typeof found === 'object' && 'error' in found && <div className="empty">{found.error}</div>}
        {pages && !hits.length && <div className="empty">No films found. Check the spelling, or paste the IMDb ID.</div>}
        {hits.map((h) => {
          const have = h.on_shelf || queued.has(h.imdb_id)
          return (
            <div className="d-result" key={h.imdb_id}>
              <div className="top">
                <Poster f={h} w={30} hover={false} />
                <div className="m">
                  <div className="t" title={h.title}>{h.title}</div>
                  <div className="a">{[h.year, kind(h.type)].filter(Boolean).join(' · ')}</div>
                </div>
                <button className="f-btn f-btn--ink" style={{ padding: '6px 14px', fontSize: 12.5 }} disabled={have} onClick={() => add(h)}>
                  {h.on_shelf ? 'On shelf' : queued.has(h.imdb_id) ? 'Added' : 'Add'}
                </button>
              </div>
            </div>
          )
        })}
        {hits.length > 0 && hits.length < total && (
          <button className="f-btn f-btn--ghost" style={{ alignSelf: 'center', fontSize: 12.5, padding: '6px 14px' }} onClick={loadMore} disabled={more}>
            {more ? 'Loading…' : 'More results'}
          </button>
        )}
      </div>
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
          <div className="f-queue-chip" key={f.imdb_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Poster f={f} w={30} hover={false} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.title}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>{f.imdb_id}{f.year ? ' · ' + f.year : ''}</div>
            </div>
            <button onClick={() => filmQueue.remove(f.imdb_id)} className="f-iconbtn" style={{ width: 28, height: 28, flexShrink: 0 }} aria-label={`Remove ${f.title}`}><Icon name="close" size={15} /></button>
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
        <Link to={`/login?next=${encodeURIComponent(here)}`} className="f-btn f-btn--ink">Sign in</Link>
      </div>
    )
  }

  function onSave() {
    save.mutate(undefined, {
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
      <Icon name="check" size={18} sw={2} /> {save.isPending ? 'Saving…' : `Done · save ${n || ''} to library`}
    </button>
  )
}
