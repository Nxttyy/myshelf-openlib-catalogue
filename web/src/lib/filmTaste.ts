/* Ask Dora for films: one shared answer per film, so a verdict asked from a
   list row also shows on its queue chip and its record. askFilms() takes
   any number of films; the server answers cached ones at once and groups
   the rest into runs of up to 8, which this polls until they finish. */

import { useSyncExternalStore } from 'react'
import { askDoraFilms, pollDoraFilms, type FilmVerdict } from '../api/films'
import { ApiError } from '../api/client'

export type FilmTasteState = { s: 'asking' } | { s: 'done'; v: FilmVerdict } | { s: 'error'; msg: string }

const states = new Map<string, FilmTasteState>()
const listeners = new Set<() => void>()
let version = 0

function set(ids: string[], state: FilmTasteState) {
  ids.forEach((id) => states.set(id, state))
  version++
  listeners.forEach((l) => l())
}

function message(err: unknown) {
  if (err instanceof ApiError && err.status === 401) return 'Sign in to ask Dora'
  if (err instanceof ApiError && err.status === 503) return "Ask Dora isn't set up yet"
  return (err as Error).message === 'timeout' ? 'Dora took too long. Try again?' : "Dora couldn't decide. Try again?"
}

async function follow(runId: string, ids: string[]) {
  try {
    for (let n = 0; n < 40; n++) {
      await new Promise((r) => setTimeout(r, 3000))
      const res = await pollDoraFilms(runId)
      if (res.status === 'running') continue
      Object.entries(res.verdicts).forEach(([id, v]) => set([id], { s: 'done', v }))
      const unanswered = ids.filter((id) => !(id in res.verdicts))
      if (unanswered.length) set(unanswered, { s: 'error', msg: "Dora couldn't decide. Try again?" })
      return
    }
    throw new Error('timeout')
  } catch (err) {
    set(ids, { s: 'error', msg: message(err) })
  }
}

/** Ask about films not already asked (or answered). Errors can be asked again. */
export async function askFilms(imdbIds: string[]) {
  const ids = [...new Set(imdbIds)].filter((id) => {
    const s = states.get(id)?.s
    return s !== 'asking' && s !== 'done'
  })
  if (!ids.length) return
  set(ids, { s: 'asking' })
  try {
    const { runs, verdicts, failed } = await askDoraFilms(ids)
    Object.entries(verdicts).forEach(([id, v]) => set([id], { s: 'done', v }))
    if (failed.length) set(failed, { s: 'error', msg: "Couldn't find that film's details" })
    // Films already on the shelf get no answer: there's nothing to decide.
    const inRuns = new Set(runs.flatMap((r) => r.imdb_ids))
    ids.filter((id) => states.get(id)?.s === 'asking' && !inRuns.has(id)).forEach((id) => states.delete(id))
    set([], { s: 'asking' })
    await Promise.all(runs.map((r) => follow(r.run_id, r.imdb_ids)))
  } catch (err) {
    set(ids, { s: 'error', msg: message(err) })
  }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function useFilmTaste(imdbId: string): FilmTasteState | undefined {
  useSyncExternalStore(subscribe, () => version)
  return states.get(imdbId)
}
