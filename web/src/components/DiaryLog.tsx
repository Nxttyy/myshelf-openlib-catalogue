/* The diary log on a shelf entry, from folio/diary.jsx: an enjoyment shape
   over six criteria (drag a point, or step them all at once), when you
   finished it, where, who with, and how many times.

   Differences from the design, on purpose:
   - Nothing is pre-filled. The shape starts flat at 5 and reads "Not rated
     yet", and no date, place or person is picked until you pick one; the
     log is only saved once you've touched it.
   - "Today" is the real date, and the people are ones you add with "+".
   - LogSummary is the read-only version shown on public profiles; the
     design only has the editable one. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAddCompanion, useCompanions } from '../api/logs'
import type { Companion, EntryLog } from '../api/types'
import {
  average, CFG, cl, dim, fmt, fromLog, MON, ord, same, today, WORD, yesterday,
  type DateVal, type LogDraft, type LogKind, type Prec,
} from '../lib/diary'

// ── Icons (the design's own set for this panel) ─────────────────────────────

const P: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  ticket: <><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2M13 17v2M13 11v2" /></>,
  plane: <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  users: <><circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85" /></>,
  train: <path d="M8 3h8a4 4 0 0 1 4 4v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a4 4 0 0 1 4-4zM4 11h16M8 15h.01M16 15h.01m-8 4-2 3m10-3 2 3" />,
  coffee: <path d="M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" />,
  more: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  cal: <><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M16 2.5v4M8 2.5v4M3 10h18" /></>,
  left: <path d="m15 18-6-6 6-6" />, right: <path d="m9 18 6-6-6-6" />, down: <path d="m6 9 6 6 6-6" />,
  trash: <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  plus: <path d="M12 5v14M5 12h14" />, minus: <path d="M5 12h14" />, check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
}
const Ic = ({ n, s = 18, w = 1.6 }: { n: string; s?: number; w?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[n]}</svg>
)

// ── Date picker ─────────────────────────────────────────────────────────────

function DatePick({ v, set }: { v: DateVal | null; set: (v: DateVal) => void }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<Prec>('day')
  const [cur, setCur] = useState({ y: v?.y ?? today().y, m: v?.m ?? today().m })
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [open])

  const T = today(), Y = yesterday()
  const base: DateVal = v ?? { ...T, prec: 'day' }
  const isToday = !!v && v.prec === 'day' && same(v, T)
  const isYest = !!v && v.prec === 'day' && same(v, Y)
  const show = () => { setCur({ y: base.y, m: base.m }); setView(base.prec); setOpen((o) => !o) }
  const prec = (p: Prec) => { set({ ...base, prec: p }); setView(p) }
  const nav = (d: number) => setCur((c) => view === 'day'
    ? (() => { const t = c.m + d; return { y: c.y + Math.floor(t / 12), m: (t + 12) % 12 } })()
    : { ...c, y: c.y + d * (view === 'year' ? 12 : 1) })
  const first = (new Date(cur.y, cur.m, 1).getDay() + 6) % 7, n = dim(cur.y, cur.m), y0 = cur.y - (cur.y % 12)
  const future = (y: number, m: number, d: number) => y > T.y || (y === T.y && (m > T.m || (m === T.m && d > T.d)))

  return (
    <div className="dl-dp" ref={ref}>
      <div className="dl-quick">
        <button className={'dl-q' + (isToday ? ' on' : '')} onClick={() => { set({ ...T, prec: 'day' }); setOpen(false) }}>Today</button>
        <button className={'dl-q' + (isYest ? ' on' : '')} onClick={() => { set({ ...Y, prec: 'day' }); setOpen(false) }}>Yesterday</button>
        <button className={'dl-q pick' + (open || (v && !isToday && !isYest) ? ' on' : '')} onClick={show} aria-expanded={open}>
          <Ic n="cal" s={15} /><span>{v && !isToday && !isYest ? fmt(v) : 'Pick a date'}</span><Ic n="down" s={14} />
        </button>
      </div>
      {open && (
        <div className="dl-pop">
          <div className="dl-ph">
            <button onClick={() => nav(-1)} aria-label="Earlier"><Ic n="left" s={16} /></button>
            <button className="ttl" onClick={() => setView(view === 'day' ? 'month' : 'year')}>
              {view === 'day' ? MON[cur.m] + ' ' + cur.y : view === 'month' ? cur.y : y0 + '–' + (y0 + 11)}
            </button>
            <button onClick={() => nav(1)} aria-label="Later"
              disabled={view === 'day' ? cur.y === T.y && cur.m === T.m : view === 'month' ? cur.y >= T.y : y0 + 11 >= T.y}><Ic n="right" s={16} /></button>
          </div>
          {view === 'day' && (
            <div className="dl-cal">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="wd">{d}</span>)}
              {Array.from({ length: first }, (_, i) => <span key={'e' + i} />)}
              {Array.from({ length: n }, (_, i) => {
                const d = i + 1, on = !!v && v.prec === 'day' && same(v, { ...cur, d })
                return <button key={d} disabled={future(cur.y, cur.m, d)} className={(on ? 'on' : '') + (same(T, { ...cur, d }) ? ' now' : '')}
                  onClick={() => { set({ ...cur, d, prec: 'day' }); setOpen(false) }}>{d}</button>
              })}
            </div>
          )}
          {view === 'month' && (
            <div className="dl-grid">
              {MON.map((m, i) => (
                <button key={m} disabled={future(cur.y, i, 1)} className={v && v.y === cur.y && v.m === i && v.prec !== 'year' ? 'on' : ''}
                  onClick={() => { if (base.prec === 'month') { set({ y: cur.y, m: i, d: 1, prec: 'month' }); setOpen(false) } else { setCur({ y: cur.y, m: i }); setView('day') } }}>{m}</button>
              ))}
            </div>
          )}
          {view === 'year' && (
            <div className="dl-grid">
              {Array.from({ length: 12 }, (_, i) => y0 + i).map((y) => (
                <button key={y} disabled={y > T.y} className={v && v.y === y ? 'on' : ''}
                  onClick={() => { if (base.prec === 'year') { set({ y, m: 0, d: 1, prec: 'year' }); setOpen(false) } else { setCur({ y, m: Math.min(cur.m, y === T.y ? T.m : 11) }); setView('month') } }}>{y}</button>
              ))}
            </div>
          )}
          <div className="dl-prec">
            <span className="f-label">I remember</span>
            <div>{([['day', 'The day'], ['month', 'The month'], ['year', 'The year']] as [Prec, string][]).map(([k, l]) => (
              <button key={k} className={base.prec === k ? 'on' : ''} onClick={() => prec(k)}>{l}</button>
            ))}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── The shape ──────────────────────────────────────────────────────────────

function Poly({ crit, vals, avg, setVal }: { crit: string[]; vals: number[]; avg: number; setVal?: (i: number, v: number) => void }) {
  const W = 340, C = 170, R = 112, n = crit.length
  const ax = useRef(0), ref = useRef<SVGSVGElement>(null)
  const ang = (i: number) => (-90 + i * 360 / n) * Math.PI / 180
  const pt = (i: number, v: number) => [C + Math.cos(ang(i)) * R * v / 10, C + Math.sin(ang(i)) * R * v / 10]
  const poly = (vs: number[]) => vs.map((v, i) => pt(i, v).join(',')).join(' ')
  const on = (e: React.PointerEvent, start: boolean) => {
    if (!setVal || !ref.current) return
    const r = ref.current.getBoundingClientRect(), dx = (e.clientX - r.left) * W / r.width - C, dy = (e.clientY - r.top) * W / r.height - C
    if (start) {
      // the axis nearest the pointer is the one being dragged
      const a = Math.atan2(dy, dx)
      let best = 0, bd = 9
      for (let i = 0; i < n; i++) { const df = Math.abs(Math.atan2(Math.sin(a - ang(i)), Math.cos(a - ang(i)))); if (df < bd) { bd = df; best = i } }
      ax.current = best
    }
    const i = ax.current
    setVal(i, cl(Math.round((dx * Math.cos(ang(i)) + dy * Math.sin(ang(i))) / R * 10)))
  }
  return (
    <svg ref={ref} className="dl-poly" viewBox={`0 0 ${W} ${W}`} role="img" aria-label={crit.map((c, i) => `${c} ${vals[i]}`).join(', ')}
      style={setVal ? undefined : { cursor: 'default', touchAction: 'auto' }}
      onPointerDown={setVal && ((e) => { e.currentTarget.setPointerCapture(e.pointerId); on(e, true) })}
      onPointerMove={setVal && ((e) => { if (e.buttons) on(e, false) })}>
      {[2, 4, 6, 8, 10].map((k) => <polygon key={k} points={poly(crit.map(() => k))} fill="none" stroke="var(--hair-strong)" strokeWidth={k === 10 ? 1.5 : 1} strokeDasharray={k === 10 ? '' : '2 4'} />)}
      {crit.map((c, i) => { const [x, y] = pt(i, 10); return <line key={c} x1={C} y1={C} x2={x} y2={y} stroke="var(--hair)" /> })}
      <polygon points={poly(vals)} fill="var(--dl-shadow)" transform="translate(4 4)" className="dl-anim" />
      <polygon points={poly(vals)} fill="var(--amber)" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" className="dl-anim" />
      <g style={{ pointerEvents: 'none' }}>
        <rect x={C - 30} y={C - 20} width="60" height="40" rx="8" fill="var(--ink)" />
        <text x={C} y={C + 2} textAnchor="middle" dominantBaseline="middle" className="dl-ctr">{avg.toFixed(1)}</text>
      </g>
      {vals.map((v, i) => { const [x, y] = pt(i, v); return <circle key={i} cx={x} cy={y} r="7" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2" /> })}
      {crit.map((c, i) => {
        const [x, y] = pt(i, 12.6)
        return (
          <g key={c}>
            <text x={x} y={y - 5} className="dl-axl" textAnchor="middle" dominantBaseline="middle">{c.toUpperCase()}</text>
            <text x={x} y={y + 10} className="dl-axv" textAnchor="middle" dominantBaseline="middle">{vals[i]}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── The editor ─────────────────────────────────────────────────────────────

export function DiaryLog({ kind, draft, touched, onChange }: {
  kind: LogKind; draft: LogDraft; touched: boolean; onChange: (d: LogDraft) => void
}) {
  const c = CFG[kind]
  const { data: people = [] } = useCompanions()
  const x0 = useRef<[number, number] | null>(null)
  const { scores: vals, times: n } = draft
  const avg = average(vals)
  const set = (patch: Partial<LogDraft>) => onChange({ ...draft, ...patch })
  const shift = (d: number) => set({ scores: vals.map((x) => cl(x + d)) })
  const tog = (id: string) => set({ who: draft.who.includes(id) ? draft.who.filter((x) => x !== id) : [...draft.who, id] })
  const names = draft.who.map((id) => people.find((p) => p.id === id)?.name).filter(Boolean)
  const lo = Math.min(...vals) <= 1, hi = Math.max(...vals) >= 10

  return (
    <div className="dl">
      <div className="dl-enj">
        <div><span className="f-label">Enjoyment</span><div className="w">{touched ? WORD(avg) : 'Not rated yet'}</div></div>
        <div className="dl-ev">
          <button onClick={() => shift(-1)} disabled={lo} aria-label="Less"><Ic n="minus" s={16} /></button>
          <b onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); x0.current = [e.clientX, 0] }}
            onPointerMove={(e) => {
              if (!e.buttons || !x0.current) return
              const k = Math.round((e.clientX - x0.current[0]) / 18)
              if (k !== x0.current[1]) { shift(k - x0.current[1]); x0.current[1] = k }
            }}>{avg.toFixed(1)}<small>/10</small></b>
          <button onClick={() => shift(1)} disabled={hi} aria-label="More"><Ic n="plus" s={16} /></button>
        </div>
        <div className="dl-hint">The average of the shape. Step it to grow or shrink every point.</div>
      </div>
      <Poly crit={c.crit.map(([, l]) => l)} vals={vals} avg={avg} setVal={(i, v) => set({ scores: vals.map((x, j) => (j === i ? v : x)) })} />
      <div className="dl-sec dl-row">
        <div className="dl-col">
          <div className="dl-sh"><span className="f-label">{c.on}</span><span className="dl-lk">{draft.date ? fmt(draft.date) : 'Not set'}</span></div>
          <DatePick v={draft.date} set={(date) => set({ date })} />
        </div>
        <div className="dl-col">
          <div className="dl-sh"><span className="f-label">{c.at}</span></div>
          <div className="dl-chips">
            {c.places.map(([key, ic, l]) => (
              <button key={key} className={'dl-chip' + (draft.place === key ? ' on' : '')} aria-pressed={draft.place === key}
                onClick={() => set({ place: draft.place === key ? null : key })}><Ic n={ic} />{l}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="dl-sec">
        <div className="dl-sh"><span className="f-label">{c.with}</span><span className="dl-lk">{names.length ? names.join(', ') : 'Alone'}</span></div>
        <Who people={people} who={draft.who} onAlone={() => set({ who: [] })} onToggle={tog} onAdded={(p) => set({ who: [...draft.who, p.id] })} />
      </div>
      <div className="dl-sec">
        <div className="dl-cnt">
          <div>
            <span className="f-label">{n === 1 ? c.first : c.again}</span>
            <div className="big">{n}<sup>{ord(n)}</sup><span>{c.noun}</span></div>
            <div className="dl-tally">{Array.from({ length: Math.min(n, 12) }, (_, i) => <i key={i} className={i === n - 1 ? 'hot' : ''} />)}</div>
          </div>
          <div className="dl-step">
            <button onClick={() => set({ times: Math.max(1, n - 1) })} disabled={n === 1} aria-label="One fewer"><Ic n="minus" /></button>
            <button onClick={() => set({ times: Math.min(99, n + 1) })} disabled={n >= 99} aria-label="One more"><Ic n="plus" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Alone, the people you've added, and "+" to add someone (a name only). */
function Who({ people, who, onAlone, onToggle, onAdded }: {
  people: Companion[]; who: string[]; onAlone: () => void; onToggle: (id: string) => void; onAdded: (p: Companion) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const add = useAddCompanion()
  function submit() {
    const v = name.trim()
    if (!v) return
    add.mutate(v, { onSuccess: (p) => { onAdded(p); setName(''); setAdding(false) } })
  }
  return (
    <>
      <div className="dl-who" style={{ flexWrap: 'wrap' }}>
        <button className={'dl-av alone' + (!who.length ? ' on' : '')} onClick={onAlone} title="Alone" aria-pressed={!who.length}><Ic n="user" s={20} /></button>
        {people.map((p) => (
          <button key={p.id} className={'dl-av' + (who.includes(p.id) ? ' on' : '')} style={{ background: p.color }} title={p.name}
            aria-pressed={who.includes(p.id)} onClick={() => onToggle(p.id)}>
            {p.initials}{who.includes(p.id) && <em><Ic n="check" s={11} w={2.4} /></em>}
          </button>
        ))}
        <button className="dl-av add" onClick={() => setAdding((a) => !a)} title="Add someone" aria-label="Add someone" aria-expanded={adding}><Ic n="plus" s={18} /></button>
      </div>
      {adding && (
        <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); submit() }}>
          <input className="f-input" style={{ flex: 1, minWidth: 0 }} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Their name" aria-label="Their name" maxLength={60} autoFocus />
          <button type="submit" className="f-btn f-btn--ink" style={{ padding: '0 18px' }} disabled={!name.trim() || add.isPending}>Add</button>
        </form>
      )}
      {add.isError && <div style={{ fontSize: 12.5, color: '#8E2A36' }}>Couldn't add them. Try again.</div>}
    </>
  )
}

// ── Read-only, for public profiles ─────────────────────────────────────────

export function LogSummary({ kind, log }: { kind: LogKind; log: EntryLog }) {
  const c = CFG[kind]
  const d = fromLog(kind, log)
  const avg = average(d.scores)
  const place = c.places.find(([k]) => k === d.place)
  const rows: [string, string][] = [
    ...(d.date ? [[c.on, fmt(d.date)] as [string, string]] : []),
    ...(place ? [[c.at, place[2]] as [string, string]] : []),
    [c.with, log.companions.length ? log.companions.map((p) => p.name).join(', ') : 'Alone'],
    [d.times === 1 ? c.first : c.again, `${d.times}${ord(d.times)} ${c.noun}`],
  ]
  return (
    <div className="dl">
      <div className="dl-enj">
        <div><span className="f-label">Enjoyment</span><div className="w">{WORD(avg)}</div></div>
        <div className="dl-ev"><b style={{ cursor: 'default' }}>{avg.toFixed(1)}<small>/10</small></b></div>
      </div>
      <Poly crit={c.crit.map(([, l]) => l)} vals={d.scores} avg={avg} />
      <div className="dl-sec">
        {rows.map(([k, v]) => <div key={k} className="dl-sh"><span className="f-label">{k}</span><span className="dl-lk">{v}</span></div>)}
      </div>
    </div>
  )
}

// ── Save / remove ──────────────────────────────────────────────────────────

/** The drawer's save button, with Remove from library next to it (asks first). */
export function SaveRow({ title, onSave, saving, onRemove, removing }: {
  title: string; onSave: () => void; saving: boolean; onRemove: () => void; removing: boolean
}) {
  const [ask, setAsk] = useState(false)
  if (ask) {
    return (
      <div className="dl-save ask">
        <span>Remove <b>{title}</b>? Your log and notes go too.</span>
        <button className="no" onClick={() => setAsk(false)}>Keep</button>
        <button className="yes" onClick={onRemove} disabled={removing}><Ic n="trash" s={16} />{removing ? 'Removing…' : 'Remove'}</button>
      </div>
    )
  }
  return (
    <div className="dl-save">
      <button className="f-btn f-btn--amber f-btn--block" onClick={onSave} disabled={saving}>
        <Ic n="check" s={18} w={2} /> {saving ? 'Saving…' : 'Done · save to library'}
      </button>
      <button className="dl-trash" onClick={() => setAsk(true)} title="Remove from library" aria-label="Remove from library"><Ic n="trash" s={18} /></button>
    </div>
  )
}
