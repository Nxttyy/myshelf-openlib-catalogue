/* Ask Dora: buy (or watch) or skip? Fires a taste run for the signed-in
   user's shelves and shows the verdict, a short summary against their
   library and the two scores (folio/taste.jsx TasteBlock, AskBtn). */

import type { AskCandidate } from '../../api/add'
import { askFilms, useFilmTaste } from '../../lib/filmTaste'
import { Logo } from '../Logo'
import { useAskDora } from './useAskDora'

export type TasteVerdict = {
  kind: 'buy' | 'hold' | 'skip'; verdict: string
  familiarity_to_taste: number; adventure_in_the_right_direction: number
  /** films send summary, the book workflow calls it reason */
  summary?: string | null; reason?: string | null
}

function Dots({ n }: { n: number }) {
  return <span className="t-dots" aria-label={`${n} out of 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</span>
}

/** Text with **titles** in bold, as Dora writes them. */
function Rich({ s }: { s: string }) {
  return <>{s.split('**').map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}</>
}

export function Taste({ v }: { v: TasteVerdict }) {
  const summary = v.summary ?? v.reason
  return (
    <div className="t-taste f-rise">
      <div className={'t-verdict ' + v.kind}><span className="vdot" />{v.verdict}</div>
      {summary && <p className="t-sum"><Rich s={summary} /></p>}
      <div className="t-srow"><span>Familiarity to taste</span><Dots n={v.familiarity_to_taste} /></div>
      <div className="t-srow"><span>Adventure, right direction</span><Dots n={v.adventure_in_the_right_direction} /></div>
    </div>
  )
}

/** "Ask Dora". Wide: full width with the question spelled out. */
export function AskBtn({ onClick, wide, q = 'watch or skip?', disabled }: { onClick: () => void; wide?: boolean; q?: string; disabled?: boolean }) {
  return (
    <button className={'t-ask' + (wide ? ' wide' : '')} title={'Ask Dora: ' + q} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick() }}>
      {/* one span, so the button's flex gap can't split "Dora" from the colon */}
      <span>Ask <Logo size={9} />{wide && ': ' + q}</span>
    </button>
  )
}

/** The full-width button under a queue chip (folio/desktop.jsx QueueChip). */
export function AskDoraBlock({ candidate }: { candidate: AskCandidate }) {
  const { state, ask } = useAskDora(candidate)
  if (state.s === 'done') return <Taste v={state.v} />
  if (state.s === 'asking') return <div className="d-askdora" style={{ cursor: 'default' }}><span><Logo size={9} /> is reading your shelves…</span></div>
  return (
    <button className="d-askdora" onClick={(e) => { e.stopPropagation(); ask() }}>
      {state.s === 'error' ? state.msg : <span>Ask <Logo size={9} />: buy or skip?</span>}
    </button>
  )
}

/** Ask Dora about one film: the wide button that turns into the answer
    (queue chips, records). Result rows split it: part="button" is the small
    button in the row's top line, part="answer" is what shows below it once
    asked, from that button or from "ask all". */
export function FilmAsk({ imdbId, part }: { imdbId: string; part?: 'button' | 'answer' }) {
  const state = useFilmTaste(imdbId)
  const ask = () => askFilms([imdbId])
  if (part === 'button') {
    if (state?.s === 'error') return <button className="t-ask" title={state.msg} onClick={(e) => { e.stopPropagation(); ask() }}>Ask again</button>
    return state ? null : <AskBtn onClick={ask} />
  }
  if (state?.s === 'done') return <Taste v={state.v} />
  if (state?.s === 'asking') {
    return <div className="t-ask wide" style={{ cursor: 'default' }}><span><Logo size={9} /> is reading your shelves…</span></div>
  }
  if (state?.s === 'error') {
    return part ? <p className="t-sum" role="alert">{state.msg}</p>
      : <button className="t-ask wide" onClick={(e) => { e.stopPropagation(); ask() }}>{state.msg}</button>
  }
  return part ? null : <AskBtn wide onClick={ask} />
}
