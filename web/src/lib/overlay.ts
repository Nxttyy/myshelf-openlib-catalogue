import { useLocation, useNavigate, useSearchParams } from 'react-router'

/** An overlay (book record, add dialog, ...) addressed by a search param,
    e.g. ?book=<id>. Opening pushes a history entry, so the phone's Back
    button or swipe closes the overlay instead of leaving the page. */
export function useOverlay(name: string) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const value = params.get(name)

  function open(v: string, { replace = false } = {}) {
    setParams((p) => { p.set(name, v); return p }, {
      replace, preventScrollReset: true, state: { overlay: name },
    })
  }

  function close() {
    // Opened from inside the app: step back so Forward/Back stay coherent.
    // Opened from a pasted link: there's nothing of ours to go back to.
    if ((location.state as { overlay?: string } | null)?.overlay === name) navigate(-1)
    else setParams((p) => { p.delete(name); return p }, { replace: true, preventScrollReset: true })
  }

  return { value, open, close }
}

export const useOpenAdd = () => {
  const { open } = useOverlay('add')
  return () => open('scan')
}
