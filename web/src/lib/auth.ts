export const footerLink = { fontWeight: 600, color: 'var(--ink)', textDecoration: 'underline' } as const

/** Only follow same-site paths from ?next=, never an outside URL. */
export function safeNext(raw: string | null, fallback: string) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : fallback
}
