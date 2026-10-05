/* 3D book cover, ported from the design's folio/covers.jsx.
   The front face is the real cover image when there is one, otherwise a
   typographic jacket in one of four layouts. Larger covers are a 3D object
   that turns on hover to reveal a spine sized by page count, tilting to the
   pointer with a glare sweep. Tilt only follows a mouse: on touch screens a
   finger dragging past a cover is a scroll, not a hover.

   Images load when the cover nears the viewport. Native loading="lazy" can't
   be used: Chrome never treats an <img> inside this preserve-3d /
   backface-hidden face as visible, so it never loads at all. */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { PALETTES, type CoverData } from '../lib/covers'

// Jackets show the main title only: no subtitle after a colon, no
// "(Series Name)" in brackets. The design's sample titles never needed it.
const shortTitle = (t: string) => t.replace(/:.*$/, '').replace(/\s*\([^)]*\)\s*/g, ' ').trim() || t

function FaceContent({ b, w, ink, rule }: { b: CoverData; w: number; ink: string; rule: string }) {
  const u = w / 100 // 1 unit = 1% of width
  const title = shortTitle(b.title)
  const lastName = b.author.split(' ').slice(-1)[0]

  const labelStyle: CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 7 * u, letterSpacing: '0.16em',
    textTransform: 'uppercase', color: ink, opacity: 0.6,
  }
  const ruleEl = (mt: number) => (
    <div style={{ height: Math.max(1, 0.8 * u), background: rule, marginTop: mt }} />
  )
  // capped so a long real title can't push into the labels around it
  const titleBlock = (align: 'left' | 'center', size: number, lines = 4) => (
    <div style={{
      fontWeight: 600, fontSize: size * u, lineHeight: 0.96,
      letterSpacing: '-0.04em', color: ink, textAlign: align, textWrap: 'balance',
      display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      paddingBottom: '0.06em',
    }}>{title}</div>
  )

  if (b.layout === 0) {
    // top label, big title bottom-left, author under a rule
    return (
      <div style={{ position: 'absolute', inset: `${7 * u}px ${8 * u}px`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', ...labelStyle }}>
          <span>Dora</span><span>{b.year}</span>
        </div>
        <div style={{ flex: 1 }} />
        {titleBlock('left', 17)}
        {ruleEl(7 * u)}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8 * u, letterSpacing: '0.04em', color: ink, opacity: 0.8, marginTop: 6 * u, textTransform: 'uppercase' }}>{b.author}</div>
      </div>
    )
  }
  if (b.layout === 1) {
    // centered modernist: author top, title center, catalog number bottom
    return (
      <div style={{ position: 'absolute', inset: `${8 * u}px ${8 * u}px`, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ ...labelStyle, opacity: 0.75 }}>{b.author}</div>
        {ruleEl(6 * u)}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>{titleBlock('center', 19)}</div>
        <div style={{ ...labelStyle, opacity: 0.5 }}>№ {b.catalog}</div>
      </div>
    )
  }
  if (b.layout === 2) {
    // swiss grid: huge initial, title runs down, surname on the baseline
    return (
      <div style={{ position: 'absolute', inset: `${7 * u}px ${8 * u}px`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 600, fontSize: 42 * u, lineHeight: 0.8, letterSpacing: '-0.06em', color: ink }}>{title[0]}</div>
        {ruleEl(5 * u)}
        <div style={{ flex: 1 }} />
        {titleBlock('left', 13, 3)}
        <div style={{ ...labelStyle, marginTop: 6 * u }}>{lastName}</div>
      </div>
    )
  }
  // framed: thin inset border, title mid, two rules
  return (
    <div style={{ position: 'absolute', inset: `${6 * u}px`, border: `${Math.max(1, 0.8 * u)}px solid ${rule}`, padding: `${7 * u}px`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...labelStyle }}>{b.author}</div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>{titleBlock('left', 15)}</div>
      {ruleEl(0)}
      <div style={{ ...labelStyle, marginTop: 5 * u, display: 'flex', justifyContent: 'space-between' }}>
        <span>{b.year ? `Est ${b.year}` : ''}</span><span>{b.pages ? `${b.pages}p` : ''}</span>
      </div>
    </div>
  )
}

function Spine({ b, w, thickness, ink }: { b: CoverData; w: number; thickness: number; ink: string }) {
  const u = w / 100
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, height: '100%', width: thickness,
      background: PALETTES[b.palette][0],
      transform: `rotateY(-90deg) translateZ(${thickness / 2}px) translateX(-${thickness / 2}px)`,
      transformOrigin: 'left center',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: 'inset -8px 0 14px rgba(0,0,0,0.28)',
      overflow: 'hidden',
    }}>
      <div style={{
        writingMode: 'vertical-rl', transform: 'rotate(180deg)',
        fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: Math.min(thickness * 0.42, 9 * u),
        letterSpacing: '-0.01em', color: ink, whiteSpace: 'nowrap', opacity: 0.92,
      }}>{shortTitle(b.title)}</div>
    </div>
  )
}

type Props = { b: CoverData; w?: number; tilt?: boolean; style?: CSSProperties }

export function Cover({ b, w = 120, tilt = true, style = {} }: Props) {
  const [bg, ink, rule] = PALETTES[b.palette]
  const h = w * 1.5
  const ref = useRef<HTMLDivElement>(null)
  const [t, setT] = useState({ rx: 0, ry: 0, hover: false })
  const [near, setNear] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const showImage = !!b.imageUrl && !failed

  useEffect(() => {
    const el = ref.current
    if (!b.imageUrl || near || !el) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNear(true); io.disconnect() }
    }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [b.imageUrl, near])

  // spine thickness scales with page count, then with cover width
  const thickness = Math.max(6, Math.min(24, (b.pages ?? 300) / 48)) * (w / 130)

  function onMove(e: PointerEvent) {
    if (!tilt || e.pointerType !== 'mouse' || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    setT({ rx: -py * 14, ry: px * 18, hover: true })
  }
  function onLeave() {
    if (t.hover) setT({ rx: 0, ry: 0, hover: false })
  }

  const baseRevealY = tilt && t.hover ? 20 : 0 // turn to show the spine on hover

  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave}
      style={{ width: w, height: h, perspective: w * 6, flexShrink: 0, ...style }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        transformStyle: 'preserve-3d',
        transform: `rotateX(${t.rx}deg) rotateY(${t.ry + baseRevealY}deg) translateZ(${t.hover ? 6 : 0}px)`,
        transition: t.hover ? 'transform 80ms linear' : 'transform 420ms var(--ease-out)',
      }}>
        {tilt && <Spine b={b} w={w} thickness={thickness} ink={ink} />}
        <div style={{
          position: 'absolute', inset: 0, background: bg, color: ink,
          borderRadius: Math.max(2, w * 0.012),
          boxShadow: t.hover
            ? '0 22px 40px rgba(0,0,0,0.32), inset 0 0 0 1px rgba(255,255,255,0.06)'
            : '0 6px 16px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.04)',
          transition: 'box-shadow 300ms var(--ease-out)',
          overflow: 'hidden', backfaceVisibility: 'hidden',
        }}>
          {/* Open Library covers can take seconds (two redirects to archive.org),
              so the jacket stands in until the image arrives, then it fades over. */}
          {showImage && !loaded && <FaceContent b={b} w={w} ink={ink} rule={rule} />}
          {showImage && near && (
            <img src={b.imageUrl!} alt="" decoding="async"
              onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                opacity: loaded ? 1 : 0, transition: 'opacity 260ms var(--ease-out)' }} />
          )}
          {/* left binding shadow */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '11%',
            background: 'linear-gradient(90deg, rgba(0,0,0,0.18), transparent)' }} />
          {/* glare sweep on hover */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.22) 48%, transparent 62%)',
            transform: `translateX(${t.hover ? (t.ry * 3) : -200}%)`,
            opacity: t.hover ? 1 : 0, transition: 'opacity 300ms, transform 120ms linear' }} />
          {/* the design paints the jacket text above the shadow and glare */}
          {!showImage && <FaceContent b={b} w={w} ink={ink} rule={rule} />}
        </div>
      </div>
    </div>
  )
}
