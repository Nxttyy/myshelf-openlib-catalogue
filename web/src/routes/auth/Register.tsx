import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useMe } from '../../api/me'
import { useSignup } from '../../api/queries'
import { useToast } from '../../lib/toast'
import { AuthFrame, Field, FormFooter, GoogleButton, PasswordField } from './AuthFrame'
import { footerLink, safeNext } from '../../lib/auth'

export default function Register() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'), '/profile')
  const { data: me } = useMe()
  const signup = useSignup()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ firstname: '', lastname: '', email: '', password: '' })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  if (me && !signup.isPending) return <Navigate to={next} replace />

  function submit(e: FormEvent) {
    e.preventDefault()
    signup.mutate(form, {
      onSuccess: (u) => { toast('Welcome to Dora, ' + u.handle); navigate(next, { replace: true }) },
      onError: (err) => toast(err.message, 'err'),
    })
  }

  return (
    <AuthFrame label="Dora · create an account" title={<>Start your<br />shelf.</>} sub="Scan your books, track your reading, and share your shelf.">
      <GoogleButton />
      <form onSubmit={submit}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="First name" id="firstname" autoComplete="given-name" required placeholder="Jane" value={form.firstname} onChange={set('firstname')} /></div>
          <div style={{ flex: 1 }}><Field label="Last name" id="lastname" autoComplete="family-name" placeholder="Smith" value={form.lastname} onChange={set('lastname')} /></div>
        </div>
        <Field label="Email" id="email" type="email" autoComplete="email" required placeholder="you@example.com" value={form.email} onChange={set('email')} />
        <PasswordField label="Password" id="password" autoComplete="new-password" required minLength={8} placeholder="At least 8 characters" value={form.password} onChange={set('password')} />
        <button type="submit" className="f-btn f-btn--amber f-btn--block" style={{ marginTop: 6 }} disabled={signup.isPending}>
          {signup.isPending ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
      <FormFooter>
        Already have an account? <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} style={footerLink}>Sign in</Link>
      </FormFooter>
    </AuthFrame>
  )
}
