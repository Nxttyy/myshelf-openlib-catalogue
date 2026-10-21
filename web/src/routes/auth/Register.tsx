import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { useMe } from '../../api/me'
import { useSignup } from '../../api/queries'
import { MIN_PASSWORD, emailOk, safeNext, useTouched } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { useIsDesktop } from '../../lib/useMediaQuery'
import { AuthCard, AuthLink, Field, GoogleButton, PasswordField, Submit } from './AuthForm'

type Key = 'first' | 'email' | 'pw'

export default function Register() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'), '/profile')
  const { data: me } = useMe()
  const signup = useSignup()
  const toast = useToast()
  const navigate = useNavigate()
  const desktop = useIsDesktop()
  const [form, setForm] = useState({ firstname: '', lastname: '', email: '', password: '' })
  // The server's answer for this exact email, e.g. it already has an account.
  const [taken, setTaken] = useState<{ email: string; msg: string } | null>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const { seen, blur, tried, setTried } = useTouched<Key>()
  const firstRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const pwRef = useRef<HTMLInputElement>(null)

  if (me && !signup.isPending) return <Navigate to={next} replace />

  const errs: Record<Key, string | null> = {
    first: !form.firstname.trim() ? 'Enter your first name' : null,
    email: !form.email.trim() ? 'Enter your email' : !emailOk(form.email) ? 'This email looks incomplete'
      : taken && taken.email === form.email.trim() ? taken.msg : null,
    pw: form.password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters` : null,
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    const bad = (['first', 'email', 'pw'] as Key[]).find((k) => errs[k])
    if (bad) return { first: firstRef, email: emailRef, pw: pwRef }[bad].current?.focus()
    const body = { ...form, firstname: form.firstname.trim(), lastname: form.lastname.trim(), email: form.email.trim() }
    signup.mutate(body, {
      onSuccess: (u) => { toast('Welcome to Dora, ' + u.handle); navigate(next, { replace: true }) },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) { setTaken({ email: body.email, msg: err.message }); emailRef.current?.focus() }
        else toast(err.message, 'err')
      },
    })
  }

  return (
    <AuthCard reason title="Create your account" sub="Scan a book's barcode or paste a film's IMDb ID. Dora fills in the rest."
      footer={<>Already have an account? <AuthLink to="/login">Sign in</AuthLink></>}>
      <GoogleButton next={next} disabled={signup.isPending} />
      <form noValidate onSubmit={submit}>
        <div className="au-names">
          <Field id="au-first" label="First name" autoComplete="given-name" placeholder="Jane" inputRef={firstRef} autoFocus={desktop}
            value={form.firstname} onChange={set('firstname')} onBlur={blur('first')} error={seen('first') ? errs.first : null} />
          <Field id="au-last" label="Last name" autoComplete="family-name" placeholder="Optional"
            value={form.lastname} onChange={set('lastname')} />
        </div>
        <Field id="au-email" label="Email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" inputRef={emailRef}
          value={form.email} onChange={set('email')} onBlur={blur('email')}
          error={seen('email') || (taken && taken.email === form.email.trim()) ? errs.email : null} />
        <PasswordField id="au-pw" label="Password" autoComplete="new-password" inputRef={pwRef} counter
          value={form.password} onChange={set('password')} onBlur={blur('pw')} error={tried ? errs.pw : null} />
        <Submit busy={signup.isPending} label="Create account" busyLabel="Creating account" />
        <p className="au-fine">Your profile is public. You can make it private any time.</p>
      </form>
    </AuthCard>
  )
}
