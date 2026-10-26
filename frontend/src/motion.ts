import { useEffect, useRef } from 'react'

/** Animate navigation without replacing the workspace or its open editors. */
export function usePageMotion(pathname: string) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof element.animate !== 'function') return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animation: Animation | undefined
    const stop = () => { animation?.cancel(); animation = undefined }

    if (!preference.matches) {
      // Only page content moves. Docks stay outside; dialogs portal to the body.
      animation = element.animate([
        { opacity: 0.2, transform: 'translateY(12px)' },
        { opacity: 1, transform: 'none' },
      ], {
        duration: 320, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      })
      animation.id = 'ingenium-page-enter'
    }
    preference.addEventListener('change', stop)
    return () => { stop(); preference.removeEventListener('change', stop) }
  }, [pathname])

  return ref
}
