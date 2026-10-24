import { lazy, Suspense, useEffect, useState } from 'react'
import App from './App'

const Landing = lazy(() => import('./Landing'))

export default function Site() {
  const [hash, setHash] = useState(() => window.location.hash)
  const isWorkspace = /^#\/(projects(?:$|[/?])|project\/)/.test(hash)

  useEffect(() => {
    const update = () => setHash(window.location.hash)
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.screen = isWorkspace ? 'workspace' : 'landing'
    document.title = isWorkspace ? 'Ingenium | Evidence workspace' : 'Ingenium — Trusted diligence, powered by the world’s evidence.'
    if (isWorkspace || hash === '' || hash === '#/' || hash === '#') window.scrollTo(0, 0)
  }, [isWorkspace, hash])

  return isWorkspace ? <App /> : <Suspense fallback={<div className="ig-loading" role="status">Opening Ingenium…</div>}><Landing /></Suspense>
}
