import { useEffect, useRef, useState } from 'react'
import { askDora, type AskCandidate, type Verdict } from '../../api/add'
import { ApiError } from '../../api/client'

type State = { s: 'idle' } | { s: 'asking' } | { s: 'done'; v: Verdict } | { s: 'error'; msg: string }

export function useAskDora(candidate: AskCandidate) {
  const [state, setState] = useState<State>({ s: 'idle' })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  async function ask() {
    abort.current = new AbortController()
    setState({ s: 'asking' })
    try {
      setState({ s: 'done', v: await askDora(candidate, abort.current.signal) })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      const msg = err instanceof ApiError && err.status === 401 ? 'Sign in to ask Dora'
        : (err as Error).message === 'timeout' ? 'Dora took too long. Try again?'
        : "Dora couldn't decide. Try again?"
      setState({ s: 'error', msg })
    }
  }
  return { state, ask }
}

