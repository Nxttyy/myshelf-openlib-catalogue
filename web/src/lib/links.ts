import type { Book } from '../api/types'

/** "Find this edition" links: the design's four, using the record's own
    pages and ids where its sources gave us them, plus the Internet Archive
    copy if any. */
export function editionLinks(b: Book): { label: string; href: string }[] {
  const isbn = b.isbns?.[0]
  const q = encodeURIComponent([b.title, b.authors?.[0]?.name].filter(Boolean).join(' '))
  const page = (provider: string) => b.source_links?.find((l) => l.provider === provider)?.url
  const goodreads = b.identifiers?.goodreads?.[0]
  const google = b.identifiers?.google?.[0]
  const archive = b.identifiers?.archive?.[0]
  const links = [
    { label: 'Open Library', href: page('openlibrary') || (isbn ? `https://openlibrary.org/isbn/${isbn}` : `https://openlibrary.org/search?q=${q}`) },
    { label: 'Google Books', href: page('google') || (google ? `https://books.google.com/books?id=${google}` : `https://books.google.com/books?q=${q}`) },
    { label: 'Goodreads', href: goodreads ? `https://www.goodreads.com/book/show/${goodreads}` : `https://www.goodreads.com/search?q=${q}` },
    { label: 'Amazon', href: `https://www.amazon.com/s?k=${isbn ?? q}` },
  ]
  if (archive) links.push({ label: 'Internet Archive', href: `https://archive.org/details/${archive}` })
  return links
}
