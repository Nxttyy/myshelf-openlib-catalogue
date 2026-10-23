/* The diary log's criteria, places and wording per kind, date helpers, and
   conversion between the API's log and the editor's state. The editor
   itself is components/DiaryLog.tsx. */

import type { EntryLog, EntryLogWrite } from '../api/types'

export type LogKind = 'book' | 'film'
export type Prec = 'day' | 'month' | 'year'
export type Ymd = { y: number; m: number; d: number }
export type DateVal = Ymd & { prec: Prec }

/** The editor's state; `toWrite` turns it into what the API saves. */
export type LogDraft = { scores: number[]; date: DateVal | null; place: string | null; who: string[]; times: number }

type Cfg = {
  crit: [string, string][]; on: string; at: string; with: string; noun: string; first: string; again: string
  places: [string, string, string][] // [api key, icon, label]
}

export const CFG: Record<LogKind, Cfg> = {
  film: {
    crit: [['story', 'Story'], ['characters', 'Characters'], ['acting', 'Acting'], ['visuals', 'Visuals'], ['music', 'Music'], ['pacing', 'Pacing']],
    on: 'Watched on', at: 'Watched at', with: 'Watched with', noun: 'watch', first: 'First watch', again: 'Rewatch',
    places: [['theater', 'ticket', 'Theater'], ['home', 'home', 'Home'], ['on_the_go', 'plane', 'On the go'], ['friends_place', 'users', "Friend's place"]],
  },
  book: {
    crit: [['plot', 'Plot'], ['characters', 'Characters'], ['writing', 'Writing'], ['world', 'World'], ['pacing', 'Pacing'], ['ending', 'Ending']],
    on: 'Finished on', at: 'Read at', with: 'Read with', noun: 'read', first: 'First read', again: 'Reread',
    places: [['home', 'home', 'Home'], ['cafe', 'coffee', 'Café'], ['commute', 'train', 'Commute'], ['other', 'more', 'Others']],
  },
}

/** Show the log once you've started (or finished) the book or film. */
export const showsLog = (status: string | undefined) => status === 'reading' || status === 'read'

export const cl = (v: number) => Math.max(1, Math.min(10, v))
export const WORD = (x: number) => {
  const v = Math.round(x)
  return v <= 2 ? 'Not for me' : v <= 4 ? 'Meh' : v <= 6 ? 'Liked it' : v <= 8 ? 'Really liked it' : v === 9 ? 'Loved it' : 'All-time'
}
export const average = (vals: number[]) => Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10
export const ord = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0] }

// ── Dates ──────────────────────────────────────────────────────────────────

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function today(): Ymd { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() } }
export function yesterday(): Ymd { const t = new Date(); t.setDate(t.getDate() - 1); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() } }
export const dim = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
export const same = (a: Ymd, b: Ymd) => a.y === b.y && a.m === b.m && a.d === b.d
export function fmt(v: DateVal) {
  if (v.prec === 'year') return String(v.y)
  if (v.prec === 'month') return MON[v.m] + ' ' + v.y
  if (same(v, today())) return 'Today'
  if (same(v, yesterday())) return 'Yesterday'
  return new Date(v.y, v.m, v.d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

// ── API shape ↔ editor state ────────────────────────────────────────────────

export function fromLog(kind: LogKind, log: EntryLog | null | undefined): LogDraft {
  if (!log) return { scores: CFG[kind].crit.map(() => 5), date: null, place: null, who: [], times: 1 }
  let date: DateVal | null = null
  if (log.finished_on) {
    const [y, m, d] = log.finished_on.split('-').map(Number)
    date = { y, m: m - 1, d, prec: (log.finished_on_precision as Prec | null) ?? 'day' }
  }
  return {
    scores: CFG[kind].crit.map(([k]) => log.scores[k] ?? 5),
    date, place: log.place ?? null, who: (log.companions ?? []).map((c) => c.id), times: log.times ?? 1,
  }
}

export function toWrite(kind: LogKind, d: LogDraft): EntryLogWrite {
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    scores: Object.fromEntries(CFG[kind].crit.map(([k], i) => [k, d.scores[i]])),
    finished_on: d.date ? `${d.date.y}-${pad(d.date.m + 1)}-${pad(d.date.d)}` : null,
    finished_on_precision: d.date?.prec ?? null,
    place: d.place, times: d.times, companion_ids: d.who,
  }
}

