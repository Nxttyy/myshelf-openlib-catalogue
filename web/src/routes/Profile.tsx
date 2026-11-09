/* Profiles. /profile is your own (folio/desktop-app-v2.jsx profile view,
   reflowed for phones by styles/mobile.css); /u/:handle is someone else's,
   the same layout read-only. The /films twins show films instead
   (folio/films-v2.jsx FilmProfile) under the same header. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { initials, useMe } from '../api/me'
import { useMyFilms, usePublicFilms, useUpdateFilmEntry } from '../api/films'
import { useMyShelf, usePublicProfile } from '../api/queries'
import { useSetUsername, useUpdateShelfEntry } from '../api/shelf'
import type { FilmShelfCounts, FilmShelfEntry, Haul, ShelfCounts, ShelfEntry, ShelfOwner } from '../api/types'
import { FilmList, FilmShelf } from '../components/FilmViews'
import { Icon } from '../components/Icon'
import { SharePanel, SharePopover } from '../components/Share'
import { Hauls, ShelfGrid } from '../components/ShelfViews'
import { TagFilter, TagSearch } from '../components/TagFilter'
import { useMedia } from '../lib/media'
import { useOpenAdd, useOverlay } from '../lib/overlay'
import { EMPTY_FILTER, matches, publishTags, taggableBook, taggableFilm, type ShelfFilter } from '../lib/tagFilter'
import { useToast } from '../lib/toast'
import NotFound from './NotFound'

type Mode = 'shelf' | 'hauls'

export function MyProfile() {
  const location = useLocation()
  const films = useMedia() === 'films'
  const { data: me, isPending: meLoading } = useMe()
  const { data, isError } = useMyShelf(!!me && !films)
  const filmShelf = useMyFilms(!!me && films)
  if (!meLoading && !me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  if (films) {
    if (filmShelf.isError) return <Message text="Couldn't load your films. Try again in a moment." />
    if (!filmShelf.data) return <Message text="Loading your films…" />
    return <FilmProfileView owner={filmShelf.data.owner} counts={filmShelf.data.counts} entries={filmShelf.data.entries} mine />
  }
  if (isError) return <Message text="Couldn't load your shelf. Try again in a moment." />
  if (!data) return <Message text="Loading your shelf…" />
  return <ProfileView owner={data.owner} counts={data.counts} entries={data.entries} hauls={data.hauls} mine />
}

export function PublicProfile() {
  const { handle = '' } = useParams()
  const location = useLocation()
  const films = useMedia() === 'films'
  const { data: me } = useMe()
  const { data, error } = usePublicProfile(handle, !films)
  const filmShelf = usePublicFilms(handle, films)
  const err = films ? filmShelf.error : error
  // a shared link to your own shelf keeps its ?book= / ?photo=
  if (me && me.handle === handle) return <Navigate to={(films ? '/profile/films' : '/profile') + location.search} replace />
  if (err instanceof ApiError && err.status === 404) return <NotFound text="This shelf is private, or there's no one here by that name." />
  if (err) return <Message text="Couldn't load this shelf. Try again in a moment." />
  if (films) {
    if (!filmShelf.data) return <Message text="Loading…" />
    return <FilmProfileView owner={filmShelf.data.owner} counts={filmShelf.data.counts} entries={filmShelf.data.entries} mine={false} />
  }
  if (!data) return <Message text="Loading…" />
  return <ProfileView owner={data.owner} counts={data.counts} entries={data.entries} hauls={data.hauls} mine={false} />
}

function Message({ text }: { text: string }) {
  return <div className="f-label" style={{ textAlign: 'center', padding: '80px 18px' }}>{text}</div>
}

type ViewProps = { owner: ShelfOwner; counts: ShelfCounts; entries: ShelfEntry[]; hauls: Haul[]; mine: boolean }

type Intent = { mode?: Mode; tag?: string } | null

/** Search, tags and status for the shelf. Arriving with a tag picked in a
    record (navigate state `tag`) applies it, even when you were already on
    the page; opening a record over the page (a ?book= change) keeps them.
    The picked tags are published for the record to highlight. */
function useShelfFilter() {
  const location = useLocation()
  const tag = (location.state as Intent)?.tag
  const [flt, setFlt] = useState<ShelfFilter>(tag ? { ...EMPTY_FILTER, tags: [tag] } : EMPTY_FILTER)
  const [seen, setSeen] = useState(location.key)
  if (seen !== location.key) {
    setSeen(location.key)
    if (tag) setFlt({ ...EMPTY_FILTER, tags: [tag] })
  }
  useEffect(() => { publishTags(flt.tags) }, [flt.tags])
  useEffect(() => () => publishTags([]), [])
  return [flt, setFlt] as const
}

/** Shelf or Hauls; saving the add dialog lands here with state.mode 'hauls'. */
function useMode<M extends string>(initial: M) {
  const location = useLocation()
  const asked = (location.state as Intent)?.mode as M | undefined
  const [mode, setMode] = useState<M>(asked ?? initial)
  const [seen, setSeen] = useState(location.key)
  if (seen !== location.key) {
    setSeen(location.key)
    if (asked) setMode(asked)
  }
  return [mode, setMode] as const
}

function ProfileView({ owner, counts, entries, hauls, mine }: ViewProps) {
  const [mode, setMode] = useMode<Mode>('shelf')
  const [flt, setFlt] = useShelfFilter()
  const { open } = useOverlay('book')
  const update = useUpdateShelfEntry()
  const toast = useToast()
  const onAdd = useOpenAdd()

  const items = useMemo(() => entries.map(taggableBook), [entries])
  const shown = entries.filter((_, i) => matches(items[i], flt))
  const onOpen = (e: ShelfEntry) => open(e.book.id)
  const onPin = mine ? (e: ShelfEntry) => {
    const pin = !e.is_pinned
    update.mutate({ id: e.id, patch: { is_pinned: pin } }, {
      onSuccess: () => toast((pin ? 'Moved to top · ' : 'Removed from top · ') + e.book.title),
      onError: () => toast("Couldn't change that. Try again.", 'err'),
    })
  } : undefined

  const stats: Stat[] = [['Books', counts.all, null], ['Reading now', counts.reading, 'reading'], ['Read', counts.read, 'read'], ['Not read', counts.unread, 'unread']]
  const label = mine ? 'Your books' : `@${owner.handle}'s books`

  return (
    <div className="f-rise d-page">
      <ProfileHead owner={owner} mine={mine} value={flt} onChange={setFlt}
        placeholder={mine ? 'Search your books by title or author' : 'Search these books by title or author'} />
      <StatTiles stats={stats} on={flt.status} onPick={(status) => setFlt((f) => ({ ...f, status }))} />
      {entries.length === 0 ? (
        <Empty mine={mine} what="books" onAdd={onAdd} />
      ) : (
        <>
          <TagFilter items={items} value={flt} onChange={setFlt} shown={shown.length} kindWord="books" mine={mine} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div className="f-label">{label}</div>
            <ModeToggle mode={mode} setMode={setMode} />
          </div>
          {mode === 'shelf'
            ? <ShelfGrid entries={shown} onOpen={onOpen} onPin={onPin} />
            : <Hauls hauls={hauls} entries={entries} onOpen={onOpen} />}
        </>
      )}
    </div>
  )
}

function ModeToggle<M extends string>({ mode, setMode, modes = ['shelf', 'hauls'] as M[] }: { mode: M; setMode: (m: M) => void; modes?: M[] }) {
  return (
    <div className="d-viewseg" role="group" aria-label="View">
      {modes.map((m) => (
        <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
      ))}
    </div>
  )
}

function Empty({ mine, what, onAdd }: { mine: boolean; what: 'books' | 'films'; onAdd: () => void }) {
  return (
    <div style={{ padding: '60px 18px', textAlign: 'center', color: 'var(--ink-faint)' }}>
      <div className="f-label" style={{ marginBottom: 8 }}>Nothing here yet</div>
      {!mine ? <div style={{ fontSize: 14 }}>No public {what} on this shelf yet.</div> : what === 'books'
        ? <><div style={{ fontSize: 14, marginBottom: 18 }}>Scan a barcode to add your first book.</div>
            <button className="f-btn f-btn--amber" onClick={onAdd}><Icon name="scan" size={18} sw={1.8} /> Scan a book</button></>
        : <><div style={{ fontSize: 14, marginBottom: 18 }}>Search a title or paste an IMDb ID to add your first film.</div>
            <button className="f-btn f-btn--amber" onClick={onAdd}><Icon name="plus" size={18} sw={1.8} /> Add films</button></>}
    </div>
  )
}

/** label, number, and the status it filters to (null: everything; false: not a filter) */
type Stat = [string, number, string | null | false]

/** The four numbers under the header, which double as status filters. */
function StatTiles({ stats, on, onPick }: { stats: Stat[]; on: string | null; onPick: (status: string | null) => void }) {
  return (
    <div className="d-pf-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'var(--hair)', border: '1px solid var(--hair)', borderRadius: 12, overflow: 'hidden', marginBottom: 36 }}>
      {stats.map(([k, v, key]) => key === false ? (
        <div key={k} className="d-pf-stat" style={{ background: 'var(--paper)', padding: '18px 20px' }}>
          <div className="d-bignum" style={{ fontSize: 46 }}>{v}</div>
          <div className="f-label" style={{ marginTop: 8 }}>{k}</div>
        </div>
      ) : (
        <button key={k} className={'d-pf-stat d-pf-stat--btn' + (on === key ? ' on' : '')} aria-pressed={on === key}
          onClick={() => onPick(key)} style={{ background: 'var(--paper)', padding: '18px 20px' }}>
          <div className="d-bignum" style={{ fontSize: 46 }}>{v}</div>
          <div className="f-label" style={{ marginTop: 8 }}>{k}</div>
        </button>
      ))}
    </div>
  )
}

// ── Films ─────────────────────────────────────────────────────────────────

type FilmMode = 'shelf' | 'list'

function FilmProfileView({ owner, counts, entries, mine }: { owner: ShelfOwner; counts: FilmShelfCounts; entries: FilmShelfEntry[]; mine: boolean }) {
  const [mode, setMode] = useState<FilmMode>('shelf')
  const [flt, setFlt] = useShelfFilter()
  const { open } = useOverlay('film')
  const update = useUpdateFilmEntry()
  const toast = useToast()
  const onAdd = useOpenAdd()

  const items = useMemo(() => entries.map(taggableFilm), [entries])
  const shown = entries.filter((_, i) => matches(items[i], flt))
  const onOpen = (e: FilmShelfEntry) => open(e.film.id)
  const onPin = mine ? (e: FilmShelfEntry) => {
    const pin = !e.is_pinned
    update.mutate({ id: e.id, patch: { is_pinned: pin } }, {
      onSuccess: () => toast((pin ? 'Moved to top · ' : 'Removed from top · ') + e.film.title),
      onError: () => toast("Couldn't change that. Try again.", 'err'),
    })
  } : undefined
  const stats: Stat[] = [
    ['Films', counts.all, null], ['Watched', counts.read, 'read'], ['Not watched', counts.unread, 'unread'],
    ['Hours watched', Math.round(counts.minutes_watched / 60), false],
  ]
  const label = mine ? 'Your films' : `@${owner.handle}'s films`

  return (
    <div className="f-rise d-page">
      <ProfileHead owner={owner} mine={mine} value={flt} onChange={setFlt}
        placeholder={mine ? 'Search your films by title, director or cast' : 'Search these films by title, director or cast'} />
      {entries.length > 0 && <TagFilter items={items} value={flt} onChange={setFlt} shown={shown.length} kindWord="films" mine={mine} />}
      <StatTiles stats={stats} on={flt.status} onPick={(status) => setFlt((f) => ({ ...f, status }))} />
      {entries.length === 0 ? <Empty mine={mine} what="films" onAdd={onAdd} /> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div className="f-label">{label}</div>
            <ModeToggle mode={mode} setMode={setMode} modes={['shelf', 'list']} />
          </div>
          {mode === 'shelf' ? <FilmShelf entries={shown} onOpen={onOpen} onPin={onPin} /> : <FilmList entries={shown} onOpen={onOpen} />}
        </>
      )}
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────

const displayName = (o: ShelfOwner) => [o.firstname, o.lastname].filter((s) => s.trim()).join(' ') || '@' + o.handle
const profileUrl = (handle: string) => `${window.location.origin}/u/${handle}`
const shortUrl = (handle: string) => `${window.location.host}/u/${handle}`

/** Avatar, name, handle, and the shelf search (folio/desktop-app-v2.jsx
    pfHead). Your own visibility, share link and sign out live in the
    account menu; someone else's shelf keeps a Share button. */
function ProfileHead({ owner, mine, value, onChange, placeholder }: {
  owner: ShelfOwner; mine: boolean; value: ShelfFilter; onChange: (f: ShelfFilter) => void; placeholder: string
}) {
  const [share, setShare] = useState(false)
  return (
    <div className="d-pf-head" style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 28 }}>
      <div className="d-pf-av" style={{ width: 96, height: 96, borderRadius: 12, background: 'var(--ink-blue)', color: 'var(--paper)', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 38, letterSpacing: '-0.03em', flexShrink: 0 }}>{initials(owner)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em', margin: 0, overflowWrap: 'anywhere' }}>{displayName(owner)}</h1>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-faint)', marginTop: 4 }}>
          {mine ? <HandleEditor handle={owner.handle} /> : <>@{owner.handle}</>} · {shortUrl(owner.handle)}
        </div>
      </div>
      {!mine && (
        <div className="d-share-wrap">
          <button className="f-btn f-btn--ghost" onClick={() => setShare((s) => !s)} aria-expanded={share}><Icon name="share" size={16} /> Share</button>
          {share && <ProfileSharePopover owner={owner} mine={mine} onClose={() => setShare(false)} />}
        </div>
      )}
      <div className="d-pf-search"><TagSearch value={value} onChange={onChange} placeholder={placeholder} /></div>
    </div>
  )
}

/** The @handle, with a pencil to change it. */
function HandleEditor({ handle }: { handle: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(handle)
  const set = useSetUsername()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) input.current?.select() }, [editing])

  if (!editing) {
    return (
      <span style={{ whiteSpace: 'nowrap' }}>
        @{handle}
        <button onClick={() => { setValue(handle); setEditing(true) }} aria-label="Change username" title="Change username"
          className="m-handle-edit"><Icon name="edit" size={13} /></button>
      </span>
    )
  }
  function save(e: React.FormEvent) {
    e.preventDefault()
    const v = value.trim().toLowerCase()
    if (v === handle) { setEditing(false); return }
    set.mutate(v, {
      onSuccess: () => { toast('Username changed to @' + v); setEditing(false) },
      onError: (err) => toast(err.message, 'err'),
    })
  }
  return (
    <form onSubmit={save} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      @<input ref={input} value={value} onChange={(e) => setValue(e.target.value)} maxLength={30} aria-label="Username"
        autoCapitalize="none" autoCorrect="off" spellCheck={false} className="m-handle-input"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }} />
      <button type="submit" className="f-btn f-btn--ink" style={{ padding: '5px 10px', fontSize: 12 }} disabled={set.isPending}>Save</button>
      <button type="button" className="f-btn f-btn--ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setEditing(false)}>Cancel</button>
    </form>
  )
}

function ProfileSharePopover({ owner, mine, onClose }: { owner: ShelfOwner; mine: boolean; onClose: () => void }) {
  return <SharePopover onClose={onClose}><ShareBody owner={owner} mine={mine} onDone={onClose} channels /></SharePopover>
}

function ShareBody({ owner, mine, onDone, channels }: { owner: ShelfOwner; mine: boolean; onDone: () => void; channels?: boolean }) {
  const isPrivate = mine && !owner.is_profile_public
  return (
    <SharePanel heading={mine ? 'Share your shelf' : 'Share this shelf'}
      note={isPrivate ? 'Your shelf is private right now. Make it public so people with the link can see it.' : 'People with this link can see the public books and films.'}
      url={profileUrl(owner.handle)} short={shortUrl(owner.handle)} emailSubject={`${displayName(owner)}'s shelf on Dora`}
      onDone={onDone} channels={channels} />
  )
}
