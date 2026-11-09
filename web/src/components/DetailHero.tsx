/* The record's header, from the design's v2.jsx DetailHero ("blur", its
   default): one cover shown twice, sharp beside the title and blown up into
   a blurred band behind it, with the close button over the band. */

import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function DetailHero({ onClose, cover, blur, children }: {
  onClose: () => void; cover: ReactNode; blur: ReactNode; children: ReactNode
}) {
  return (
    <div className="dh dh--blur dh--light">
      <div className="band" aria-hidden="true">
        <div className="src">{blur}</div>
        <span className="veil" />
      </div>
      <div className="head"><button className="f-iconbtn" onClick={onClose} aria-label="Close" data-autofocus><Icon name="close" size={20} /></button></div>
      <div className="row"><div className="cov">{cover}</div>{children}</div>
    </div>
  )
}
