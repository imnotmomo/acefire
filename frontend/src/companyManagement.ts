import { apiFetch } from './backend.ts'
import type { WorkspaceCompany } from './workspaceApi'

export type CompanyLabels = { display_name: string; sector: string; geography: string; archived?: boolean }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function company(value: unknown): WorkspaceCompany {
  if (!object(value) || !['deal_id', 'entity_key', 'legal_name', 'domain', 'country'].every(key => typeof value[key] === 'string') || !value.deal_id || !value.legal_name) throw new Error('The service returned an invalid company workspace.')
  if (value.identifiers !== undefined && (!object(value.identifiers) || Object.values(value.identifiers).some(item => typeof item !== 'string'))) throw new Error('Company workspace labels are invalid.')
  return value as WorkspaceCompany
}

async function request(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 30_000)
  try {
    const response = await apiFetch(path, { ...init, signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json', ...init.headers } })
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The company service did not return JSON. Retry when the connection is available.')
    const payload: unknown = await response.json()
    if (!response.ok) throw new Error(object(payload) && typeof payload.detail === 'string' ? payload.detail.slice(0, 500) : `Company request failed (HTTP ${response.status}).`)
    return payload
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('The company service took too long. Refresh the company list before retrying; your request may have been saved.')
    throw error
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}

export async function allCompanies(signal?: AbortSignal): Promise<WorkspaceCompany[]> {
  const payload = await request('/deals?include_archived=true', {}, signal)
  if (!object(payload) || !Array.isArray(payload.companies)) throw new Error('The company service did not return its workspaces.')
  const rows = payload.companies.map(company)
  if (new Set(rows.map(item => item.deal_id)).size !== rows.length) throw new Error('The company list contains duplicate identities.')
  return rows
}

export async function updateCompany(dealId: string, labels: Partial<CompanyLabels>, signal?: AbortSignal): Promise<WorkspaceCompany> {
  for (const key of ['display_name', 'sector', 'geography'] as const) if (labels[key] !== undefined && (!labels[key]!.trim() || labels[key]!.trim().length > 120)) throw new Error('Workspace labels must contain 1–120 characters.')
  const payload = await request(`/deals/${encodeURIComponent(dealId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(labels) }, signal)
  const result = company(object(payload) ? payload.company : null)
  if (result.deal_id !== dealId) throw new Error('The saved settings belong to another company. Refresh the company list.')
  return result
}

export const companyArchived = (value: WorkspaceCompany) => value.identifiers?.workspace_archived === 'true'
