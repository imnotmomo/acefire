import { apiFetch } from './backend.ts'

export type CompanyLogo = { status: 'awaiting_website' | 'fetching' | 'ready' | 'unavailable'; domain: string | null; sha256: string | null; asset_path: string | null; error_code?: string }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** A user-supplied public host, never a guessed company name or a source sentence. */
export function normalizeCompanyWebsite(value: string): string {
  const invalid = () => { throw new Error('Enter a public company website, such as example.com. Private addresses, credentials and custom ports are not supported.') }
  const input = value.trim()
  if (!input || input.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(input)) return invalid()
  let parsed: URL
  try { parsed = new URL(input.includes('://') ? input : `https://${input}`) } catch { return invalid() }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return invalid()
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  const labels = host.split('.')
  if (host.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels.at(-1)!)
    || ['localhost', 'local', 'localdomain', 'internal', 'lan', 'home', 'corp', 'invalid', 'test', 'example', 'onion'].includes(labels.at(-1)!)
    || ['home.arpa', 'in-addr.arpa', 'ip6.arpa'].some(suffix => host === suffix || host.endsWith(`.${suffix}`))
    || ['linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com'].some(site => host === site || host.endsWith(`.${site}`))) return invalid()
  return host
}

export function parseCompanyLogo(value: unknown, dealId: string): CompanyLogo | undefined {
  if (value === undefined || value === null) return undefined
  if (!object(value) || !['awaiting_website', 'fetching', 'ready', 'unavailable'].includes(String(value.status))
    || value.domain !== null && (typeof value.domain !== 'string' || normalizeCompanyWebsite(value.domain) !== value.domain)
    || value.sha256 !== null && !hash(value.sha256)
    || value.asset_path !== null && typeof value.asset_path !== 'string'
    || value.error_code !== undefined && (typeof value.error_code !== 'string' || value.error_code.length > 100)) throw new Error('The company icon metadata is invalid. The default cover is retained.')
  if (value.status === 'ready' && (!hash(value.sha256) || !value.domain || value.asset_path !== `/deals/${encodeURIComponent(dealId)}/logo/image/${value.sha256}`)) throw new Error('The company icon does not belong to this workspace.')
  if (value.status !== 'ready' && (value.sha256 !== null || value.asset_path !== null)) throw new Error('The company icon has an inconsistent cache state.')
  return value as CompanyLogo
}
async function logoResponse(response: Response, dealId: string): Promise<CompanyLogo | undefined> {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The company icon service did not return a readable response.')
  const payload: unknown = await response.json()
  if (!response.ok) throw new Error(object(payload) && typeof payload.detail === 'string' ? payload.detail.slice(0, 400) : 'The company icon could not be updated. The default cover is retained.')
  return parseCompanyLogo(object(payload) ? payload.logo : undefined, dealId)
}
async function boundedRequest<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(), cancel = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 8000)
  try { return await work(controller.signal) }
  catch (error) { if (controller.signal.aborted && !signal?.aborted) throw new Error('The company icon service took too long. Your default cover is retained.'); throw error }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
export async function cachedCompanyLogo(dealId: string, signal?: AbortSignal) {
  return boundedRequest(signal, async requestSignal => logoResponse(await apiFetch(`/deals/${encodeURIComponent(dealId)}/logo`, { signal: requestSignal, headers: { Accept: 'application/json' }, cache: 'no-store' }), dealId))
}
export async function setCompanyLogoWebsite(dealId: string, website: string, signal?: AbortSignal) {
  const domain = normalizeCompanyWebsite(website)
  return boundedRequest(signal, async requestSignal => logoResponse(await apiFetch(`/deals/${encodeURIComponent(dealId)}/logo/website`, { method: 'POST', signal: requestSignal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ website: domain }) }), dealId))
}
export async function companyLogoBlob(logo: CompanyLogo, dealId: string, signal?: AbortSignal): Promise<Blob> {
  const checked = parseCompanyLogo(logo, dealId)
  if (checked?.status !== 'ready' || !checked.asset_path || !checked.sha256) throw new Error('No cached company icon is available.')
  return boundedRequest(signal, async requestSignal => {
  const response = await apiFetch(checked.asset_path!, { signal: requestSignal, headers: { Accept: 'image/png' }, cache: 'force-cache' })
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/png' || Number(response.headers.get('content-length')) > 524288) throw new Error('The cached company icon could not be loaded.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length < 24 || bytes.length > 524288 || ![137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) throw new Error('The cached company icon is not a supported image.')
  const header = new DataView(bytes.buffer), width = header.getUint32(16), height = header.getUint32(20)
  if (!width || !height || width > 512 || height > 512) throw new Error('The cached company icon exceeds its image bounds.')
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  if (digest !== checked.sha256) throw new Error('The cached company icon failed its integrity check.')
  return new Blob([bytes], { type: 'image/png' })
  })
}
