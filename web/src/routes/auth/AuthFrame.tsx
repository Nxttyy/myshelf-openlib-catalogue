/* Shared frame for sign in / sign up / password pages, from folio/login.jsx:
   a navy typographic band over the form. Full screen on phones, as in the
   design; a centered card on desktop, which the design doesn't draw. */

import { useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Icon } from '../../components/Icon'
import { Logo } from '../../components/Logo'
import { useIsDesktop } from '../../lib/useMediaQuery'

type Props = { label: string; title: ReactNode; sub: string; children: ReactNode }

export function AuthFrame({ label, title, sub, children }: Props) {
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const location = useLocation()
  // Close goes back where you came from; a fresh tab has nowhere to go back to.
  const close = () => (location.key !== 'default' ? navigate(-1) : navigate('/'))

  const band = (
    <div className="auth-band">
      <button className="f-iconbtn auth-close" onClick={close} aria-label="Close"><Icon name="close" size={20} /></button>
      <div className="f-label on-dark">{label}</div>
      <h1 className="f-display" style={{ fontSize: 40, color: 'var(--paper)', marginTop: 40 }}>{title}</h1>
      <p style={{ fontSize: 13.5, color: 'rgba(244,238,226,0.7)', marginTop: 14, maxWidth: 280 }}>{sub}</p>
    </div>
  )

  return (
    <div className="d-app f-grain kc th-navy auth-screen">
      {isDesktop ? (
        <div className="auth-desk">
          <Link to="/" className="home-link" aria-label="Dora home"><Logo size={21} /></Link>
          <div className="auth-card">{band}<div className="auth-form">{children}</div></div>
        </div>
      ) : (
        <>{band}<div className="auth-form">{children}</div></>
      )}
    </div>
  )
}

export function GoogleButton() {
  return (
    <>
      <a href="/auth/google" className="f-btn f-btn--block" style={{ background: 'var(--paper-2)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--hair-strong)', marginBottom: 18 }}>
        <Icon name="google" size={18} sw={0} /> Continue with Google
      </a>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div className="hero-rule" style={{ flex: 1 }} />
        <span className="f-label">or</span>
        <div className="hero-rule" style={{ flex: 1 }} />
      </div>
    </>
  )
}

export function Field({ label, aside, ...input }: { label: string; aside?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="f-field">
      {aside
        ? <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
            <label className="f-label" htmlFor={input.id} style={{ margin: 0 }}>{label}</label>{aside}
          </div>
        : <label className="f-label" htmlFor={input.id}>{label}</label>}
      <input className="f-input" {...input} />
    </div>
  )
}

export function PasswordField({ label, aside, ...input }: { label: string; aside?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false)
  return (
    <div className="f-field">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <label className="f-label" htmlFor={input.id} style={{ margin: 0 }}>{label}</label>{aside}
      </div>
      <div style={{ position: 'relative' }}>
        <input className="f-input" type={show ? 'text' : 'password'} style={{ paddingRight: 44 }} {...input} />
        <button type="button" className="f-iconbtn" onClick={() => setShow((s) => !s)}
          style={{ position: 'absolute', right: 4, top: 4, color: 'var(--ink-faint)' }} aria-label={show ? 'Hide password' : 'Show password'}>
          <Icon name={show ? 'eyeoff' : 'eye'} size={18} />
        </button>
      </div>
    </div>
  )
}

/** Small mono link in a field's label row, like the design's "Forgot?". */
export function LabelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-blue)', textDecoration: 'none', padding: '4px 0' }}>
      {children}
    </Link>
  )
}

export function FormFooter({ children }: { children: ReactNode }) {
  return <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--ink-soft)' }}>{children}</div>
}
