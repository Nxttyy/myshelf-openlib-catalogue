/* User guide: folio/desktop-app-v2.jsx Guide, a two-column grid that
   stacks on phones (styles/mobile.css). */

import { Icon } from '../components/Icon'
import type { IconName } from '../components/icons'
import { useOpenAdd } from '../lib/overlay'
import { LINKS } from '../lib/site'
import { useTouch } from '../lib/useMediaQuery'

type Step = [string, IconName, string, string]

const DESKTOP: Step[] = [
  ['01', 'scan', 'Add a book', 'Scan a barcode or type the ISBN. Dora looks it up and adds it to a queue. Add as many as you like, then save them at once.'],
  ['02', 'home', 'Set a status', 'Mark each book unread, reading, or read, and change it whenever. Books sit on your profile, newest first.'],
  ['03', 'pin', 'Pin a book', 'Hover a cover and click the pin. Pinned books move to the top of your shelf.'],
  ['04', 'eye', 'Public or private', 'Set any book, or your whole shelf, to public or private. Public shelves are visible to anyone with the link.'],
  ['05', 'share', 'Share your shelf', 'Your profile has its own link. Send it to anyone; they can view your shelf without an account.'],
  ['06', 'guide', 'Open data', 'Dora is open source, and every book links back to its source record. Nothing is locked in.'],
]

// touch screens have no hover: the pin is always showing
const PIN_TOUCH: Step = ['03', 'pin', 'Pin a book', 'Tap the pin on any book to move it to the top of your shelf.']

export default function Guide() {
  const onScan = useOpenAdd()
  const steps = useTouch() ? DESKTOP.map((st) => (st[0] === '03' ? PIN_TOUCH : st)) : DESKTOP
  return (
    <div className="f-rise">
      <div className="d-guide-hd">
        <div className="f-label">How Dora works</div>
        <h1>How it works.</h1>
        <p style={{ fontSize: 16, color: 'var(--ink-soft)', lineHeight: 1.55, marginTop: 16, maxWidth: 540 }}>Six things, start to finish.</p>
      </div>
      <div className="d-guide-grid">
        {steps.map(([n, ic, h, p]) => (
          <div className="d-guide-step" key={n}>
            <div className="ic"><Icon name={ic} size={19} sw={1.7} /></div>
            <div className="n">{n}</div>
            <h3>{h}</h3>
            <p>{p}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 36, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="f-btn f-btn--amber" onClick={onScan} style={{ padding: '14px 22px', fontSize: 15 }}><Icon name="scan" size={18} sw={1.8} /> Add your first book</button>
        <a className="f-btn f-btn--ghost" href={LINKS.openLibrary} target="_blank" rel="noreferrer" style={{ padding: '14px 22px', fontSize: 15, textDecoration: 'none' }}>Visit Open Library <Icon name="external" size={14} /></a>
      </div>
    </div>
  )
}
