import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useRequestPasswordReset } from '../../api/queries'
import { useToast } from '../../lib/toast'
import { AuthFrame, Field, FormFooter } from './AuthFrame'
import { footerLink } from '../../lib/auth'

export default function ForgotPassword() {
  const request = useRequestPasswordReset()
  const toast = useToast()
  const [email, setEmail] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    request.mutate(email.trim(), { onError: (err) => toast(err.message, 'err') })
  }

  return (
    <AuthFrame label="Dora · password" title={<>Forgot your<br />password?</>} sub="Enter your email and we'll send you a link to set a new one.">
      {request.isSuccess ? (
        <div role="status">
          <div className="f-label" style={{ marginBottom: 10 }}>Check your inbox</div>
          <p style={{ fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
            If there's an account for <strong style={{ color: 'var(--ink)' }}>{email.trim()}</strong>, a reset link is on its way. It works for one hour.
          </p>
          <Link to="/login" className="f-btn f-btn--ink f-btn--block" style={{ marginTop: 22 }}>Back to sign in</Link>
        </div>
      ) : (
        <>
          <form onSubmit={submit}>
            <Field label="Email" id="email" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="f-btn f-btn--amber f-btn--block" style={{ marginTop: 6 }} disabled={request.isPending}>
              {request.isPending ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <FormFooter>Remembered it? <Link to="/login" style={footerLink}>Sign in</Link></FormFooter>
        </>
      )}
    </AuthFrame>
  )
}
