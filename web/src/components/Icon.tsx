import type { CSSProperties } from 'react'
import { GOOGLE_G, ICONS, type IconName } from './icons'

// `sw` (stroke width) is kept for call sites written against the old stroked
// set; Phosphor glyphs have one fixed weight, as in the design's icon font.
type Props = { name: IconName; size?: number; sw?: number; style?: CSSProperties }

export function Icon({ name, size = 20, style }: Props) {
  const google = name === 'google'
  return (
    <svg
      width={size} height={size} viewBox={google ? '0 0 24 24' : '0 0 256 256'} fill="currentColor"
      style={{ flexShrink: 0, ...style }} aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: google ? GOOGLE_G : ICONS[name] }}
    />
  )
}
