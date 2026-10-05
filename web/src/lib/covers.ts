import type { Book } from '../api/types'

// Editorial cover palettes from the design (folio/data.js):
// [background, ink, rule].
export const PALETTES = {
  paper:   ['#EDE6D6', '#1A1714', 'rgba(26,23,20,0.25)'],
  ink:     ['#1B2230', '#EDE6D6', 'rgba(237,230,214,0.3)'],
  blue:    ['#243B6B', '#EDE6D6', 'rgba(237,230,214,0.32)'],
  amber:   ['#E0A23E', '#231A0E', 'rgba(35,26,14,0.3)'],
  oxblood: ['#6B2B27', '#F0E5D8', 'rgba(240,229,216,0.3)'],
  forest:  ['#23402F', '#E7E2D0', 'rgba(231,226,208,0.3)'],
  black:   ['#141210', '#E9E2D2', 'rgba(233,226,210,0.28)'],
  sky:     ['#8FAFC0', '#15212A', 'rgba(21,33,42,0.28)'],
  clay:    ['#C97B4A', '#211009', 'rgba(33,16,9,0.3)'],
  slate:   ['#3A4250', '#E5E3DC', 'rgba(229,227,220,0.3)'],
  cream:   ['#F2EBDD', '#3A2C1E', 'rgba(58,44,30,0.25)'],
  plum:    ['#3D2A41', '#E9DCEC', 'rgba(233,220,236,0.3)'],
} as const satisfies Record<string, readonly [string, string, string]>

export type PaletteName = keyof typeof PALETTES
const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[]

/** What a cover needs to draw itself, real image or typographic jacket. */
export type CoverData = {
  key: string
  title: string
  author: string
  year: string | null
  pages: number | null
  /** short catalogue number printed on some jacket layouts */
  catalog: string
  palette: PaletteName
  layout: 0 | 1 | 2 | 3
  imageUrl: string | null
}

// FNV-1a: a stable hash so a book keeps the same jacket on every page
// (the old templates keyed colour off list position, so it changed).
function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function jacketFor(key: string): { palette: PaletteName; layout: CoverData['layout'] } {
  const h = hash(key)
  return {
    palette: PALETTE_NAMES[h % PALETTE_NAMES.length],
    layout: ((h >>> 8) % 4) as CoverData['layout'],
  }
}

export function coverFromBook(b: Pick<Book, 'id' | 'title' | 'authors' | 'publish_date' | 'number_of_pages' | 'isbns' | 'covers'>): CoverData {
  const cover = b.covers?.[0]
  return {
    key: b.id,
    title: b.title,
    author: b.authors?.[0]?.name ?? 'Unknown',
    year: b.publish_date?.match(/\d{4}/)?.[0] ?? null,
    pages: b.number_of_pages ?? null,
    catalog: (b.isbns?.[0] ?? b.id.replace(/-/g, '')).slice(-5),
    imageUrl: cover?.medium || cover?.small || cover?.large || null,
    ...jacketFor(b.id),
  }
}
