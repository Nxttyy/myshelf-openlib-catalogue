/* The Dora logo, from the design's folio/components.jsx (brand themes).
   BrandMark is a "D": a book spine plus a fan of page wedges, with the middle
   page in the accent colour, nudged out and tipped as if being turned. Fewer
   pages at small sizes (9 / 5 / 3). Logo is the mark beside "DORA" in Big
   Shoulders Display; below size 14 (inline in buttons) it's the mark alone.
   The same geometry draws the launch splash (index.html) and the app icons. */

export function BrandMark({ size = 24, acc = 'var(--accent)' }: { size?: number; acc?: string }) {
  const n = size < 24 ? 3 : size < 48 ? 5 : 9
  const gap = n === 9 ? 6 : n === 5 ? 12 : 22
  const r0 = n === 9 ? 14 : n === 5 ? 12 : 10
  const stem = n === 9 ? 15 : n === 5 ? 17 : 20
  const hi = Math.floor(n / 2)
  const P = (r: number, a: number) => {
    const t = (a * Math.PI) / 180
    return (32 + r * Math.cos(t)).toFixed(2) + ' ' + (50 + r * Math.sin(t)).toFixed(2)
  }
  const da = (180 - gap * (n - 1)) / n
  let a = -90, d = '', h = ''
  const sw = n === 9 ? 1.6 : 4, lift = n === 9 ? 6 : 5, tilt = 8
  for (let i = 0; i < n; i++) {
    const w = 'M' + P(r0, a) + ' L' + P(38, a) + ' A38 38 0 0 1 ' + P(38, a + da) + ' L' + P(r0, a + da) + ' A' + r0 + ' ' + r0 + ' 0 0 0 ' + P(r0, a) + ' Z'
    if (i === hi) h = w
    else d += w
    a += da + gap
  }
  return (
    <svg width={size} height={size} viewBox="-8 -2 104 104" style={{ display: 'block', flexShrink: 0, overflow: 'visible' }} aria-hidden="true">
      <g stroke="currentColor" strokeWidth={sw} strokeLinejoin="round">
        <rect x={32 - stem + sw / 2} y={12 + sw / 2} width={stem + 0.8 - sw / 2} height={76 - sw} rx="1.5" fill="currentColor" />
        <path d={d} fill="currentColor" />
      </g>
      <path d={h} fill={acc} stroke={acc} strokeWidth={sw} strokeLinejoin="round" transform={`translate(${lift} -1) rotate(-${tilt} 32 50)`} />
    </svg>
  )
}

export function Logo({ size = 19 }: { size?: number }) {
  if (size < 14) return <span role="img" aria-label="Dora" style={{ display: 'inline-flex' }}><BrandMark size={size + 3} /></span>
  return (
    <span className="f-brandlock" role="img" aria-label="Dora"
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.32, color: 'var(--logo-ink, var(--ink))' }}>
      <BrandMark size={size * 1.5} />
      <span aria-hidden="true" style={{ font: `700 ${size * 1.3}px/1 'Big Shoulders Display', sans-serif`, letterSpacing: '.04em', textTransform: 'uppercase' }}>Dora</span>
    </span>
  )
}
