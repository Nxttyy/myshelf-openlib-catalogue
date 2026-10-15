/* A film poster: a flat printed sheet, not a 3D object (books keep the
   spine). From folio/films.jsx Poster. Shows OMDb's poster image, or a
   typographic one (film perforations, year, rating, title, director) in a
   palette keyed off the IMDb ID, so a film looks the same everywhere. */

import { useState, type CSSProperties } from 'react'
import { jacketFor, PALETTES } from '../lib/covers'

export type PosterData = {
  imdb_id: string
  title: string
  year?: string | null
  rated?: string | null
  director?: string | null
  writer?: string | null
  poster_url?: string | null
}

export function Poster({ f, w = 168, hover = true }: { f: PosterData; w?: number; hover?: boolean }) {
  const [bg, ink, rule] = PALETTES[jacketFor(f.imdb_id).palette]
  const [img, setImg] = useState(!!f.poster_url)
  const u = w / 100, tiny = w < 70
  const tlen = f.title.length
  const credit = f.director || f.writer?.split(',')[0]
  return (
    <div className={'f-poster' + (hover ? ' hov' : '')}
      style={{ width: w, height: w * 1.48, background: bg, color: ink, '--rule': rule } as CSSProperties}>
      {img ? <img src={f.poster_url!} alt={f.title} loading="lazy" onError={() => setImg(false)} /> : (
        <>
          <div className="perf" style={{ height: 4.5 * u, top: 4 * u, left: 6 * u, right: 6 * u, gap: 3.5 * u }}>
            {Array.from({ length: 8 }, (_, i) => <i key={i} />)}
          </div>
          {!tiny && f.year && <div className="yr" style={{ fontSize: 7.4 * u, top: 15 * u, left: 8 * u }}>{f.year}</div>}
          {!tiny && f.rated && <div className="rt" style={{ fontSize: 5 * u, top: 15 * u, right: 8 * u, padding: `${1 * u}px ${2.4 * u}px` }}>{f.rated}</div>}
          <div className="tt" style={{ fontSize: tiny ? 7 : (tlen > 16 ? 11.5 : tlen > 9 ? 14 : 18) * u, left: 8 * u, right: 8 * u, bottom: tiny ? 6 : 17 * u }}>{f.title}</div>
          {!tiny && credit && <div className="dr" style={{ fontSize: Math.max(7, 5.2 * u), left: 8 * u, right: 8 * u, bottom: 7 * u, paddingTop: 3 * u }}>{credit}</div>}
        </>
      )}
    </div>
  )
}
