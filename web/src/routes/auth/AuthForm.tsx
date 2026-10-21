/* Form parts for the auth pages, from folio/auth.jsx: the heading block,
   fields with inline errors, password field (show/hide, Caps Lock, length
   counter), Google button, alerts. Each page owns its own state; these only
   draw. */

import { useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { Icon } from '../../components/Icon'
import { MIN_PASSWORD } from '../../lib/auth'
import { useIsDesktop } from '../../lib/useMediaQuery'

/** Why the visitor was sent here, e.g. "Sign in to save 3 books". Set as
    router state by whoever links to /login. */
export type AuthState = { reason?: string } | null

/** Heading, subline and the switch link row. `reason` shows on sign in and
    create account only. */
export function AuthCard({ title, sub, reason, children, footer }: {
  title: string; sub: ReactNode; reason?: boolean; children: ReactNode; footer?: ReactNode
}) {
  const compact = !useIsDesktop()
  const why = (useLocation().state as AuthState)?.reason
  return (
    <div className={'au-form' + (compact ? ' m' : '')}>
      <div className="au-swap">
        {reason && why && <div className="au-reason"><Icon name="lock" size={13} />{why}</div>}
        <h1 className="au-h f-display">{title}</h1>
        <p className="au-sub">{sub}</p>
        {children}
        {footer && <div className="au-switch">{footer}</div>}
      </div>
    </div>
  )
}

/** A link to another auth page: keeps ?next= and the reason, and replaces
    the history entry so Back leaves the auth pages in one step. */
export function AuthLink({ to, className = 'au-link', children }: { to: string; className?: string; children: ReactNode }) {
  const [params] = useSearchParams()
  const location = useLocation()
  const next = params.get('next')
  const href = to + (next && to !== '/forgot-password' ? `?next=${encodeURIComponent(next)}` : '')
  return <Link to={href} replace state={location.state} className={className}>{children}</Link>
}

export function Msg({ id, kind, children }: { id?: string; kind?: 'err' | 'ok' | null; children: ReactNode }) {
  return (
    <div id={id} className={'au-msg' + (kind ? ' ' + kind : '')}>
      {kind === 'err' && <Icon name="alert" size={14} />}
      {kind === 'ok' && <Icon name="check" size={14} sw={2} />}
      <span>{children}</span>
    </div>
  )
}

export function Alert({ children }: { children: ReactNode }) {
  return <div className="au-alert" role="alert"><Icon name="alert" size={16} /><div>{children}</div></div>
}

export const Spinner = () => <span className="au-spin" />

/** `next` is a same-site path to return to after Google, e.g. /explore?book=… */
export function GoogleButton({ next, disabled }: { next?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const href = '/auth/google' + (next ? `?next=${encodeURIComponent(next)}` : '')
  return (
    <>
      <a href={href} className="f-btn f-btn--block au-google" aria-disabled={disabled || busy}
        onClick={(e) => { if (disabled || busy) e.preventDefault(); else setBusy(true) }}>
        {busy ? <Spinner /> : <Icon name="google" size={18} sw={0} />}
        Continue with Google
      </a>
      <div className="au-or">or with email</div>
    </>
  )
}

type FieldProps = {
  id: string; label: string; aside?: ReactNode; error?: string | null; hint?: ReactNode
  inputRef?: Ref<HTMLInputElement>
} & InputHTMLAttributes<HTMLInputElement>

export function Field({ id, label, aside, error, hint, inputRef, ...input }: FieldProps) {
  const msgId = id + '-msg'
  return (
    <div className="au-field">
      <div className="au-lrow"><label htmlFor={id}>{label}</label>{aside}</div>
      <input id={id} ref={inputRef} className="au-in" aria-invalid={!!error} aria-describedby={error || hint ? msgId : undefined} {...input} />
      {error ? <Msg id={msgId} kind="err">{error}</Msg> : hint ? <Msg id={msgId}>{hint}</Msg> : null}
    </div>
  )
}

/** Password with show/hide and a Caps Lock note. `counter` shows the
    "At least 8 characters · 3 to go" hint used when choosing a password. */
export function PasswordField({ id, label, aside, error, counter, invalid, inputRef, value, ...input }: FieldProps & {
  counter?: boolean; invalid?: boolean; value: string
}) {
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  const msgId = id + '-msg'
  const onKey = (e: KeyboardEvent) => setCaps(e.getModifierState?.('CapsLock') ?? false)
  const long = value.length >= MIN_PASSWORD
  return (
    <div className="au-field">
      <div className="au-lrow"><label htmlFor={id}>{label}</label>{aside}</div>
      <div className="au-inwrap">
        <input id={id} ref={inputRef} className="au-in" type={show ? 'text' : 'password'} value={value}
          onKeyUp={onKey} onKeyDown={onKey} aria-invalid={!!error || invalid} aria-describedby={msgId}
          style={{ paddingRight: 48 }} {...input} />
        <button type="button" className="f-iconbtn au-eye" onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          <Icon name={show ? 'eyeoff' : 'eye'} size={18} />
        </button>
      </div>
      {error
        ? <Msg id={msgId} kind="err">{error}</Msg>
        : counter
          ? <Msg id={msgId} kind={long ? 'ok' : null}>{long ? 'Long enough' : `At least ${MIN_PASSWORD} characters` + (value.length ? ` · ${MIN_PASSWORD - value.length} to go` : '')}</Msg>
          : null}
      {caps && <Msg>Caps Lock is on</Msg>}
    </div>
  )
}

export function Submit({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" className="f-btn f-btn--amber f-btn--block au-submit" disabled={busy}>
      {busy ? <><Spinner />{busyLabel}</> : label}
    </button>
  )
}
