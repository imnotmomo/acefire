import { apiFetch, sourceFileUrl } from './backend.ts'
import type { BackendSource } from './backend'

export function sourceFileKind(filename: string): 'pdf' | 'image' | 'text' | 'workbook' | 'download' {
  if (/\.pdf$/i.test(filename)) return 'pdf'
  if (/\.(png|jpe?g|gif|webp)$/i.test(filename)) return 'image'
  if (/\.(json|csv|txt|tsv|md)$/i.test(filename)) return 'text'
  if (/\.xlsx$/i.test(filename)) return 'workbook'
  return 'download'
}
export function sourcePage(source: BackendSource): number | null {
  const page = source.locator?.page ?? source.locator?.physical_page
  return typeof page === 'number' && Number.isSafeInteger(page) && page > 0 ? page : null
}
export async function loadSourceFile(source: BackendSource, signal?: AbortSignal): Promise<Blob> {
  const url = sourceFileUrl(source.preview_url)
  const response = source.preview_url.startsWith('/')
    ? await apiFetch(source.preview_url, { signal, headers: { Accept: 'application/octet-stream' } })
    : await fetch(url, { signal, credentials: 'omit', redirect: 'error' })
  if (!response.ok) throw new Error('The original file is unavailable. Its saved quotation and location are still recorded.')
  if (Number(response.headers.get('Content-Length')) > 50_000_000) throw new Error('This file is too large for an inline preview. Use its original download.')
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 50_000_000) throw new Error('This file exceeds the preview size limit.')
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('')
  if (digest !== source.sha256) throw new Error('The file does not match the version cited by this evidence. The preview was blocked.')
  const kind = sourceFileKind(source.file_name)
  const type = kind === 'pdf' ? 'application/pdf' : kind === 'text' ? 'text/plain;charset=utf-8'
    : kind === 'image' && /^image\/(png|jpeg|gif|webp)(?:;|$)/i.test(response.headers.get('Content-Type') || '') ? response.headers.get('Content-Type')! : 'application/octet-stream'
  return new Blob([bytes], { type })
}
