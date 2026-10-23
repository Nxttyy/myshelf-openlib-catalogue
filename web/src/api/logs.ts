/* The people you read or watch with, named in diary logs. Private to you;
   the log itself saves with the shelf entry (shelf.ts / films.ts). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Companion } from './types'

const KEY = ['companions']

export function useCompanions(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<Companion[]>('/companions'), enabled })
}

export function useAddCompanion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.post<Companion>('/companions', { name }),
    onSuccess: (c) => qc.setQueryData<Companion[]>(KEY, (list) => [...(list ?? []), c]),
  })
}
