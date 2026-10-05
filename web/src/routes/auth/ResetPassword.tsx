import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useResetPassword } from '../../api/queries'
import { useToast } from '../../lib/toast'
import { AuthFrame, FormFooter, PasswordField } from './AuthFrame'
import { footerLink } from '../../lib/auth'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const reset = useResetPassword()
  const toast = useToast()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    reset.mutate({ token, new_password: password }, {
      onSuccess: () => { toast('Password updated. Sign in with your new one.'); navigate('/login', { replace: true }) },
      onError: (err) => toast(err.message, 'err'),
    })
  }

  return (
    <AuthFrame label="Dora · password" title={<>Set a new<br />password.</>} sub="Choose a strong one. You'll use it next time you sign in.">
      {token ? (
        <form onSubmit={submit}>
          <PasswordField label="New password" id="password" autoComplete="new-password" required minLength={8} placeholder="At least 8 characters"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="f-btn f-btn--amber f-btn--block" style={{ marginTop: 6 }} disabled={reset.isPending}>
            {reset.isPending ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      ) : (
        <p style={{ fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.55 }}>This link is missing its reset code. Open the link from the email again, or ask for a new one.</p>
      )}
      <FormFooter>Link expired? <Link to="/forgot-password" style={footerLink}>Send a new one</Link></FormFooter>
    </AuthFrame>
  )
}
