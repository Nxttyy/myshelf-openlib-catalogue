/* Dev-only page (/dev/kit) that shows every phase-1 building block, for
   checking them against the design side by side. Not built into production. */

import { Taste, type TasteVerdict } from '../components/add/AskDora'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { StatusBadge, SubjectPill } from '../components/StatusBadge'
import { useToast } from '../lib/toast'
import { PALETTES, type CoverData, type PaletteName } from '../lib/covers'

// Ask Dora answers: a sure yes, an unsure skip, and no shelf yet.
const VERDICTS: TasteVerdict[] = [
  { kind: 'watch', verdict: 'Watch it, made for you', summary: 'Close to **Paterson** and **Perfect Days**, the quiet side of your shelf. New for you: Japanese cinema of the 1950s.', predicted_enjoyment: 8.4, confidence: 'high', familiarity_to_taste: 4, adventure_in_the_right_direction: 3 },
  { kind: 'skip', verdict: 'Skip it, you own better', summary: 'You rated **Dune** 5.0 and stopped the sequel halfway.', predicted_enjoyment: 4.6, confidence: 'low', familiarity_to_taste: 3, adventure_in_the_right_direction: 1 },
  { kind: 'unsure', verdict: 'Not enough to go on', summary: 'You have books on your shelf but none rated or finished yet. Rate a few and ask again.', familiarity_to_taste: 3, adventure_in_the_right_direction: 3 },
  { kind: 'none', verdict: 'Add a few books first', summary: 'Your book shelf is empty, so there is nothing to compare yet.', familiarity_to_taste: 1, adventure_in_the_right_direction: 3 },
]

// Sample jackets matching the design's data.js books, one per layout.
const SAMPLES: CoverData[] = [
  { key: 'b1', title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', year: '1969', pages: 304, catalog: '78125', palette: 'blue', layout: 0, imageUrl: null },
  { key: 'b2', title: 'Invisible Cities', author: 'Italo Calvino', year: '1972', pages: 165, catalog: '53806', palette: 'paper', layout: 1, imageUrl: null },
  { key: 'b3', title: 'Grid Systems in Graphic Design', author: 'Josef Müller-Brockmann', year: '1981', pages: 176, catalog: '01451', palette: 'amber', layout: 2, imageUrl: null },
  { key: 'b5', title: 'Pale Fire', author: 'Vladimir Nabokov', year: '1962', pages: 315, catalog: '23424', palette: 'cream', layout: 3, imageUrl: null },
  { key: 'img', title: 'Dune', author: 'Frank Herbert', year: '1965', pages: 412, catalog: '00000', palette: 'clay', layout: 0, imageUrl: 'https://covers.openlibrary.org/b/id/11481354-M.jpg' },
]

export default function Kit() {
  const toast = useToast()
  return (
    <div className="f-rise">
      <div className="f-label" style={{ marginBottom: 12 }}>Dev · component kit</div>
      <h1 style={{ fontWeight: 600, fontSize: 44, letterSpacing: '-0.04em', margin: '0 0 24px' }}>Phase 1 kit</h1>

      <div className="f-label" style={{ marginBottom: 14 }}>Covers · 168px · hover to tilt</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        {SAMPLES.map((b) => <Cover key={b.key} b={b} w={168} />)}
      </div>

      <div className="f-label" style={{ margin: '36px 0 14px' }}>All 12 palettes · 64px, no tilt</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {(Object.keys(PALETTES) as PaletteName[]).map((p, i) => (
          <Cover key={p} b={{ ...SAMPLES[i % 4], key: p, palette: p }} w={64} tilt={false} />
        ))}
      </div>

      <div className="f-label" style={{ margin: '36px 0 14px' }}>Status · pills · buttons</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
        <StatusBadge status="unread" /><StatusBadge status="reading" /><StatusBadge status="read" />
        <SubjectPill>Science Fiction</SubjectPill><SubjectPill>Politics</SubjectPill>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 18 }}>
        <button className="f-btn f-btn--amber" onClick={() => toast('Saved 3 books to your library')}><Icon name="scan" size={18} sw={1.8} /> Toast ok</button>
        <button className="f-btn f-btn--ink" onClick={() => toast("That ISBN doesn't look right", 'err')}>Toast error</button>
        <button className="f-btn f-btn--ghost"><Icon name="share" size={16} /> Ghost</button>
      </div>

      <div className="f-label" style={{ margin: '36px 0 14px' }}>Ask Dora answers</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
        {VERDICTS.map((v) => <div key={v.kind} className="f-queue-chip"><Taste v={v} /></div>)}
      </div>

      <div className="f-label" style={{ margin: '36px 0 14px' }}>Display numerals (Bagel Fat One)</div>
      <div className="d-bignum" style={{ fontSize: 46 }}>128</div>
    </div>
  )
}
