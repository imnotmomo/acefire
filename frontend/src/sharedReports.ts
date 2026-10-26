import { MODULES } from './data.ts'
import type { ModuleId } from './data.ts'
import type { ModuleConfig, NarrativeCitation, Section, Workspace } from './domain'

export type SharedReportSummary = { id: string; version: number; created_at: string; updated_at: string; based_on_report_id: string; model: string | null; section_count: number }
export type SharedReportRecord = SharedReportSummary & { deal_id: string; draft: unknown; workspace: Workspace | null }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, maximum = 2048): value is string => typeof value === 'string' && value.length <= maximum
const nonempty = (value: unknown, maximum = 2048): value is string => text(value, maximum) && Boolean(value.trim())
const moduleId = (value: unknown): value is ModuleId => MODULES.some(module => module.id === value)
const strings = (value: unknown, maximum = 2000, length = 2048): value is string[] => Array.isArray(value) && value.length <= maximum && value.every(item => nonempty(item, length))
const timestamp = (value: unknown) => nonempty(value, 100) && Number.isFinite(Date.parse(value))

function config(value: unknown): value is ModuleConfig {
  return object(value) && strings(value.topics, 20, 200) && ['Brief', 'Standard', 'Deep'].includes(String(value.depth))
    && nonempty(value.geography, 100) && nonempty(value.horizon, 100)
    && ['Internal only', 'Internal + external'].includes(String(value.scope)) && text(value.focus, 2000)
}
function source(value: unknown, dealId: string): boolean {
  return object(value) && nonempty(value.snapshot_id) && nonempty(value.file_name) && nonempty(value.provider)
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
    && (value.deal_id === undefined || value.deal_id === dealId)
    && (value.locator === undefined || value.locator === null || object(value.locator))
    && (value.preview_url === undefined || text(value.preview_url, 12000))
}
function citation(value: unknown, dealId: string): value is NarrativeCitation {
  return object(value) && nonempty(value.evidence_id) && nonempty(value.quote, 100000)
    && ['statement', 'observation', 'calculation'].includes(String(value.kind))
    && ['source_text', 'structured_record'].includes(String(value.quote_basis))
    && (value.source === undefined || source(value.source, dealId))
    && (value.sources === undefined || Array.isArray(value.sources) && value.sources.length <= 100 && value.sources.every(item => source(item, dealId)))
    && (value.source !== undefined || Array.isArray(value.sources) && value.sources.length > 0)
}
function section(value: unknown, dealId: string): value is Section {
  if (!object(value) || !moduleId(value.id) || !nonempty(value.title, 160) || !text(value.content, 300000)
    || !strings(value.evidenceIds) || !config(value.config)) return false
  if (value.humanEdited !== undefined && typeof value.humanEdited !== 'boolean') return false
  if (value.gaps !== undefined && (!Array.isArray(value.gaps) || value.gaps.length > 300 || !value.gaps.every(gap => text(gap, 4000)))) return false
  if (value.generation !== undefined && (!object(value.generation) || !nonempty(value.generation.draftId)
    || !nonempty(value.generation.model) || !timestamp(value.generation.generatedAt) || value.generation.status !== 'model_generated_unverified')) return false
  return value.sourceClaims === undefined || Array.isArray(value.sourceClaims) && value.sourceClaims.length <= 300 && value.sourceClaims.every(claim => object(claim)
    && nonempty(claim.id) && nonempty(claim.text, 100000) && ['reported_summary', 'inference'].includes(String(claim.kind))
    && Array.isArray(claim.citations) && claim.citations.length > 0 && claim.citations.length <= 100 && claim.citations.every(item => citation(item, dealId))
    && (claim.reviewState === undefined || ['missing', 'verify', 'conflict'].includes(String(claim.reviewState))))
}

/** A saved UI workspace is data, not a trusted React prop tree. */
export function checkedSharedWorkspace(value: unknown, dealId: string, maximumBytes = 450000): Workspace {
  const invalid = () => { throw new Error('The saved report has an unsupported workspace format. Your local draft is preserved.') }
  if (object(value) && new TextEncoder().encode(JSON.stringify(value)).length > maximumBytes) throw new Error('This report exceeds the shared report size limit. Your local draft is preserved; export a complete copy before shortening its text or history.')
  if (!object(value) || !Array.isArray(value.order)
    || value.order.length > 12 || !value.order.every(moduleId) || new Set(value.order).size !== value.order.length
    || !object(value.configs) || Object.entries(value.configs).some(([id, item]) => !moduleId(id) || !config(item))
    || !Array.isArray(value.sections) || value.sections.length > 12 || !value.sections.every(item => section(item, dealId))
    || new Set(value.sections.map(item => item.id)).size !== value.sections.length
    || !Array.isArray(value.revisions) || value.revisions.length > 2000
    || value.revisions.some(item => !object(item) || !nonempty(item.id) || !timestamp(item.at) || !moduleId(item.section)
      || !nonempty(item.title, 160) || !text(item.before, 300000) || !text(item.after, 300000) || !nonempty(item.author, 160))
    || value.generatedAt !== null && !timestamp(value.generatedAt)) return invalid()
  for (const key of ['backendReportId', 'backendReportVersion', 'backendDraftId', 'backendDraftModel', 'backendDraftGeneratedAt', 'backendEvidenceCheckedReportId', 'backendEvidenceCheckedAt', 'sharedDraftId', 'sharedSavedAt']) {
    if (value[key] !== undefined && !nonempty(value[key], 2048)) return invalid()
  }
  if (value.sharedDraftVersion !== undefined && (!Number.isSafeInteger(value.sharedDraftVersion) || Number(value.sharedDraftVersion) < 1)) return invalid()
  if (value.backendEvidenceReferenceCheck !== undefined && !object(value.backendEvidenceReferenceCheck)) return invalid()
  return structuredClone(value) as Workspace
}

function summary(value: unknown): value is SharedReportSummary {
  return object(value) && nonempty(value.id) && Number.isSafeInteger(value.version) && Number(value.version) > 0
    && timestamp(value.created_at) && timestamp(value.updated_at) && nonempty(value.based_on_report_id)
    && (value.model === null || nonempty(value.model)) && Number.isSafeInteger(value.section_count)
    && Number(value.section_count) >= 0 && Number(value.section_count) <= 12
}
export function checkedSharedReportList(payload: unknown): SharedReportSummary[] {
  if (!object(payload) || !Array.isArray(payload.drafts) || payload.drafts.length > 1000 || !payload.drafts.every(summary)
    || new Set(payload.drafts.map(item => item.id)).size !== payload.drafts.length) throw new Error('The shared report list could not be read. Retry without changing your local draft.')
  return payload.drafts
}
export function checkedSharedReport(payload: unknown, dealId: string): SharedReportRecord {
  if (!object(payload) || payload.deal_id !== dealId || !summary(payload) || !('draft' in payload) || !('workspace' in payload)
    || payload.draft === null && payload.workspace === null) throw new Error('The shared report does not belong to this company or has an unsupported format. Your local draft is preserved.')
  return { ...payload, workspace: payload.workspace === null ? null : checkedSharedWorkspace(payload.workspace, dealId) } as SharedReportRecord
}
export function sharedReportError(payload: unknown, status: number): { message: string; conflict: boolean } {
  const detail = object(payload) ? payload.detail : null
  const code = object(detail) ? detail.code : null
  const message = typeof detail === 'string' ? detail : object(detail) && typeof detail.message === 'string' ? detail.message : null
  return { conflict: status === 409 && code !== 'stale_report', message: status === 409 && code !== 'stale_report'
    ? 'Another shared version exists. Your local copy is preserved. Load the latest shared version, or save as a new report to keep both.'
    : (message?.slice(0, 500) || `The shared report request failed (HTTP ${status}). Your local draft is preserved.`) }
}

/** Only the saved preferences choose modules; never fill in malformed settings silently. */
export function workspaceForDraftPreferences(previous: Workspace, payload: unknown, dealId: string): Workspace {
  if (!object(payload) || !Array.isArray(payload.drafting_preferences) || !payload.drafting_preferences.length) throw new Error('The saved report has no supported module configuration.')
  const order: ModuleId[] = []
  const configs: Partial<Record<ModuleId, ModuleConfig>> = {}
  for (const preference of payload.drafting_preferences) {
    if (!object(preference) || !moduleId(preference.id)) throw new Error('The saved report contains an unsupported module configuration.')
    const id = preference.id
    if (order.includes(id) || !config(preference)) throw new Error('The saved report contains an unsupported module configuration.')
    order.push(id)
    configs[id] = { topics: [...preference.topics], depth: preference.depth, geography: preference.geography, horizon: preference.horizon, scope: preference.scope, focus: preference.focus }
  }
  return checkedSharedWorkspace({ ...previous, order, configs }, dealId)
}
