/* A film's record, opened from any poster via ?film=<id>. From
   folio/films.jsx FilmDrawer: poster and title, IMDb / Rotten Tomatoes /
   Metacritic scores, plot, tags, details, cast, awards and links, under the
   blurred-poster header (folio/films-v2.jsx). A right drawer on desktop, a
   full-screen sheet on phones. On your own copy you get
   your log (once you're watching or have watched it), status, visibility,
   note and photos, with an explicit Save and Remove like books; on someone's
   public profile, their log, note and photos show read-only; on a film you
   don't have yet, Ask Dora whether it fits your taste. */

import { useState } from 'react'
import { Link, useLocation, useMatch } from 'react-router'
import { useAddFilmToShelf, useFilmEntry, usePublicFilms, useRemoveFilmEntry, useUpdateFilmEntry } from '../api/films'
import { useMe } from '../api/me'
import type { Film, FilmEntryRead, FilmShelfEntry } from '../api/types'
import { filmLinks, runtime } from '../lib/films'
import { useOverlay } from '../lib/overlay'
import { shareTitle, usePhotoLinks, useShareLink, type ShareLink } from '../lib/share'
import { useToast } from '../lib/toast'
import { fromLog, showsLog, toWrite } from '../lib/diary'
import { filmTags } from '../lib/tagFilter'
import { FilmAsk } from './add/AskDora'
import { OnShelfBadge } from './CatalogGrid'
import { DiaryLog, LogSummary, SaveRow } from './DiaryLog'
import { Icon } from './Icon'
import { DetailHero } from './DetailHero'
import { Drawer } from './Overlay'
import { PhotoNotes } from './PhotoNotes'
import { Poster } from './Poster'
import { ShareButton } from './Share'
import { RecordTags } from './RecordTags'
import { StatusBadge, type ReadingStatus } from './StatusBadge'

export function FilmOverlay() {
  const { value: id, close } = useOverlay('film')
  if (!id) return null
  return <FilmRecord key={id} id={id} onClose={close} />
}

function FilmRecord({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isError } = useFilmEntry(id)
  const theirs = useProfileEntry(id)
  return (
    <Drawer label="Film record" onClose={onClose} hero={!!data}>
      {data
        ? <RecordBody entry={data} theirs={theirs} onClose={onClose} />
        : <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 14 }}>
            {isError ? "We couldn't find that film." : 'Loading…'}
          </div>}
    </Drawer>
  )
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
  entry: FilmEntryRead
  theirs: { handle: string; entry: FilmShelfEntry } | null; onClose: () => void
}

function RecordBody({ entry, theirs, onClose }: BodyProps) {
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
  const link = useShareLink('film', f.id, theirs?.handle ?? null, mine)
  const title = shareTitle(f.title, f.director || f.writer?.split(',')[0], f.year)
  const theirPhotos = usePhotoLinks('film', f.id, theirs?.handle ?? null, null)
  const myPhotos = usePhotoLinks('film', f.id, null, mine)
  const line = [f.year, f.runtime_min ? runtime(f) : null, f.rated, f.type === 'series' ? 'Series' : null].filter(Boolean).join(' · ')

  return (
    <>
      <DetailHero onClose={onClose} cover={<Poster f={f} w={208} hover={false} />}
        blur={f.poster_url ? <img src={f.poster_url} alt="" /> : <Poster f={f} w={640} hover={false} />}>
        <div style={{ flex: 1, minWidth: 0, paddingTop: 4, position: 'relative' }}>
          <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.05, margin: '0 0 8px' }}>{f.title}</h2>
          {line && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-faint)', marginBottom: 8 }}>{line}</div>}
          {(f.director || f.writer) && <div style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 14 }}>{f.director || f.writer}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {badge}
            <ShareButton link={link} title={title} heading="Share this film" className="f-btn f-btn--ghost m-share-btn" label="Share" iconSize={14} inParent />
          </div>
        </div>
      </DetailHero>

      {scores.length > 0 && (
        <div className="d-scores" style={{ gridTemplateColumns: `repeat(${scores.length},1fr)` }}>
          {scores.map((s) => (
            <div key={s.label}><div className="d-bignum">{s.value}<small>{s.suffix}</small></div><div className="f-label">{s.label}</div></div>
          ))}
        </div>
      )}

      {f.plot && <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)', margin: '0 0 16px', textWrap: 'pretty' }}>{f.plot}</p>}
      <RecordTags tags={filmTags(f)} kind="film" />

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

      {theirs && !mine && theirs.entry.log && showsLog(theirs.entry.status) && (
        <>
          <div className="f-label" style={{ marginBottom: 12 }}>Log from @{theirs.handle}</div>
          <LogSummary kind="film" log={theirs.entry.log} />
        </>
      )}

      {theirs && !mine && (theirs.entry.comment || theirs.entry.images.length > 0) && (
        <div style={{ marginBottom: 22 }}>
          <div className="f-label" style={{ marginBottom: 9 }}>Note from @{theirs.handle}</div>
          {theirs.entry.comment && <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>{theirs.entry.comment}</p>}
          {theirs.entry.images.length > 0 && <PhotoNotes photos={theirs.entry.images} editable={false} context={f.title} owner="film" share={theirPhotos} shareTitle={title} />}
        </div>
      )}

      {!entry.on_shelf && <div style={{ marginBottom: 14 }}><FilmAsk imdbId={f.imdb_id} /></div>}

      {mine
        ? <ShelfEditor key={mine.id} mine={mine} title={f.title} sharePhoto={myPhotos} linkTitle={title} onStatus={(s) => { setDraftStatus(s); setPop(true); setTimeout(() => setPop(false), 400) }} onSaved={onClose} />
        : <ShelfAction entry={entry} />}
    </>
  )
}

function ShelfEditor({ mine, title, sharePhoto, linkTitle, onStatus, onSaved }: {
  mine: FilmShelfEntry; title: string; sharePhoto?: (photoId: string) => ShareLink; linkTitle: string
  onStatus: (s: string) => void; onSaved: () => void
}) {
  const [status, setStatus] = useState(mine.status)
  const [isPublic, setIsPublic] = useState(mine.is_public)
  const [comment, setComment] = useState(mine.comment ?? '')
  const [log, setLog] = useState(() => fromLog('film', mine.log))
  const [logDirty, setLogDirty] = useState(false)
  const update = useUpdateFilmEntry()
  const remove = useRemoveFilmEntry()
  const toast = useToast()

  function save() {
    const patch = { status, is_public: isPublic, comment, ...(logDirty && showsLog(status) ? { log: toWrite('film', log) } : {}) }
    update.mutate({ id: mine.id, patch }, {
      onSuccess: () => { toast('Saved.'); setTimeout(onSaved, 600) },
      onError: () => toast("Couldn't save. Try again.", 'err'),
    })
  }

  function removeIt() {
    remove.mutate(mine.id, {
      onSuccess: () => { toast(title + ' removed.'); onSaved() },
      onError: () => toast("Couldn't remove it. Try again.", 'err'),
    })
  }

  return (
    <>
      {showsLog(status) && (
        <>
          <div className="f-label" style={{ marginBottom: 12 }}>Your log</div>
          <DiaryLog kind="film" draft={log} touched={!!mine.log || logDirty} onChange={(d) => { setLog(d); setLogDirty(true) }} />
        </>
      )}
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
      <PhotoNotes photos={mine.images} entryId={mine.id} editable context={title} owner="film" share={sharePhoto} shareTitle={linkTitle} />
      <SaveRow title={title} onSave={save} saving={update.isPending} onRemove={removeIt} removing={remove.isPending} />
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
