import type { AskCandidate } from '../../api/add'
import { jacketFor } from '../../lib/covers'
import type { QueueItem } from '../../lib/queue'
import { Cover } from '../Cover'
import { Icon } from '../Icon'
import { AskDoraBlock, Taste } from './AskDora'
import { useAskDora } from './useAskDora'

/** The 30px covers in queue chips and search results. */
export function SmallCover({ id, title, author, coverUrl }: { id: string; title: string; author?: string; coverUrl: string | null }) {
  return <Cover w={30} tilt={false} b={{ key: id, title: title || 'Untitled', author: author || '', year: null, pages: null, catalog: '', imageUrl: coverUrl, ...jacketFor(id) }} />
}

export function QueueChip({ item, onRemove }: { item: QueueItem; onRemove: () => void }) {
  const warn = item.state === 'notfound' || item.state === 'limited'
  const title = item.state === 'looking' ? 'Looking up…'
    : item.state === 'notfound' ? 'Not found on Open Library'
    : item.state === 'limited' ? 'Open Library is busy. It will retry on save.'
    : item.title
  return (
    <div className="f-queue-chip d-chip-taste">
      <div className="top">
        <SmallCover id={item.key} title={item.title} author={item.ask.authors[0]} coverUrl={item.coverUrl} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: warn ? 'var(--status-error)' : undefined }}>{title}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.sub}</div>
        </div>
        <button onClick={onRemove} className="f-iconbtn" style={{ width: 28, height: 28, flexShrink: 0 }} aria-label={`Remove ${item.title}`}><Icon name="close" size={15} /></button>
      </div>
      {item.state === 'ready' && <AskDoraBlock candidate={item.ask} />}
    </div>
  )
}

/** A search result: Ask Dora before deciding to Add (folio/desktop.jsx SearchResult). */
export function SearchResultRow({ id, title, meta, tag, coverUrl, author, candidate, added, onAdd }: {
  id: string; title: string; meta: string; tag?: string | null; coverUrl: string | null; author?: string
  candidate: AskCandidate; added: boolean; onAdd: () => void
}) {
  const { state, ask } = useAskDora(candidate)
  return (
    <div className="d-result">
      <div className="top">
        <SmallCover id={id} title={title} author={author} coverUrl={coverUrl} />
        <div className="m">
          <div className="t" title={title}>{title}</div>
          <div className="a">{meta || '·'}</div>
          {tag && <div style={{ marginTop: 4 }}><span className="m-tag">{tag}</span></div>}
        </div>
        {state.s === 'idle' && <button className="ask" title="Ask Dora: buy or skip?" onClick={ask}><Icon name="dora" size={15} sw={1.6} /> Ask Dora</button>}
        <button className="f-btn f-btn--ink" style={{ padding: '6px 14px', fontSize: 12.5 }} onClick={onAdd} disabled={added}>{added ? 'Added' : 'Add'}</button>
      </div>
      {state.s === 'asking' && <div className="taste"><span className="f-label">Dora is reading your shelves…</span></div>}
      {state.s === 'error' && <div className="taste"><button className="ask" onClick={ask}>{state.msg}</button></div>}
      {state.s === 'done' && <Taste v={state.v} />}
    </div>
  )
}

