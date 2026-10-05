import type { CSSProperties } from 'react'
import { ICONS, type IconName } from './icons'

type Props = { name: IconName; size?: number; sw?: number; style?: CSSProperties }

export function Icon({ name, size = 20, sw = 1.5, style }: Props) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  )
}
