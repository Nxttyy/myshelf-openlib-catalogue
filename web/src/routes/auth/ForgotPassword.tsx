import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRequestPasswordReset } from '../../api/queries'
import { Icon } from '../../components/Icon'
import { emailOk, useTouched } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { useIsDesktop } from '../../lib/useMediaQuery'
import { AuthCard, AuthLink, Field, Submit } from './AuthForm'

const COOLDOWN = 30 // seconds before "send it again" comes back

export default function ForgotPassword() {
  const request = useRequestPasswordReset()
  const toast = useToast()
  const desktop = useIsDesktop()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [cool, setCool] = useState(0)
  const { seen, blur, setTried } = useTouched<'email'>()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (cool <= 0) return
    const id = setTimeout(() => setCool((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cool])

  const err = !email.trim() ? 'Enter your email' : !emailOk(email) ? 'This email looks incomplete' : null

  function send(again = false) {
    request.mutate(email.trim(), {
      onSuccess: () => { setSent(true); setCool(COOLDOWN); if (again) toast('Sent again') },
      onError: (e) => toast(e.message, 'err'),
    })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (err) return ref.current?.focus()
    send()
  }

  if (sent) {
    return (
      <AuthCard key="sent" title="Check your email" sub="If there's an account for this address, the link to reset your password is on its way. It works for 1 hour.">
        <div className="au-mailto">
          <Icon name="mail" size={17} />
          <span className="f-mono">{email.trim()}</span>
          <button type="button" className="au-link" onClick={() => setSent(false)}>Change</button>
        </div>
        <AuthLink to="/login" className="f-btn f-btn--amber f-btn--block au-submit">Back to sign in</AuthLink>
        <p className="au-fine">
          Nothing after a few minutes? Check your spam folder, or{' '}
          {cool > 0
            ? <span className="f-mono">resend in 0:{String(cool).padStart(2, '0')}</span>
            : <button type="button" className="au-link" disabled={request.isPending} onClick={() => send(true)}>send it again</button>}.
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard key="form" title="Reset your password" sub="Enter the email you signed up with. We'll send a link to set a new one."
      footer={<AuthLink to="/login">Back to sign in</AuthLink>}>
      <form noValidate onSubmit={submit}>
        <Field id="au-email" label="Email" type="email" inputMode="email" autoComplete="username" placeholder="you@example.com"
          inputRef={ref} autoFocus={desktop} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={blur('email')}
          error={seen('email') ? err : null} />
        <Submit busy={request.isPending} label="Send reset link" busyLabel="Sending" />
      </form>
    </AuthCard>
  )
}
