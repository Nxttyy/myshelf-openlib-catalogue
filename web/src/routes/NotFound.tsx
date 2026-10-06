/* 404. Desktop: folio/desktop-app.jsx NotFound. Phone: folio/screens.jsx NotFound. */

import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { useIsDesktop } from '../lib/useMediaQuery'

const COPY = "This page doesn't exist. It may have moved, or the link is wrong."

export default function NotFound({ text = COPY }: { text?: string }) {
  if (useIsDesktop()) {
    return (
      <div className="f-rise d-404-min">
        <div className="berry"><Icon name="dora" size={76} sw={1.5} /></div>
        <div className="big">404</div>
        <p>{text}</p>
        <Link to="/" className="f-btn f-btn--amber" style={{ padding: '13px 22px', fontSize: 15 }}>Back home</Link>
      </div>
    )
  }
  return (
    <div className="f-rise" style={{ padding: '20px 18px 40px', minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <span style={{ color: 'var(--ink-blue)', display: 'inline-flex', opacity: 0.92, marginBottom: 18 }}><Icon name="dora" size={56} sw={1.5} /></span>
      <div className="f-404-big" style={{ fontSize: 96 }}>404</div>
      <p style={{ fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.5, margin: '12px 0 24px', maxWidth: 280 }}>{text}</p>
      <Link to="/" className="f-btn f-btn--amber" style={{ padding: '13px 22px', fontSize: 15 }}>Back home</Link>
    </div>
  )
}
