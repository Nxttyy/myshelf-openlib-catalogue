/* A film's record, opened from any poster via ?film=<id>. From
   folio/films.jsx FilmDrawer: poster and title, IMDb / Rotten Tomatoes /
   Metacritic scores, plot, genres, details, cast, awards and links. A right
   drawer on desktop, a bottom sheet on phones. On your own copy you get
   status, visibility, note and photos, with an explicit Save like books;
   on a film you don't have yet, Ask Dora whether it fits your taste. */

import { useState } from 'react'
import { Link, useLocation, useMatch } from 'react-router'
import { useAddFilmToShelf, useFilmEntry, usePublicFilms, useUpdateFilmEntry } from '../api/films'
import { useMe } from '../api/me'
import type { Film, FilmEntryRead, FilmShelfEntry } from '../api/types'
import { filmLinks, runtime } from '../lib/films'
import { useOverlay } from '../lib/overlay'
import { useToast } from '../lib/toast'
import { useIsDesktop } from '../lib/useMediaQuery'
import { FilmAsk } from './add/AskDora'
import { OnShelfBadge } from './CatalogGrid'
import { Icon } from './Icon'
import { BottomSheet, Drawer } from './Overlay'
import { PhotoNotes } from './PhotoNotes'
import { Poster } from './Poster'
import { StatusBadge, SubjectPill, type ReadingStatus } from './StatusBadge'

export function FilmOverlay() {
  const { value: id, close } = useOverlay('film')
  if (!id) return null
  return <FilmRecord key={id} id={id} onClose={close} />
}

function FilmRecord({ id, onClose }: { id: string; onClose: () => void }) {
  const isDesktop = useIsDesktop()
  const { data, isError } = useFilmEntry(id)
  const theirs = useProfileEntry(id)
  const body = data
    ? <RecordBody entry={data} desktop={isDesktop} theirs={theirs} onSaved={onClose} />
    : <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 14 }}>
        {isError ? "We couldn't find that film." : 'Loading…'}
      </div>
  return isDesktop
    ? <Drawer label="Film record" onClose={onClose}>{body}</Drawer>
    : <BottomSheet label="Film record" onClose={onClose}>
        <div style={{ overflowY: 'auto', padding: '14px 20px 30px', scrollbarWidth: 'none' }}>{body}</div>
      </BottomSheet>
}

/** On /u/:handle/films, that person's entry for this film (note, photos). */
function useProfileEntry(filmId: string): { handle: string; entry: FilmShelfEntry } | null {
  const match = useMatch('/u/:handle/films')
  const handle = match?.params.handle ?? ''
  const { data } = usePublicFilms(handle, !!match)
  const entry = data?.entries.find((e) => e.film.id === filmId)
  return entry ? { handle, entry } : null
}

const SCORES: [string, string, string][] = [
  ['Internet Movie Database', 'IMDb', '/10'], ['Rotten Tomatoes', 'Rotten Tomatoes', ''], ['Metacritic', 'Metacritic', '/100'],
]

function released(f: Film) {
  if (!f.released) return f.year
  // OMDb's own format, e.g. 05 Dec 2003
  return new Date(f.released + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

type BodyProps = {
  entry: FilmEntryRead; desktop: boolean
  theirs: { handle: string; entry: FilmShelfEntry } | null; onSaved: () => void
}

function RecordBody({ entry, desktop, theirs, onSaved }: BodyProps) {
  const f = entry.film
  const mine = entry.shelf
  const [draftStatus, setDraftStatus] = useState(mine?.status)
  const [pop, setPop] = useState(false)
  const scores = SCORES.flatMap(([source, label, suffix]) => {
    const r = f.ratings.find((x) => x.source === source)
    return r ? [{ label, value: suffix ? r.value.replace(suffix, '') : r.value, suffix }] : []
  })
  const meta = ([
    ['Director', f.director], ['Writer', f.writer], ['Released', released(f)], ['Runtime', f.runtime_min ? runtime(f) : null],
    ['Language', f.language], ['Country', f.country], ['Rated', f.rated], ['IMDb ID', f.imdb_id],
  ] as [string, string | null | undefined][]).filter((m): m is [string, string] => !!m[1])
  const status = (mine ? draftStatus : theirs?.entry.status) as ReadingStatus | undefined
  const badge = status ? <StatusBadge status={status} animate={pop} film /> : entry.on_shelf ? <OnShelfBadge /> : null
  const line = [f.year, f.runtime_min ? runtime(f) : null, f.rated, f.type === 'series' ? 'Series' : null].filter(Boolean).join(' · ')
  const gap = desktop ? 20 : 16

  return (
    <>
      <div style={{ display: 'flex', gap: desktop ? 22 : 16, marginBottom: gap }}>
        <Poster f={f} w={desktop ? 132 : 104} hover={false} />
        <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
          <h2 style={desktop
            ? { fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.05, margin: '0 0 8px' }
            : { fontSize: 21, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.08, margin: '0 0 6px' }}>{f.title}</h2>
          {line && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-faint)', marginBottom: 8 }}>{line}</div>}
          {(f.director || f.writer) && <div style={{ fontSize: desktop ? 14 : 13.5, color: 'var(--ink-soft)', marginBottom: desktop ? 14 : 12 }}>{f.director || f.writer}</div>}
          {badge}
        </div>
      </div>

      {scores.length > 0 && (
        <div className="d-scores" style={{ gridTemplateColumns: `repeat(${scores.length},1fr)` }}>
          {scores.map((s) => (
            <div key={s.label}><div className="d-bignum">{s.value}<small>{s.suffix}</small></div><div className="f-label">{s.label}</div></div>
          ))}
        </div>
      )}

      {/* Not on your shelf yet: should you add it? Phones ask right under
          the scores, as in films-mobile.jsx; desktop asks at the end. */}
      {!entry.on_shelf && !desktop && <div style={{ marginBottom: 16 }}><FilmAsk imdbId={f.imdb_id} /></div>}

      {f.plot && <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)', margin: '0 0 16px', textWrap: 'pretty' }}>{f.plot}</p>}
      {f.genres.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: gap }}>
          {f.genres.map((g) => <SubjectPill key={g}>{g}</SubjectPill>)}
        </div>
      )}

      <div className="f-metagrid" style={{ marginBottom: 14 }}>
        {meta.map(([k, v], i) => (
          // an odd count (a series has no director) lets the last cell fill the row
          <div className="f-metacell" key={k} style={meta.length % 2 && i === meta.length - 1 ? { gridColumn: '1 / -1' } : undefined}>
            <div className="k">{k}</div>
            <div className="v" style={k === 'IMDb ID' ? { fontFamily: 'var(--font-mono)', fontSize: 12 } : undefined}>{v}</div>
          </div>
        ))}
      </div>
      {f.actors && <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 6 }}><span className="f-label" style={{ marginRight: 8 }}>Cast</span>{f.actors}</div>}
      {f.awards && <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 20 }}><span className="f-label" style={{ marginRight: 8 }}>Awards</span>{f.awards}</div>}

      <div className="f-label" style={{ margin: '14px 0 9px' }}>Find this film</div>
      <div className="f-links" style={{ marginBottom: 24 }}>
        {filmLinks(f).map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="f-link">{l.label}<Icon name="external" size={11} /></a>
        ))}
      </div>

      {theirs && !mine && (theirs.entry.comment || theirs.entry.images.length > 0) && (
        <div style={{ marginBottom: 22 }}>
          <div className="f-label" style={{ marginBottom: 9 }}>Note from @{theirs.handle}</div>
          {theirs.entry.comment && <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>{theirs.entry.comment}</p>}
          {theirs.entry.images.length > 0 && <PhotoNotes photos={theirs.entry.images} editable={false} context={f.title} owner="film" />}
        </div>
      )}

      {!entry.on_shelf && desktop && <div style={{ marginBottom: 14 }}><FilmAsk imdbId={f.imdb_id} /></div>}

      {mine
        ? <ShelfEditor key={mine.id} mine={mine} title={f.title} onStatus={(s) => { setDraftStatus(s); setPop(true); setTimeout(() => setPop(false), 400) }} onSaved={onSaved} />
        : <ShelfAction entry={entry} />}
    </>
  )
}

function ShelfEditor({ mine, title, onStatus, onSaved }: {
  mine: FilmShelfEntry; title: string; onStatus: (s: string) => void; onSaved: () => void
}) {
  const [status, setStatus] = useState(mine.status)
  const [isPublic, setIsPublic] = useState(mine.is_public)
  const [comment, setComment] = useState(mine.comment ?? '')
  const update = useUpdateFilmEntry()
  const toast = useToast()

  function save() {
    update.mutate({ id: mine.id, patch: { status, is_public: isPublic, comment } }, {
      onSuccess: () => { toast('Saved.'); setTimeout(onSaved, 600) },
      onError: () => toast("Couldn't save. Try again.", 'err'),
    })
  }

  return (
    <>
      <div className="f-label" style={{ marginBottom: 9 }}>Your shelf</div>
      <div className="f-editrow">
        <select className="f-select" aria-label="Watch status" value={status} onChange={(e) => { setStatus(e.target.value); onStatus(e.target.value) }}>
          <option value="unread">Not watched</option><option value="reading">Watching</option><option value="read">Watched</option>
        </select>
        <select className="f-select" aria-label="Visibility" value={isPublic ? 'public' : 'private'} onChange={(e) => setIsPublic(e.target.value === 'public')}>
          <option value="public">Public</option><option value="private">Only me</option>
        </select>
      </div>
      <textarea className="f-textarea" rows={3} placeholder="Add a note about this film…" aria-label="Your note"
        value={comment} onChange={(e) => setComment(e.target.value)} />
      <PhotoNotes photos={mine.images} entryId={mine.id} editable context={title} owner="film" />
      <button className="f-btn f-btn--amber f-btn--block" style={{ marginTop: 14 }} onClick={save} disabled={update.isPending}>
        <Icon name="check" size={15} sw={2.2} /> {update.isPending ? 'Saving…' : 'Save changes'}
      </button>
    </>
  )
}

function ShelfAction({ entry }: { entry: FilmEntryRead }) {
  const { data: me } = useMe()
  const add = useAddFilmToShelf()
  const toast = useToast()
  const location = useLocation()

  if (entry.on_shelf) {
    return (
      <div className="f-btn f-btn--ghost f-btn--block" style={{ cursor: 'default' }}>
        <Icon name="check" size={17} sw={2} /> On your shelf
      </div>
    )
  }
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Link to={`/login?next=${next}`} className="f-btn f-btn--ink f-btn--block"><Icon name="lock" size={15} /> Sign in to add it to your shelf</Link>
  }
  return (
    <button className="f-btn f-btn--amber f-btn--block" disabled={add.isPending}
      onClick={() => add.mutate(entry.film.id, {
        onSuccess: () => toast('Added to your shelf.'),
        onError: () => toast("Couldn't add it. Try again.", 'err'),
      })}>
      <Icon name="plus" size={18} sw={1.9} /> {add.isPending ? 'Adding…' : 'Add to your shelf'}
    </button>
  )
}
