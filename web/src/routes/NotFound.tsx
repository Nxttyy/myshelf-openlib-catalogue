/* 404: folio/desktop-app-v2.jsx NotFound, smaller on phones (styles/mobile.css). */

import { Link } from 'react-router'
import { Logo } from '../components/Logo'

const COPY = "This page doesn't exist. It may have moved, or the link is wrong."

export default function NotFound({ text = COPY }: { text?: string }) {
  return (
    <div className="f-rise d-404-min">
      <div className="berry"><Logo size={32} /></div>
      <div className="big">404</div>
      <p>{text}</p>
      <Link to="/" className="f-btn f-btn--amber" style={{ padding: '13px 22px', fontSize: 15 }}>Back home</Link>
    </div>
  )
}
