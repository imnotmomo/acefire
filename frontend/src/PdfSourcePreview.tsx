import { useEffect, useState } from 'react'
import type { BackendSource } from './backend'
import { apiFetch } from './backend'
import { sourcePage } from './sourceFile'
import { Icon } from './ui'

type Page = { page: number; page_count: number; width: number; height: number; url: string }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Read-only raster pages work in browsers without a built-in PDF plug-in. */
export default function PdfSourcePreview({ source }: { source: BackendSource }) {
  const [page, setPage] = useState(sourcePage(source) ?? 1), [input, setInput] = useState(String(sourcePage(source) ?? 1))
  const [image, setImage] = useState<Page | null>(null), [count, setCount] = useState(0)
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [inputError, setInputError] = useState('')
  const [attempt, setAttempt] = useState(0), [zoom, setZoom] = useState(100)
  useEffect(() => {
    const controller = new AbortController(); let url = '', active = true
    setBusy(true); setError(''); setImage(null)
    const timer = setTimeout(() => { controller.abort(); if (active) { setBusy(false); setError('The PDF page took too long to render. Retry or download the original file.') } }, 20_000)
    void (async () => {
      try {
        const response = await apiFetch(`/sources/${encodeURIComponent(source.snapshot_id)}/pdf-preview?page=${page}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The PDF service returned an unreadable preview. Retry or download the original.')
        const value: unknown = await response.json()
        if (!response.ok) {
          const detail = object(value) ? value.detail : undefined
          throw new Error(typeof detail === 'string' ? detail.slice(0, 600) : 'The PDF page could not be rendered. Retry or download the original.')
        }
        if (!object(value) || value.snapshot_id !== source.snapshot_id || value.sha256 !== source.sha256 || value.page !== page
          || !Number.isSafeInteger(value.page_count) || Number(value.page_count) < page || Number(value.page_count) > 100_000
          || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || Number(value.width) < 1 || Number(value.width) > 1600 || Number(value.height) < 1 || Number(value.height) > 8192 || Number(value.width) * Number(value.height) > 4_000_000
          || typeof value.png_base64 !== 'string' || !value.png_base64 || value.png_base64.length > 11_184_812 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.png_base64)) throw new Error('The PDF preview did not match this original source and page. No page was displayed.')
        const bytes = Uint8Array.from(atob(value.png_base64), character => character.charCodeAt(0))
        const signature = [137, 80, 78, 71, 13, 10, 26, 10]
        if (bytes.length < 24 || bytes.length > 8 * 1024 * 1024 || !signature.every((byte, index) => bytes[index] === byte)) throw new Error('The PDF service returned an invalid page image.')
        const header = new DataView(bytes.buffer)
        if (header.getUint32(16) !== value.width || header.getUint32(20) !== value.height) throw new Error('The PDF page dimensions do not match its image.')
        if (!active || controller.signal.aborted) return
        url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
        setCount(Number(value.page_count)); setImage({ page, page_count: Number(value.page_count), width: Number(value.width), height: Number(value.height), url })
      } catch (reason) { if (active && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The PDF page could not be rendered.') }
      finally { clearTimeout(timer); if (active && !controller.signal.aborted) setBusy(false) }
    })()
    return () => { active = false; clearTimeout(timer); controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [source.snapshot_id, source.sha256, page, attempt])
  function change(next: number) { setInput(String(next)); setInputError(''); setPage(next) }
  return <div className="source-pdf-pages" aria-label={`PDF pages: ${source.file_name}`}>
    <div className="source-pdf-controls">
      <button className="button secondary" disabled={busy || page <= 1} onClick={() => change(page - 1)}>Previous page</button>
      <form onSubmit={event => { event.preventDefault(); const next = Number(input); if (!/^\d+$/.test(input) || !Number.isSafeInteger(next) || next < 1 || count && next > count) { setInputError(`Enter a page from 1 to ${count || 'the end of the document'}.`); return }; if (next === page) setAttempt(value => value + 1); else change(next) }}><label>PDF page<input aria-label="PDF page number" inputMode="numeric" value={input} disabled={busy} onChange={event => { setInput(event.target.value); setInputError('') }} /></label><span>of {count || '…'}</span><button className="button secondary" type="submit" disabled={busy}>Go to page</button></form>
      <button className="button secondary" disabled={busy || !count || page >= count} onClick={() => change(page + 1)}>Next page</button>
      <label>Zoom<select aria-label="PDF page zoom" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[75, 100, 125, 150, 200, 300, 400].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>
    </div>
    {inputError && <p className="form-error" role="alert">{inputError}</p>}
    {busy ? <div className="source-preview-message" role="status"><Icon name="loading" />Rendering source page {page}…</div> : error ? <div className="source-preview-message" role="alert"><span>{error}</span><button className="button secondary" onClick={() => setAttempt(value => value + 1)}>Retry PDF preview</button>{page !== 1 && <button className="button secondary" onClick={() => change(1)}>Go to first page</button>}</div> : image && <><p className="source-pdf-basis">Page {image.page} of {image.page_count} · Static preview of the hash-checked original. Download the original for interactive fields or attachments.</p><div className="source-pdf-scroll"><img style={{ width: `${zoom}%` }} src={image.url} alt={`Original PDF page ${image.page} of ${image.page_count}: ${source.file_name}`} onError={() => setError('The rendered PDF image could not be decoded. Retry the preview or download the original.')} /></div></>}
  </div>
}
