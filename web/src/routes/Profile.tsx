/* Profiles. /profile is your own (folio/desktop-app.jsx profile view on
   desktop, folio/screens.jsx Profile on phones); /u/:handle is someone
   else's, the same layout read-only. */

import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { initials, useMe } from '../api/me'
import { useLogout, useMyShelf, usePublicProfile } from '../api/queries'
import { useSetProfileVisibility, useSetUsername, useUpdateShelfEntry } from '../api/shelf'
import type { Haul, ShelfCounts, ShelfEntry, ShelfOwner } from '../api/types'
import { Icon } from '../components/Icon'
import { Hauls, ShelfGrid, ShelfList } from '../components/ShelfViews'
import { useOpenAdd, useOverlay } from '../lib/overlay'
import { useToast } from '../lib/toast'
import { useIsDesktop } from '../lib/useMediaQuery'
import NotFound from './NotFound'

type Filter = 'all' | 'reading' | 'unread' | 'read'
type Mode = 'shelf' | 'hauls'

export function MyProfile() {
  const { data: me, isPending: meLoading } = useMe()
  const { data, isError } = useMyShelf(!!me)
  if (!meLoading && !me) return <Navigate to="/login?next=%2Fprofile" replace />
  if (isError) return <Message text="Couldn't load your shelf. Try again in a moment." />
  if (!data) return <Message text="Loading your shelf…" />
  return <ProfileView owner={data.owner} counts={data.counts} entries={data.entries} hauls={data.hauls} mine />
}

export function PublicProfile() {
  const { handle = '' } = useParams()
  const { data: me } = useMe()
  const { data, error } = usePublicProfile(handle)
  if (me && me.handle === handle) return <Navigate to="/profile" replace />
  if (error instanceof ApiError && error.status === 404) return <NotFound text="This shelf is private, or there's no one here by that name." />
  if (error) return <Message text="Couldn't load this shelf. Try again in a moment." />
  if (!data) return <Message text="Loading…" />
  return <ProfileView owner={data.owner} counts={data.counts} entries={data.entries} hauls={data.hauls} mine={false} />
}

function Message({ text }: { text: string }) {
  return <div className="f-label" style={{ textAlign: 'center', padding: '80px 18px' }}>{text}</div>
}

type ViewProps = { owner: ShelfOwner; counts: ShelfCounts; entries: ShelfEntry[]; hauls: Haul[]; mine: boolean }

function ProfileView({ owner, counts, entries, hauls, mine }: ViewProps) {
  const isDesktop = useIsDesktop()
  const [filter, setFilter] = useState<Filter>('all')
  const [mode, setMode] = useState<Mode>('shelf')
  const { open } = useOverlay('book')
  const update = useUpdateShelfEntry()
  const toast = useToast()
  const onAdd = useOpenAdd()

  const shown = filter === 'all' ? entries : entries.filter((e) => e.status === filter)
  const onOpen = (e: ShelfEntry) => open(e.book.id)
  const onPin = mine ? (e: ShelfEntry) => {
    const pin = !e.is_pinned
    update.mutate({ id: e.id, patch: { is_pinned: pin } }, {
      onSuccess: () => toast((pin ? 'Moved to top · ' : 'Removed from top · ') + e.book.title),
      onError: () => toast("Couldn't change that. Try again.", 'err'),
    })
  } : undefined

  const stats: [string, number][] = [['Books', counts.all], ['Reading now', counts.reading], ['Read', counts.read], ['Not read', counts.unread]]
  const hint = mode === 'hauls'
    ? 'Books you added at one time · New first'
    : mine ? (isDesktop ? 'Your notes show above the books' : 'Tap the pin to move a book to the top') : null
  const label = mine ? 'Your books' : `@${owner.handle}'s books`

  const empty = entries.length === 0 && (
    <div style={{ padding: '60px 18px', textAlign: 'center', color: 'var(--ink-faint)' }}>
      <div className="f-label" style={{ marginBottom: 8 }}>Nothing here yet</div>
      {mine
        ? <><div style={{ fontSize: 14, marginBottom: 18 }}>Scan a barcode to add your first book.</div>
            <button className="f-btn f-btn--amber" onClick={onAdd}><Icon name="scan" size={18} sw={1.8} /> Scan a book</button></>
        : <div style={{ fontSize: 14 }}>No public books on this shelf yet.</div>}
    </div>
  )
  const filteredEmpty = entries.length > 0 && shown.length === 0 && (
    <div style={{ padding: '50px 0', textAlign: 'center', color: 'var(--ink-faint)' }}>
      <div className="f-label" style={{ marginBottom: 6 }}>Nothing here yet</div>
      <div style={{ fontSize: 14 }}>No {filter === 'unread' ? 'unread' : filter} books on this shelf.</div>
    </div>
  )

  if (isDesktop) {
    return (
      <div className="f-rise">
        <DesktopHeader owner={owner} mine={mine} />
        <div className="d-pf-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'var(--hair)', border: '1px solid var(--hair)', borderRadius: 12, overflow: 'hidden', marginBottom: 36 }}>
          {stats.map(([k, v]) => (
            <div key={k} className="d-pf-stat" style={{ background: 'var(--paper)', padding: '18px 20px' }}>
              <div className="d-bignum" style={{ fontSize: 46 }}>{v}</div>
              <div className="f-label" style={{ marginTop: 8 }}>{k}</div>
            </div>
          ))}
        </div>
        {empty || (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 16, flexWrap: 'wrap' }}>
              <div className="f-label">{label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {hint && <div className="f-label" style={{ color: 'var(--ink-faint)' }}>{hint}</div>}
                <ModeToggle mode={mode} setMode={setMode} />
              </div>
            </div>
            {mode === 'shelf' ? (
              <>
                <div className="d-filters" style={{ marginTop: 14 }}>
                  {(['all', 'reading', 'unread', 'read'] as Filter[]).map((f) => (
                    <button key={f} className={'d-chip' + (filter === f ? ' on' : '')} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                      {f}<span>{counts[f]}</span>
                    </button>
                  ))}
                </div>
                {filteredEmpty || <ShelfGrid entries={shown} onOpen={onOpen} onPin={onPin} />}
              </>
            ) : <Hauls hauls={hauls} entries={entries} onOpen={onOpen} />}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="f-rise">
      <MobileHeader owner={owner} mine={mine} stats={stats} />
      {empty || (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px 10px', gap: 12 }}>
            <div className="f-label">{label}</div>
            <ModeToggle mode={mode} setMode={setMode} />
          </div>
          {mode === 'shelf' ? (
            <>
              <FilterRow active={filter} setActive={setFilter} counts={counts} />
              <div className="hero-rule" style={{ margin: '14px 18px 0' }} />
              <div style={{ padding: '0 18px 30px' }}>
                {filteredEmpty || <ShelfList entries={shown} onOpen={onOpen} onPin={onPin} />}
              </div>
            </>
          ) : (
            <div style={{ padding: '0 0 0 18px' }}>
              {hint && <div className="f-label" style={{ color: 'var(--ink-faint)', marginTop: 4 }}>{hint}</div>}
              <Hauls hauls={hauls} entries={entries} onOpen={onOpen} coverW={96} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="d-viewseg" role="group" aria-label="View">
      <button className={mode === 'shelf' ? 'on' : ''} aria-pressed={mode === 'shelf'} onClick={() => setMode('shelf')}>Shelf</button>
      <button className={mode === 'hauls' ? 'on' : ''} aria-pressed={mode === 'hauls'} onClick={() => setMode('hauls')}>Hauls</button>
    </div>
  )
}

/** The mobile design's filter chips (folio/screens.jsx FilterRow). */
function FilterRow({ active, setActive, counts }: { active: Filter; setActive: (f: Filter) => void; counts: ShelfCounts }) {
  const labels: [Filter, string][] = [['all', 'All'], ['reading', 'Reading'], ['unread', 'Unread'], ['read', 'Read']]
  return (
    <div style={{ display: 'flex', gap: 7, overflowX: 'auto', padding: '0 18px 4px', scrollbarWidth: 'none' }}>
      {labels.map(([id, label]) => {
        const on = active === id
        return (
          <button key={id} onClick={() => setActive(id)} aria-pressed={on} style={{
            flexShrink: 0, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
            textTransform: 'uppercase', padding: '7px 12px', borderRadius: 7,
            background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--paper)' : 'var(--ink-soft)',
            boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--hair-strong)', transition: 'all 120ms var(--ease-out)',
          }}>
            {label}<span style={{ opacity: 0.55, marginLeft: 6 }}>{counts[id]}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Headers ───────────────────────────────────────────────────────────────

const displayName = (o: ShelfOwner) => [o.firstname, o.lastname].filter((s) => s.trim()).join(' ') || '@' + o.handle
const profileUrl = (handle: string) => `${window.location.origin}/u/${handle}`
const shortUrl = (handle: string) => `${window.location.host}/u/${handle}`

function DesktopHeader({ owner, mine }: { owner: ShelfOwner; mine: boolean }) {
  const [share, setShare] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 28, flexWrap: 'wrap' }}>
      <div className="d-pf-av" style={{ width: 96, height: 96, borderRadius: 12, background: 'var(--ink-blue)', color: 'var(--paper)', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 38, letterSpacing: '-0.03em', flexShrink: 0 }}>{initials(owner)}</div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em', margin: 0 }}>{displayName(owner)}</h1>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-faint)', marginTop: 4 }}>
          {mine ? <HandleEditor handle={owner.handle} /> : <>@{owner.handle}</>} · {shortUrl(owner.handle)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {mine && <VisibilityToggle isPublic={owner.is_profile_public} size="desktop" />}
        <div className="d-share-wrap">
          <button className="f-btn f-btn--ghost" onClick={() => setShare((s) => !s)} aria-expanded={share}><Icon name="share" size={16} /> Share</button>
          {share && <SharePopover owner={owner} mine={mine} onClose={() => setShare(false)} />}
        </div>
        {mine && <SignOutButton />}
      </div>
    </div>
  )
}

function MobileHeader({ owner, mine, stats }: { owner: ShelfOwner; mine: boolean; stats: [string, number][] }) {
  const toast = useToast()
  const [share, setShare] = useState(false)
  async function onShare() {
    // Phones get the system share sheet; the popover is the fallback.
    if (navigator.share && (owner.is_profile_public || !mine)) {
      try { await navigator.share({ title: `${displayName(owner)} on Dora`, url: profileUrl(owner.handle) }) } catch { /* dismissed */ }
    } else setShare(true)
  }
  return (
    <div style={{ padding: '6px 18px 20px' }}>
      {share && (
        <>
          <div className="f-scrim" style={{ background: 'rgba(20,18,16,0.28)' }} onClick={() => setShare(false)} />
          <div className="f-share-pop m-share-pop">
            <ShareBody owner={owner} mine={mine} onDone={() => { setShare(false) }} toast={toast} />
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div className="d-pf-av" style={{ width: 76, height: 76, borderRadius: 10, background: 'var(--ink-blue)', color: 'var(--paper)', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 30, letterSpacing: '-0.03em', flexShrink: 0 }}>{initials(owner)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', margin: 0, overflowWrap: 'anywhere' }}>{displayName(owner)}</h1>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-faint)', marginTop: 3 }}>
            {mine ? <HandleEditor handle={owner.handle} /> : <>@{owner.handle}</>}
          </div>
        </div>
        <button className="f-iconbtn" aria-label="Share profile" onClick={onShare}><Icon name="share" size={20} sw={1.7} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'var(--hair)', border: '1px solid var(--hair)', borderRadius: 10, overflow: 'hidden', marginTop: 20 }}>
        {stats.map(([k, v]) => (
          <div key={k} className="d-pf-stat" style={{ background: 'var(--paper)', padding: '14px 10px' }}>
            <div className="d-bignum" style={{ fontSize: 32 }}>{v}</div>
            <div className="f-label" style={{ marginTop: 5, fontSize: 8.5, letterSpacing: '0.12em' }}>{k}</div>
          </div>
        ))}
      </div>

      {mine && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>Shelf visibility</div>
              <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 1 }}>
                {owner.is_profile_public ? 'Anyone with the link can see your public books' : 'Only you can see your shelf'}
              </div>
            </div>
            <VisibilityToggle isPublic={owner.is_profile_public} size="mobile" />
          </div>
          <SignOutButton block />
        </>
      )}
    </div>
  )
}

function VisibilityToggle({ isPublic, size }: { isPublic: boolean; size: 'desktop' | 'mobile' }) {
  const set = useSetProfileVisibility()
  const toast = useToast()
  const pad = size === 'desktop' ? '8px 13px' : '7px 11px'
  return (
    <div role="group" aria-label="Shelf visibility" style={{ display: 'flex', background: 'var(--paper-2)', borderRadius: 8, padding: 3, gap: 2, flexShrink: 0 }}>
      {([['public', true], ['only me', false]] as const).map(([label, v]) => {
        const on = isPublic === v
        return (
          <button key={label} aria-pressed={on} onClick={() => !on && set.mutate(v, {
            onSuccess: () => toast(v ? 'Your shelf is public.' : 'Your shelf is private.'),
            onError: () => toast("Couldn't change that. Try again.", 'err'),
          })} style={{
            border: 'none', cursor: 'pointer', borderRadius: 6, padding: pad, fontFamily: 'var(--font-mono)',
            fontSize: size === 'desktop' ? 10.5 : 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--paper)' : 'var(--ink-soft)',
            transition: 'all 120ms var(--ease-out)',
          }}>{label}</button>
        )
      })}
    </div>
  )
}

function SignOutButton({ block }: { block?: boolean }) {
  const logout = useLogout()
  const toast = useToast()
  const navigate = useNavigate()
  return (
    <button className={'f-btn f-btn--ghost' + (block ? ' f-btn--block' : '')} style={block ? { marginTop: 18 } : undefined}
      disabled={logout.isPending}
      onClick={() => logout.mutate(undefined, {
        onSuccess: () => { toast('Signed out.'); navigate('/', { replace: true }) },
        onError: () => toast("Couldn't sign out. Try again.", 'err'),
      })}>
      <Icon name="logout" size={17} /> Sign out
    </button>
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

function SharePopover({ owner, mine, onClose }: { owner: ShelfOwner; mine: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const toast = useToast()
  useEffect(() => {
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key) }
  }, [onClose])
  return <div className="d-share-pop" ref={ref}><ShareBody owner={owner} mine={mine} onDone={onClose} toast={toast} channels /></div>
}

function ShareBody({ owner, mine, onDone, toast, channels }: {
  owner: ShelfOwner; mine: boolean; onDone: () => void; toast: ReturnType<typeof useToast>; channels?: boolean
}) {
  const url = profileUrl(owner.handle)
  const isPrivate = mine && !owner.is_profile_public
  async function copy() {
    try { await navigator.clipboard.writeText(url); toast('Link copied.') } catch { toast("Couldn't copy. Select the link instead.", 'err') }
    onDone()
  }
  return (
    <>
      <div className="f-label">{mine ? 'Share your shelf' : 'Share this shelf'}</div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginTop: 8, lineHeight: 1.5 }}>
        {isPrivate ? 'Your shelf is private right now. Make it public so people with the link can see it.' : 'People with this link can see the public books.'}
      </div>
      <div className="row">
        <div className="d-share-link">{shortUrl(owner.handle)}</div>
        <button className="f-btn f-btn--ink" onClick={copy} style={{ padding: '0 16px', height: 40 }}><Icon name="copy" size={15} /> Copy</button>
      </div>
      {channels && (
        <div className="d-share-channels">
          <a title="Share by email" aria-label="Share by email" className="m-share-channel" onClick={onDone}
            href={`mailto:?subject=${encodeURIComponent(`${displayName(owner)}'s shelf on Dora`)}&body=${encodeURIComponent(url)}`}><Icon name="send" size={16} /></a>
          <button title="Copy link" aria-label="Copy link" onClick={copy}><Icon name="link" size={16} /></button>
          <button title="More" aria-label="More ways to share" onClick={async () => {
            if (navigator.share) { try { await navigator.share({ url }) } catch { /* dismissed */ } onDone() } else copy()
          }}><Icon name="more" size={16} /></button>
        </div>
      )}
    </>
  )
}
