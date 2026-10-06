/* Ask Dora: buy or skip? Fires a taste run for the signed-in user's shelves
   and shows the verdict with its two scores, as in folio/desktop.jsx. */

import type { AskCandidate, Verdict } from '../../api/add'
import { Icon } from '../Icon'
import { useAskDora } from './useAskDora'

function Dots({ n }: { n: number }) {
  return <span className="d-dots" aria-label={`${n} of 5`}>{[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= n ? 'on' : ''} />)}</span>
}

export function Taste({ v }: { v: Verdict }) {
  return (
    <div className="taste f-rise">
      <div className={'verdict ' + v.kind}><span className="vdot" />{v.verdict}</div>
      <div className="srow"><span>Familiarity to taste</span><Dots n={v.familiarity_to_taste} /></div>
      <div className="srow"><span>Adventure, right direction</span><Dots n={v.adventure_in_the_right_direction} /></div>
      {v.reason && <div className="m-taste-reason">{v.reason}</div>}
    </div>
  )
}

/** The full-width button under a queue chip (folio/desktop.jsx QueueChip). */
export function AskDoraBlock({ candidate }: { candidate: AskCandidate }) {
  const { state, ask } = useAskDora(candidate)
  if (state.s === 'done') return <Taste v={state.v} />
  if (state.s === 'asking') return <div className="d-askdora" style={{ cursor: 'default' }}><Icon name="dora" size={15} sw={1.6} /> Dora is reading your shelves…</div>
  return (
    <button className="d-askdora" onClick={(e) => { e.stopPropagation(); ask() }}>
      <Icon name="dora" size={15} sw={1.6} /> {state.s === 'error' ? state.msg : 'Ask Dora: buy or skip?'}
    </button>
  )
}
