import { useState } from 'react'
import type { BackendSource } from './backend'
import { apiFetch, sourceFileUrl } from './backend'
import { Icon } from './ui'

/** Authenticated API downloads and signed storage URLs share one frontend control. */
export default function SourceFileButton({ source }: { source: BackendSource }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (source.preview_available === false) return <span className="source-file-unavailable">Original file unavailable here. The stored quotation and location remain available.</span>
  if (!source.preview_url) return <span className="source-file-unavailable">Original file unavailable.</span>
  async function download() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const url = sourceFileUrl(source.preview_url)
      // Never send a company API token to a signed storage URL on another host.
      const response = source.preview_url.startsWith('/')
        ? await apiFetch(source.preview_url, { headers: { Accept: 'application/octet-stream' } })
        : await fetch(url, { credentials: 'omit', redirect: 'error' })
      if (!response.ok) throw new Error('The original file is unavailable. Its saved quotation, hash and location are still recorded.')
      const blob = await response.blob()
      const localUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = localUrl; link.download = source.file_name || 'source-file'; link.click()
      setTimeout(() => URL.revokeObjectURL(localUrl), 10000)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The original file could not be downloaded.') }
    finally { setBusy(false) }
  }
  return <span className="source-file-control"><button className="button secondary" disabled={busy} onClick={download}><Icon name={busy ? 'loading' : 'download'} size={14} />{busy ? 'Downloading…' : 'Download original'}</button>{error && <small role="alert">{error}</small>}</span>
}
