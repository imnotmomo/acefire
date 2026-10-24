import { apiFetch } from './backend.ts'

export type WorkspaceCompany = {
  deal_id: string; entity_key: string; legal_name: string; domain: string; country: string;
  sector?: string; geography?: string; created_at?: string; identifiers?: Record<string, string>;
}
export type CreateCompanyInput = { name: string; sector?: string; geography?: string; deal_id?: string }
export type UploadProvider = 'uploaded' | 'orbis' | 'pitchbook'
export type UploadStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type UploadJob = {
  id: string; status: UploadStatus; deal_id?: string; snapshot_id?: string;
  warnings: string[]; error?: string; observations?: number; claims?: number;
  filename?: string; sha256?: string; created_at?: string;
}
export type SharedUploadJob = UploadJob & { deal_id: string; snapshot_id: string; filename: string; sha256: string; created_at: string }
export const MAX_SHARED_UPLOAD_HISTORY = 100

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,.csv,.tsv,.xlsx,.xls,.xlsm,.txt,.md,.json'
const suffixes = new Set(UPLOAD_ACCEPT.split(','))
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())
const statuses = new Set<UploadStatus>(['queued', 'processing', 'completed', 'failed'])

export class WorkspaceApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export function validateUploadFile(file: Pick<File, 'name' | 'size'>): void {
  if (!file.size) throw new Error('The selected file is empty. Choose a file containing source material.')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Files must be 50 MiB or smaller. Split this source into smaller files and try again.')
  const suffix = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  if (!suffixes.has(suffix)) throw new Error('Choose a PDF, Word or PowerPoint document, image, CSV/TSV, Excel workbook, text, Markdown or JSON file.')
}

async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    if (response.status === 413) throw new WorkspaceApiError('The server rejected this file’s size. Use a smaller file and try again.', response.status)
    throw new Error('The company service did not return JSON. Check the API connection and try again.')
  }
  const payload: unknown = await response.json()
  if (!response.ok) {
    const detail = object(payload) ? payload.detail : undefined
    const message = typeof detail === 'string' ? detail : object(detail) && typeof detail.message === 'string' ? detail.message : `The company service returned HTTP ${response.status}. Try again when it is available.`
    throw new WorkspaceApiError(message.slice(0, 600), response.status)
  }
  return payload
}

function company(value: unknown): WorkspaceCompany {
  if (!object(value) || !['deal_id', 'entity_key', 'legal_name', 'domain', 'country'].every(key => typeof value[key] === 'string') || !nonempty(value.deal_id) || !nonempty(value.entity_key) || !nonempty(value.legal_name)) throw new Error('The company service returned an unsupported company record.')
  if (value.deal_id.includes('/') || value.deal_id.length > 200) throw new Error('The company service returned an invalid company identifier.')
  return value as WorkspaceCompany
}

export async function listCompanies(signal?: AbortSignal): Promise<WorkspaceCompany[]> {
  const payload = await jsonResponse(await apiFetch('/deals', { signal, headers: { Accept: 'application/json' }, cache: 'no-store' }))
  if (!object(payload) || !Array.isArray(payload.companies)) throw new Error('The company service did not return its company list.')
  const rows = payload.companies.map(company)
  if (new Set(rows.map(row => row.deal_id)).size !== rows.length) throw new Error('The company list contains duplicate identifiers.')
  return rows
}

export async function createCompany(input: CreateCompanyInput, signal?: AbortSignal): Promise<WorkspaceCompany> {
  const name = input.name.trim()
  if (!name || name.length > 100) throw new Error('Enter a company name of 1–100 characters.')
  let payload: unknown
  try {
    const response = await apiFetch('/deals', { method: 'POST', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, name }) })
    payload = await jsonResponse(response)
    if (response.status !== 201) throw new Error('The service did not confirm creation of the company workspace. Retry without changing the company details.')
  } catch (error) {
    if (error instanceof WorkspaceApiError && error.status === 409 && input.deal_id) {
      // A previous request may have succeeded before its response was interrupted.
      // Recover only the same immutable ID and the same human-supplied metadata.
      const existing = (await listCompanies(signal)).find(row => row.deal_id === input.deal_id)
      if (existing?.legal_name === name
        && (!input.sector || existing.identifiers?.workspace_sector === input.sector || existing.sector === input.sector)
        && (!input.geography || existing.identifiers?.workspace_geography === input.geography || existing.geography === input.geography || existing.country === input.geography)) return existing
    }
    throw error
  }
  const result = company(object(payload) ? payload.company : null)
  if (input.deal_id && result.deal_id !== input.deal_id) throw new Error('The created company has a different identifier from the requested project.')
  return result
}

function count(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function parseUploadJob(value: unknown, dealId: string, expectedId?: string): UploadJob {
  if (!object(value) || !nonempty(value.id) || value.id.length > 200 || typeof value.status !== 'string' || !statuses.has(value.status as UploadStatus)) throw new Error('The upload service returned an unsupported processing job.')
  if (expectedId && value.id !== expectedId || value.deal_id !== undefined && value.deal_id !== dealId) throw new Error('This processing job belongs to a different company or upload.')
  if (value.warnings !== undefined && (!Array.isArray(value.warnings) || !value.warnings.every(item => typeof item === 'string'))) throw new Error('The upload service returned invalid source warnings.')
  if (value.observations !== undefined && count(value.observations) === undefined || value.claims !== undefined && count(value.claims) === undefined) throw new Error('The upload service returned invalid processing counts.')
  if (value.filename !== undefined && (!nonempty(value.filename) || value.filename.length > 2000)
    || value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256))
    || value.created_at !== undefined && (typeof value.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.created_at) || !Number.isFinite(Date.parse(value.created_at)))) throw new Error('The upload service returned invalid source receipt metadata.')
  const error = typeof value.error === 'string' ? value.error : object(value.error) && typeof value.error.message === 'string' ? value.error.message : undefined
  return { id: value.id, status: value.status as UploadStatus, deal_id: dealId,
    ...(typeof value.snapshot_id === 'string' ? { snapshot_id: value.snapshot_id } : {}),
    warnings: (value.warnings ?? []) as string[], ...(error ? { error: error.slice(0, 800) } : {}),
    ...(count(value.observations) !== undefined ? { observations: count(value.observations) } : {}),
    ...(count(value.claims) !== undefined ? { claims: count(value.claims) } : {}),
    ...(typeof value.filename === 'string' ? { filename: value.filename } : {}),
    ...(typeof value.sha256 === 'string' ? { sha256: value.sha256 } : {}),
    ...(typeof value.created_at === 'string' ? { created_at: value.created_at } : {}),
  }
}

export async function listUploadJobs(dealId: string, signal?: AbortSignal): Promise<SharedUploadJob[]> {
  const payload = await jsonResponse(await apiFetch(`/deals/${encodeURIComponent(dealId)}/uploads`, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' }))
  if (!object(payload) || !Array.isArray(payload.uploads) || payload.uploads.length > 10_000) throw new Error('The upload service returned an unsupported shared processing history.')
  const rows = payload.uploads.map(value => {
    const job = parseUploadJob(value, dealId)
    if (job.deal_id !== dealId || !object(value) || value.deal_id !== dealId || !job.snapshot_id || !job.filename || !job.sha256 || !job.created_at) throw new Error('Shared processing history is missing its company or original-file receipt.')
    return job as SharedUploadJob
  })
  if (new Set(rows.map(job => job.id)).size !== rows.length) throw new Error('Shared processing history contains duplicate upload identifiers.')
  const active = (job: UploadJob) => job.status === 'queued' || job.status === 'processing'
  return rows.sort((a, b) => Number(active(b)) - Number(active(a)) || Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, MAX_SHARED_UPLOAD_HISTORY)
}

export async function uploadCompanyFile(dealId: string, file: File, provider: UploadProvider = 'uploaded', signal?: AbortSignal): Promise<UploadJob> {
  validateUploadFile(file)
  const body = new FormData(); body.append('file', file); body.append('provider', provider)
  const payload = await jsonResponse(await apiFetch(`/deals/${encodeURIComponent(dealId)}/uploads`, { method: 'POST', signal, headers: { Accept: 'application/json' }, body }))
  return parseUploadJob(payload, dealId)
}

export async function fetchUploadJob(dealId: string, jobId: string, signal?: AbortSignal): Promise<UploadJob> {
  const payload = await jsonResponse(await apiFetch(`/deals/${encodeURIComponent(dealId)}/uploads/${encodeURIComponent(jobId)}`, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' }))
  return parseUploadJob(payload, dealId, jobId)
}
