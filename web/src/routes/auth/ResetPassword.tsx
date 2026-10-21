/* Where the reset email's link lands. Not drawn in the design; built from
   the same parts as the other auth pages. */

import { useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { useResetPassword } from '../../api/queries'
import { MIN_PASSWORD, useTouched } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { useIsDesktop } from '../../lib/useMediaQuery'
import { Alert, AuthCard, AuthLink, PasswordField, Submit } from './AuthForm'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const reset = useResetPassword()
  const toast = useToast()
  const navigate = useNavigate()
  const desktop = useIsDesktop()
  const [password, setPassword] = useState('')
  const [expired, setExpired] = useState(false)
  const { tried, setTried } = useTouched<'pw'>()
  const ref = useRef<HTMLInputElement>(null)

  if (!token) {
    return (
      <AuthCard title="This link is incomplete" sub="The reset code is missing from it. Open the link from the email again, or ask for a new one.">
        <AuthLink to="/forgot-password" className="f-btn f-btn--amber f-btn--block au-submit">Send a new link</AuthLink>
      </AuthCard>
    )
  }

  const err = password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters` : null

  function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true); setExpired(false)
    if (err || !token) return ref.current?.focus()
    reset.mutate({ token, new_password: password }, {
      onSuccess: () => { toast('Password updated. Sign in with your new one.'); navigate('/login', { replace: true }) },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 400) setExpired(true)
        else toast(e.message, 'err')
      },
    })
  }

  return (
    <AuthCard title="Choose a new password" sub="You'll use it the next time you sign in."
      footer={<AuthLink to="/login">Back to sign in</AuthLink>}>
      <form noValidate onSubmit={submit}>
        <PasswordField id="au-pw" label="New password" autoComplete="new-password" inputRef={ref} counter autoFocus={desktop}
          value={password} onChange={(e) => setPassword(e.target.value)} error={tried ? err : null} />
        {expired && (
          <Alert>This link has expired or was already used. <AuthLink to="/forgot-password">Send a new one</AuthLink>.</Alert>
        )}
        <Submit busy={reset.isPending} label="Save new password" busyLabel="Saving" />
      </form>
    </AuthCard>
  )
}
