/* Ask Dora: get it (or watch it) or skip it? Fires a taste run for the
   signed-in user's shelves and shows the verdict, a short summary against
   their library, the two scores (folio/taste.jsx TasteBlock, AskBtn) and,
   when Dora is fairly sure, the rating it expects them to give. */

import type { AskCandidate } from '../../api/add'
import { askFilms, useFilmTaste } from '../../lib/filmTaste'
import { Logo } from '../Logo'
import { useAskDora } from './useAskDora'

export type TasteVerdict = {
  kind: 'get' | 'watch' | 'skip' | 'unsure' | 'none'; verdict: string; summary?: string | null
  predicted_enjoyment?: number | null; confidence?: 'low' | 'medium' | 'high' | null
  familiarity_to_taste: number; adventure_in_the_right_direction: number
}

// The design's dot colours: green for go (its "buy"), red for skip, and the
// default amber when Dora couldn't judge (not enough to go on, empty shelf).
const DOT: Record<TasteVerdict['kind'], string> = { get: 'buy', watch: 'buy', skip: 'skip', unsure: '', none: '' }

function Dots({ n }: { n: number }) {
  return <span className="t-dots" aria-label={`${n} out of 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</span>
}

/** Text with **titles** in bold, as Dora writes them. */
function Rich({ s }: { s: string }) {
  return <>{s.split('**').map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}</>
}

export function Taste({ v }: { v: TasteVerdict }) {
  const judged = v.kind !== 'unsure' && v.kind !== 'none'
  const sure = judged && v.predicted_enjoyment != null && v.confidence !== 'low'
  return (
    <div className="t-taste f-rise">
      <div className={'t-verdict ' + DOT[v.kind]}><span className="vdot" />{v.verdict}</div>
      {v.summary && <p className="t-sum"><Rich s={v.summary} /></p>}
      {sure && <div className="t-srow"><span>You'd likely rate it</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{v.predicted_enjoyment!.toFixed(1)}<span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>/10</span></b></div>}
      {judged && <>
        <div className="t-srow"><span>Familiarity to taste</span><Dots n={v.familiarity_to_taste} /></div>
        <div className="t-srow"><span>Adventure, right direction</span><Dots n={v.adventure_in_the_right_direction} /></div>
      </>}
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
      {state.s === 'error' ? state.msg : <span>Ask <Logo size={9} />: get it or skip it?</span>}
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
