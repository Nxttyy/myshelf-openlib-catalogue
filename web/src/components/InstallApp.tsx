/* Install as app: the banner under the nav and its steps sheet, from the
   design's folio/v2.jsx InstallCTA. Dismissing the banner is remembered per
   device; the account menu's "Install app" opens the sheet any time. Neither
   shows once Dora is running as an installed app. */

import { hideInstallBanner, openInstallSteps, setInstall, useInstall, useInstalled } from '../lib/install'
import { Icon } from './Icon'

const SHARE_SVG = <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" /></svg>
const ADD_SVG = <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8.5v7M8.5 12h7" /></svg>

type Step = [icon: React.ReactNode, title: string, sub: string, mock?: boolean]

export function InstallBanner({ mobile }: { mobile: boolean }) {
  const hidden = useInstall((s) => s.hidden)
  const installed = useInstalled()
  if (hidden || installed) return null
  return (
    <div className="inst">
      <span className="inst-ic"><img src="/icons/dora-192.png" alt="" width={mobile ? 32 : 36} height={mobile ? 32 : 36} style={{ borderRadius: 8, display: 'block' }} /></span>
      <div className="inst-tx"><b>Install as app</b><span>No download required</span></div>
      <button className="f-btn f-btn--amber inst-go" onClick={openInstallSteps}>How</button>
      <button className="inst-x" onClick={hideInstallBanner} aria-label="Hide"><Icon name="close" size={15} /></button>
    </div>
  )
}

export function InstallSheet({ mobile }: { mobile: boolean }) {
  const open = useInstall((s) => s.open)
  if (!open) return null
  const close = () => setInstall({ open: false })
  const steps: Step[] = mobile ? [
    [SHARE_SVG, 'Tap Share', 'In Safari it sits in the bottom bar. In Chrome, top right.'],
    [ADD_SVG, 'Tap Add to Home Screen', 'Scroll down the list to find it.', true],
    [null, 'Tap Add', 'Dora now opens full screen from your home screen.'],
  ] : [
    [ADD_SVG, 'Chrome or Edge: click Install', 'The icon sits at the right end of the address bar.'],
    [null, 'Safari on Mac: File, then Add to Dock', 'Dora gets its own window and Dock icon.'],
  ]
  return (
    <>
      <div className="inst-scrim" onClick={close} />
      <div className={'inst-sheet' + (mobile ? ' m' : '')} role="dialog" aria-modal="true" aria-label="Install Dora"
        onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
        <div className="inst-hd">
          <h3>{mobile ? 'Add Dora to your home screen' : 'Install Dora'}</h3>
          <button className="f-iconbtn" onClick={close} aria-label="Close" autoFocus><Icon name="close" size={18} /></button>
        </div>
        <ol className="inst-steps">
          {steps.map(([ic, t, s, mock], i) => (
            <li key={i}>
              <span className="n">{i + 1}</span>
              <div className="b">
                <div className="t">{t}{ic && !mock && <span className="chip">{ic}</span>}</div>
                <div className="s">{s}</div>
                {mock && <div className="mock"><span className="row dim">Add to Bookmarks</span><span className="row on">{ic}Add to Home Screen</span><span className="row dim">Add to Quick Note</span></div>}
              </div>
            </li>
          ))}
        </ol>
        <button className="f-btn f-btn--ink f-btn--block" onClick={close}>Done</button>
      </div>
    </>
  )
}
