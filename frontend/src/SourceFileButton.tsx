import { useState } from 'react'
import type { BackendSource } from './backend'
import { loadSourceFile } from './sourceFile'
import { Icon } from './ui'

/** Authenticated API downloads and signed storage URLs share one frontend control. */
export default function SourceFileButton({ source, onOpen }: { source: BackendSource; onOpen?: (source: BackendSource) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (source.preview_available === false) return <span className="source-file-actions">{onOpen && <button className="button secondary" disabled><Icon name="external" size={14} />Open file</button>}<span className="source-file-unavailable">Original file unavailable here. The stored quotation and location remain available.</span></span>
  if (!source.preview_url) return <span className="source-file-unavailable">Original file unavailable.</span>
  async function download() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const blob = await loadSourceFile(source)
      const localUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = localUrl; link.download = source.file_name || 'source-file'; link.click()
      setTimeout(() => URL.revokeObjectURL(localUrl), 10000)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The original file could not be downloaded.') }
    finally { setBusy(false) }
  }
  return <span className="source-file-control source-file-actions">{onOpen && <button className="button secondary" onClick={() => onOpen(source)}><Icon name="external" size={14} />Open file</button>}<button className="button secondary" disabled={busy} onClick={download}><Icon name={busy ? 'loading' : 'download'} size={14} />{busy ? 'Downloading…' : 'Download original'}</button>{error && <small role="alert">{error}</small>}</span>
}
