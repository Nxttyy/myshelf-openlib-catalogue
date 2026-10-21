import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { useMe } from '../../api/me'
import { useLogin } from '../../api/queries'
import { emailOk, safeNext, useTouched } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { useIsDesktop } from '../../lib/useMediaQuery'
import { Alert, AuthCard, AuthLink, Field, GoogleButton, PasswordField, Submit } from './AuthForm'

export default function Login() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'), '/profile')
  const { data: me } = useMe()
  const login = useLogin()
  const toast = useToast()
  const navigate = useNavigate()
  const desktop = useIsDesktop()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState(false)
  // Errors from the Google round trip arrive as ?error=...
  const googleErr = params.get('error')
  const { seen, blur, setTried } = useTouched<'email' | 'pw'>()
  const emailRef = useRef<HTMLInputElement>(null)
  const pwRef = useRef<HTMLInputElement>(null)

  if (me && !login.isPending) return <Navigate to={next} replace />

  const errs = {
    email: !email.trim() ? 'Enter your email' : !emailOk(email) ? 'This email looks incomplete' : null,
    pw: !password ? 'Enter your password' : null,
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true); setWrong(false)
    if (errs.email) return emailRef.current?.focus()
    if (errs.pw) return pwRef.current?.focus()
    login.mutate({ email: email.trim(), password }, {
      onSuccess: (u) => { toast('Signed in as ' + u.handle); navigate(next, { replace: true }) },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 401) { setWrong(true); setPassword(''); pwRef.current?.focus() }
        else toast(err.message, 'err')
      },
    })
  }

  return (
    <AuthCard reason title="Welcome back" sub="Sign in to see your books, films, and notes."
      footer={<>New to Dora? <AuthLink to="/register">Create an account</AuthLink></>}>
      {googleErr && <Alert>{googleErr}</Alert>}
      <GoogleButton next={next} disabled={login.isPending} />
      <form noValidate onSubmit={submit}>
        <Field id="au-email" label="Email" type="email" inputMode="email" autoComplete="username" placeholder="you@example.com"
          inputRef={emailRef} autoFocus={desktop} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={blur('email')}
          error={seen('email') ? errs.email : null} />
        <PasswordField id="au-pw" label="Password" autoComplete="current-password" inputRef={pwRef}
          aside={<AuthLink to="/forgot-password">Forgot password?</AuthLink>}
          value={password} onChange={(e) => { setPassword(e.target.value); setWrong(false) }} onBlur={blur('pw')}
          error={seen('pw') ? errs.pw : null} invalid={wrong} />
        {wrong && (
          <Alert>That email and password don't match. Try again or <AuthLink to="/forgot-password">reset your password</AuthLink>.</Alert>
        )}
        <Submit busy={login.isPending} label="Sign in" busyLabel="Signing in" />
      </form>
    </AuthCard>
  )
}
