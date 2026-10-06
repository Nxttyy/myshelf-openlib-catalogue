import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { components } from './schema'

export type Me = components['schemas']['MeRead']

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me | null>('/auth/me'),
    staleTime: 5 * 60_000,
  })
}

// Names can be empty (some Google accounts come through without one), so
// fall back to the handle's first letter.
export function initials(p: Pick<Me, 'firstname' | 'lastname' | 'handle'>) {
  const fromName = (p.firstname.trim()[0] ?? '') + (p.lastname.trim()[0] ?? '')
  return (fromName || p.handle[0] || '?').toUpperCase()
}
