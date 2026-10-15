import type { ReactNode } from 'react'
import { FILM_LABELS } from '../lib/films'

export type ReadingStatus = 'unread' | 'reading' | 'read'

const LABELS: Record<ReadingStatus, string> = { unread: 'Unread', reading: 'Reading', read: 'Read' }

export function StatusBadge({ status, animate, film }: { status: ReadingStatus; animate?: boolean; film?: boolean }) {
  return (
    <span className="f-status" data-s={status}>
      {/* keyed so the pip re-mounts and replays its pop on every change */}
      <span className={'pip' + (animate ? ' pop' : '')} key={status} />
      {(film ? FILM_LABELS : LABELS)[status]}
    </span>
  )
}

export function SubjectPill({ children }: { children: ReactNode }) {
  return <span className="f-pill">{children}</span>
}
