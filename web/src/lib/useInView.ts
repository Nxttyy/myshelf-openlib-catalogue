import { useEffect, useLayoutEffect, useRef } from 'react'

/** Calls onEnter whenever the returned ref's element scrolls into range.
    Used as the "load more" sentinel at the bottom of long lists. */
export function useInView<T extends Element>(onEnter: () => void, rootMargin = '800px') {
  const ref = useRef<T>(null)
  const cb = useRef(onEnter)
  useLayoutEffect(() => { cb.current = onEnter })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) cb.current() }, { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin])
  return ref
}
