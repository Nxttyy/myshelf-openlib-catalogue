import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useMe } from '../../api/me'
import { useLogin } from '../../api/queries'
import { useToast } from '../../lib/toast'
import { AuthFrame, Field, FormFooter, GoogleButton, LabelLink, PasswordField } from './AuthFrame'
import { footerLink, safeNext } from '../../lib/auth'

export default function Login() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'), '/profile')
  const { data: me } = useMe()
  const login = useLogin()
  const toast = useToast()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Errors from the Google round trip arrive as ?error=...
  const shown = useRef(false)
  useEffect(() => {
    const err = params.get('error')
    if (err && !shown.current) { shown.current = true; toast(err, 'err') }
  }, [params, toast])

  if (me && !login.isPending) return <Navigate to={next} replace />

  function submit(e: FormEvent) {
    e.preventDefault()
    login.mutate({ email, password }, {
      onSuccess: (u) => { toast('Signed in as ' + u.handle); navigate(next, { replace: true }) },
      onError: (err) => toast(err.message, 'err'),
    })
  }

  return (
    <AuthFrame label="Dora · sign in" title={<>Welcome<br />back.</>} sub="Your shelf and notes, where you left them.">
      <GoogleButton />
      <form onSubmit={submit}>
        <Field label="Email" id="email" type="email" autoComplete="email" required placeholder="you@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField label="Password" id="password" autoComplete="current-password" required placeholder="••••••••"
          value={password} onChange={(e) => setPassword(e.target.value)}
          aside={<LabelLink to="/forgot-password">Forgot?</LabelLink>} />
        <button type="submit" className="f-btn f-btn--amber f-btn--block" style={{ marginTop: 6 }} disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <FormFooter>
        New here? <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} style={footerLink}>Create an account</Link>
      </FormFooter>
    </AuthFrame>
  )
}
