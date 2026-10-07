/* The Dora logo: a stacked DORA, ported from the design's folio/components.jsx.
   Each letter is a thick navy outline with a paper-coloured core, drawn three
   times with an offset for the stacked look; the front layer gets a thin
   orange line through it. Below size 14 (inline in buttons) it's the word
   "Dora" in bold instead, as in the design.
   Colours can be overridden with --logo-ink, --logo-bg and --logo-acc. */

const GLYPHS: [string, number][] = [
  ['M0 0H40A50 50 0 0 1 40 100H0Z', 0], // D
  ['M90 50A45 50 0 1 1 0 50A45 50 0 1 1 90 50Z', 136], // O
  ['M0 100V0H45A25 25 0 0 1 45 50H0M40 50L75 100', 272], // R
  ['M0 100L37.5 0L75 100M17 58H58', 393], // A
]

const INK = 'var(--logo-ink, var(--ink-blue))'
const BG = 'var(--logo-bg, var(--paper))'
const ACC = 'var(--logo-acc, #F2842F)'

export function Logo({ size = 19 }: { size?: number }) {
  if (size < 14) return <span className="f-wordmark-text">Dora</span>
  return (
    <svg className="f-logo" viewBox="-10 -10 508 140" height={size * 1.5}
      style={{ display: 'block', overflow: 'visible' }} role="img" aria-label="Dora">
      {[20, 10, 0].map((o, k) => GLYPHS.map(([d, x], j) => (
        <g key={k + '-' + j} transform={`translate(${x + 20 - o} ${20 - o})`} fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path d={d} stroke={INK} strokeWidth="16" />
          <path d={d} stroke={BG} strokeWidth="10" />
          {o === 0 && <path d={d} stroke={ACC} strokeWidth="2.6" />}
        </g>
      )))}
    </svg>
  )
}
