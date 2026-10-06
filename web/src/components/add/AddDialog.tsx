/* "Add to library". Desktop: folio/desktop.jsx AddDialog (two columns,
   queue on the right). Phone: folio/modal.jsx AddModal (full-height sheet,
   save pinned at the bottom). Addressed by ?add=<tab>, so Back closes it;
   ?add=edit:<bookId> corrects a hand-typed book instead. */

import { Link, useLocation, useNavigate } from 'react-router'
import { useSaveQueue } from '../../api/add'
import { ApiError } from '../../api/client'
import { useMe } from '../../api/me'
import { useOverlay } from '../../lib/overlay'
import { queue, useQueue, type Batch } from '../../lib/queue'
import { useToast } from '../../lib/toast'
import { useIsDesktop } from '../../lib/useMediaQuery'
import { Icon } from '../Icon'
import type { IconName } from '../icons'
import { BottomSheet, Dialog } from '../Overlay'
import { ScanTab } from './ScanTab'
import { QueueChip } from './shared'
import { IsbnTab, ManualTab, SearchTab } from './Tabs'

type Tab = 'scan' | 'isbn' | 'search' | 'manual'
const TABS: { id: Tab; icon: IconName; long: string; short: string }[] = [
  { id: 'scan', icon: 'barcode', long: 'Scan barcode', short: 'Scan' },
  { id: 'isbn', icon: 'edit', long: 'Enter ISBN', short: 'ISBN' },
  { id: 'search', icon: 'search', long: 'Search title', short: 'Search' },
  { id: 'manual', icon: 'plus', long: 'By hand', short: 'By hand' },
]

export function AddOverlay() {
  const { value, open, close } = useOverlay('add')
  if (!value) return null
  return <AddDialog value={value} setTab={(t) => open(t, { replace: true })} onClose={close} />
}

function AddDialog({ value, setTab, onClose }: { value: string; setTab: (t: string) => void; onClose: () => void }) {
  const desktop = useIsDesktop()
  const editId = value.startsWith('edit:') ? value.slice(5) : undefined
  const [tabRaw, prefill = ''] = value.split(/:(.*)/s)
  const tab: Tab = editId ? 'manual' : (TABS.some((t) => t.id === tabRaw) ? tabRaw : 'scan') as Tab

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: desktop ? '20px 28px 16px' : '8px 20px 14px' }}>
      <div>
        <div className="f-label">{editId ? 'Your entry' : 'Add to library'}</div>
        <div style={{ fontSize: desktop ? 21 : 18, fontWeight: 600, letterSpacing: '-0.025em', marginTop: desktop ? 4 : 3, whiteSpace: 'nowrap' }}>
          {editId ? 'Edit book details' : 'Scan or enter a book'}
        </div>
      </div>
      <button className="f-iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
    </div>
  )

  const content = editId
    ? <ManualTab key={value} editId={editId} onEdited={onClose} />
    : tab === 'scan' ? <ScanTab desktop={desktop} />
    : tab === 'isbn' ? <IsbnTab />
    : tab === 'search' ? <SearchTab desktop={desktop} onByHand={(title) => setTab('manual:' + title)} />
    : <ManualTab key={value} initialTitle={prefill} />

  const seg = !editId && (
    <div style={{ padding: desktop ? '0 28px 18px' : '0 20px 14px' }}>
      <div className="f-seg" role="tablist" style={desktop ? { maxWidth: 560 } : undefined}>
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={desktop ? 16 : 14} /> {desktop ? t.long : t.short}
          </button>
        ))}
      </div>
    </div>
  )

  if (desktop) {
    return (
      <Dialog label="Add to library" onClose={onClose}>
        {header}
        {seg}
        {editId ? (
          <div style={{ padding: '0 28px 28px', overflowY: 'auto' }}>{content}</div>
        ) : (
          <div className="d-dialog-cols">
            <div className="d-dialog-left">
              {content}
              <BatchSettings style={{ marginTop: 22 }} />
            </div>
            <div className="d-dialog-right">
              <QueueList desktop />
              <div style={{ marginTop: 16 }}><SaveFooter /></div>
            </div>
          </div>
        )}
      </Dialog>
    )
  }

  return (
    <BottomSheet label="Add to library" onClose={onClose} maxHeight="94%">
      {header}
      {seg}
      <div style={{ overflowY: 'auto', padding: '0 20px', scrollbarWidth: 'none', flex: 1, minHeight: 0 }}>
        {content}
        {!editId && (
          <>
            <BatchSettings style={{ margin: '16px 0 14px' }} />
            <QueueList desktop={false} />
          </>
        )}
        <div style={{ height: 16 }} />
      </div>
      {!editId && (
        <div style={{ padding: '12px 20px 18px', borderTop: '1px solid var(--hair)', background: 'var(--paper)' }}>
          <SaveFooter />
        </div>
      )}
    </BottomSheet>
  )
}

function BatchSettings({ style }: { style: React.CSSProperties }) {
  const { batch } = useQueue()
  return (
    <div style={{ display: 'flex', gap: 10, ...style }}>
      <div style={{ flex: 1 }}>
        <label className="f-label" htmlFor="batch-status" style={{ display: 'block', marginBottom: 7 }}>Reading status</label>
        <select id="batch-status" className="f-select" style={{ width: '100%' }} value={batch.status}
          onChange={(e) => queue.setBatch({ status: e.target.value as Batch['status'] })}>
          <option value="unread">Unread</option><option value="reading">Reading</option><option value="read">Read</option>
        </select>
      </div>
      <div style={{ flex: 1 }}>
        <label className="f-label" htmlFor="batch-visibility" style={{ display: 'block', marginBottom: 7 }}>Visibility</label>
        <select id="batch-visibility" className="f-select" style={{ width: '100%' }} value={batch.visibility}
          onChange={(e) => queue.setBatch({ visibility: e.target.value as Batch['visibility'] })}>
          <option value="public">Public</option><option value="private">Only me</option>
        </select>
      </div>
    </div>
  )
}

function QueueList({ desktop }: { desktop: boolean }) {
  const { items } = useQueue()
  const n = items.length
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: desktop ? 12 : 10 }}>
        <div className="f-label">Scan queue</div>
        <span aria-live="polite" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, background: n ? 'var(--amber)' : 'var(--paper-2)', color: n ? 'var(--accent-fg)' : 'var(--ink-faint)', borderRadius: 7, padding: '3px 9px', transition: 'all 180ms var(--ease-out)' }}>
          {n} {n === 1 ? 'book' : 'books'}
        </span>
      </div>
      <div style={desktop ? { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120 } : { display: 'flex', flexDirection: 'column', gap: 8 }}>
        {n === 0 && <div style={{ border: '1px dashed var(--hair-strong)', borderRadius: 9, padding: desktop ? 18 : 16, textAlign: 'center', fontSize: desktop ? 13 : 12.5, color: 'var(--ink-faint)' }}>Scanned books pile up here until you save.</div>}
        {items.map((item) => <QueueChip key={item.key} item={item} onRemove={() => queue.remove(item.key)} />)}
      </div>
    </>
  )
}

function SaveFooter() {
  const { data: me } = useMe()
  const { items } = useQueue()
  const save = useSaveQueue()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const n = items.length

  if (!me) {
    // The queue survives sign-in (sessionStorage), and ?add brings the dialog back.
    const next = encodeURIComponent(location.pathname + '?add=scan')
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
          <Icon name="lock" size={13} style={{ verticalAlign: '-2px', marginRight: 5, color: 'var(--ink-faint)' }} />
          Sign in to save {n ? n : 'your'} scan{n === 1 ? '' : 's'}.
        </div>
        <Link to={`/login?next=${next}`} className="f-btn f-btn--ink">Sign in</Link>
      </div>
    )
  }

  function onSave() {
    save.mutate(undefined, {
      onSuccess: ({ added, errors }) => {
        if (errors.length && !added) { toast(errors[0], 'err'); return } // nothing saved: keep the queue
        queue.clear()
        toast(added ? `${added} ${added === 1 ? 'book' : 'books'} saved.` : 'Those books were already on your shelf.')
        if (errors.length) setTimeout(() => toast(errors[0], 'err'), 600)
        // Replace the ?add entry, so Back from the profile doesn't reopen an empty dialog.
        navigate('/profile', { replace: true, state: { mode: 'hauls' } })
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 401) {
          toast('Please sign in again to save. Your queue is kept.', 'err')
          navigate(`/login?next=${encodeURIComponent(location.pathname + '?add=scan')}`)
        } else toast("Couldn't save. Your queue is kept, try again.", 'err')
      },
    })
  }

  return (
    <button className="f-btn f-btn--amber f-btn--block" disabled={!n || save.isPending} onClick={onSave} style={{ opacity: n ? 1 : 0.45 }}>
      <Icon name="check" size={18} sw={2} /> {save.isPending ? 'Saving…' : `Done · save ${n || ''} to library`}
    </button>
  )
}
