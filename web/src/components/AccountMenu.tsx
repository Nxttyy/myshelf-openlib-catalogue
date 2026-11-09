/* The avatar in the nav and the account menu under it, from the design's
   desktop-app-v2.jsx Navbar: who you are (opens your profile), profile
   visibility, light / dark, share your profile, guide, install, sign out. */

import { useState } from 'react'
import { useNavigate } from 'react-router'
import { initials, type Me } from '../api/me'
import { useLogout } from '../api/queries'
import { useSetProfileVisibility } from '../api/shelf'
import { mediaPath, type Media } from '../lib/media'
import { useTheme } from '../lib/theme'
import { useToast } from '../lib/toast'
import { Icon } from './Icon'
import { openInstallSteps, useInstalled } from '../lib/install'
import { SharePanel, SharePopover } from './Share'

const displayName = (me: Me) => [me.firstname, me.lastname].filter((s) => s.trim()).join(' ') || '@' + me.handle

export function AccountMenu({ me, media }: { me: Me; media: Media }) {
  const [menu, setMenu] = useState(false)
  const [share, setShare] = useState(false)
  const [theme, setTheme] = useTheme()
  const navigate = useNavigate()
  const toast = useToast()
  const logout = useLogout()
  const vis = useSetProfileVisibility()
  const installed = useInstalled()

  const go = (to: string) => { setMenu(false); navigate(to) }
  function setPublic(v: boolean) {
    if (v === me.is_profile_public) return
    vis.mutate(v, {
      onSuccess: () => toast(v ? 'Your shelf is public.' : 'Your shelf is private.'),
      onError: () => toast("Couldn't change that. Try again.", 'err'),
    })
  }
  function signOut() {
    setMenu(false)
    logout.mutate(undefined, {
      onSuccess: () => { toast('Signed out.'); navigate('/', { replace: true }) },
      onError: () => toast("Couldn't sign out. Try again.", 'err'),
    })
  }
  const url = `${window.location.origin}/u/${me.handle}`

  return (
    <div className="d-share-wrap d-avwrap">
      <button className={'d-avatar' + (menu ? ' on' : '')} onClick={() => { setMenu((m) => !m); setShare(false) }}
        aria-label="Account" aria-expanded={menu} aria-haspopup="menu">{initials(me)}</button>
      {menu && <>
        <div className="d-acct-scrim" onClick={() => setMenu(false)} />
        <div className="d-acct" role="menu" onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false) }}>
          <button className="who" role="menuitem" onClick={() => go(mediaPath('/profile', media))}><b>{displayName(me)}</b><span>@{me.handle}</span></button>
          <div className="sep" />
          <div className="vis"><span className="f-label">Profile is</span>
            <div className="d-viewseg" role="group" aria-label="Profile is">
              {([[true, 'Public'], [false, 'Only me']] as const).map(([v, l]) => (
                <button key={l} className={me.is_profile_public === v ? 'on' : ''} aria-pressed={me.is_profile_public === v} onClick={() => setPublic(v)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="vis"><span className="f-label">Theme</span>
            <div className="d-viewseg" role="group" aria-label="Theme">
              {([['light', 'Light'], ['dark', 'Dark']] as const).map(([v, l]) => (
                <button key={l} className={theme === v ? 'on' : ''} aria-pressed={theme === v} onClick={() => setTheme(v)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="sep" />
          <button className="it" role="menuitem" onClick={() => { setMenu(false); setShare(true) }}><Icon name="share" size={15} /> Share profile</button>
          <button className="it" role="menuitem" onClick={() => go('/guide')}><Icon name="guide" size={15} /> Guide</button>
          {!installed && <button className="it" role="menuitem" onClick={() => { setMenu(false); openInstallSteps() }}><Icon name="plus" size={15} /> Install app</button>}
          <div className="sep" />
          <button className="it" role="menuitem" onClick={signOut} disabled={logout.isPending}><Icon name="logout" size={15} /> Sign out</button>
        </div>
      </>}
      {share && (
        <SharePopover onClose={() => setShare(false)}>
          <SharePanel heading="Share your shelf"
            note={me.is_profile_public ? 'People with this link can see your public books and films.' : 'Your shelf is private right now. Make it public so people with the link can see it.'}
            url={url} short={`${window.location.host}/u/${me.handle}`} emailSubject={`${displayName(me)}'s shelf on Dora`}
            onDone={() => setShare(false)} channels />
        </SharePopover>
      )}
    </div>
  )
}
