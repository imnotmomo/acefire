import { useCallback, useEffect, useState } from 'react'
import type { Evidence } from './data.ts'
import { dataState } from './dataState.ts'
import type { DataState } from './dataState.ts'

export type Locator = Record<string, unknown>
export type BackendSource = {
  snapshot_id: string; file_name: string; sha256: string; provider: string;
  ingestion_channel: string; data_role: string; visibility: string; preview_url: string;
  locator?: Locator | null; location?: Locator; category?: string; source_kind?: string;
  source_uri?: string; uploaded_at?: string | null; retrieved_at?: string | null;
  provider_as_of?: string | null; has_reported_observations?: boolean; has_profile_fields?: boolean;
  context?: Record<string, unknown>; preview_available?: boolean; deal_id?: string; entity_key?: string;
}
export type BackendDocumentEvidence = {
  snapshot_id: string; quote: string; locator: Locator; quote_match_rule?: string | null;
  original_snapshot_id?: string | null; original_locator_origin?: string | null; original_locator_status?: string | null;
  original_locators?: Locator[]; representation_kind?: string | null;
}
export type BackendDocumentClaim = {
  id: string; deal_id: string; entity_key: string; snapshot_id: string; statement: string; claim_type: string;
  extractor_version: string; evidence: BackendDocumentEvidence[]; limitations: string[];
  effective_date?: string | null; verification_status?: string; model?: string;
  numeric?: Record<string, unknown> | null; numeric_source?: Record<string, unknown> | null;
  subject_entity_id?: string | null; subject_entity_name?: string | null;
}
export type NarrativeEvidenceRecord = {
  id: string; deal_id: string; kind: 'statement' | 'observation' | 'calculation'; title: string; text: string;
  source?: BackendSource; sources?: BackendSource[]; quote_basis: 'source_text' | 'structured_record';
}
export type BackendNode = { id: string; type?: string; position?: { x: number; y: number }; data: Record<string, unknown> }
export type BackendGraph = { nodes: BackendNode[]; edges: { id: string; source: string; target: string; type?: string; label?: string; data?: Record<string, unknown> }[] }
export type BackendObservation = {
  id: string; deal_id: string; snapshot_id: string; metric_key: string; raw_label: string;
  raw_value: string | null; value: string | null; unit: string | null; currency: string | null;
  scale_multiplier: string | null; normalization_status: string; normalization_basis: string | null;
  definition_key: string | null; scope: string | null; accounting_basis: string | null;
  period_kind: string; period_label: string | null; period_start: string | null; period_end: string | null;
  scenario: string; verification_status: string; locator: Locator; quarantined: boolean; notes: string[];
  provider: string; information_as_of?: string | null; entity_key?: string;
}
export type BackendCalculation = {
  id: string; deal_id: string; metric_key: string; function_key: string; function_version: string;
  formula: string; status: string; value: string | null; unit: string | null;
  input_ids: string[]; input_snapshots: string[]; parameters: Record<string, unknown>; reasons: string[];
}
export type BackendMetric = { observation: BackendObservation; source: BackendSource; context: Record<string, unknown> & { review_required?: boolean; review_reasons?: string[] } }
export type BackendCalculationReport = BackendGraph & {
  calculation: BackendCalculation; inputs: { input_order: number; input_role: string; observation: BackendObservation; source: BackendSource }[];
  sources: BackendSource[]; reasons: string[]; explanation_steps: Record<string, unknown>[];
  conflict_numbers?: boolean; conflicts?: Record<string, unknown>[]; needs_review?: Record<string, unknown>[];
}
export type PeriodCoverage = Record<string, unknown> & {
  metric_key?: string; provider?: string; unit?: string | null; scope?: string | null;
  available_start?: string | null; available_end?: string | null;
  known_periods?: Record<string, unknown>[]; instant_periods?: Record<string, unknown>[];
  unresolved_periods?: Record<string, unknown>[]; gaps?: Record<string, unknown>[];
  overlaps?: Record<string, unknown>[]; observation_ids?: string[];
}
export type CompanyReport = {
  report_id: string; report_version: string; generated_at_utc: string;
  company: { deal_id: string; entity_key: string; legal_name: string; domain: string; country: string; primary_provider: string; historical_cutoff: string | null; identifiers: Record<string, string>; primary_company_id?: string | null };
  primary_profile: { available: boolean; provider: string; records: Record<string, unknown>[]; field_lineage: BackendGraph & { fields: { field_path: string; value: unknown; source: BackendSource }[]; sources: BackendSource[] } };
  reported_metrics: BackendMetric[]; calculations: BackendCalculationReport[];
  comparisons: Record<string, unknown>[]; source_files: BackendSource[];
  coverage: Record<string, unknown>[]; gaps: Record<string, unknown>[]; summary: Record<string, unknown>;
  data_period_coverage: PeriodCoverage[]; source_graph: BackendGraph;
  conflict_numbers: boolean; conflicts: Record<string, unknown>[]; flags: string[];
  document_claims?: BackendDocumentClaim[]; narrative_evidence?: NarrativeEvidenceRecord[];
  stored_reports?: { id: string; created_at: string; language: string; section_count: number; model: string; status: string }[];
  persistence?: { provider: 'firestore'; project_id: string; database_id: string };
}
export type BackendEvidence = Evidence & {
  kind: 'observation' | 'calculation' | 'profile' | 'statement'; sources: BackendSource[]; graph?: BackendGraph;
  conflictNumbers: boolean; rawValue?: string | null; metricKey?: string; inputIds?: string[]; calculation?: BackendCalculation;
  conflicts?: Record<string, unknown>[]; explanationSteps?: Record<string, unknown>[]; context?: Record<string, unknown>;
  citationText?: string; quoteBasis?: 'source_text' | 'structured_record'; reviewState?: DataState;
  normalizationStatus?: string | null; normalizedValue?: string | null;
}

export function backendProjectId(frontendId: string): string | null {
  if (frontendId === 'circle' || frontendId === 'circle-2025-ipo') return 'circle-2025-ipo'
  if (frontendId === 'enfuce-documents' || frontendId === 'enfuce-2020') return 'enfuce-2020'
  return null
}

export function apiUrl(relativePath: string): string {
  if (!relativePath.startsWith('/') || relativePath.startsWith('//') || /[\\\u0000-\u0020\u007f#]/.test(relativePath) || new URL(relativePath, 'https://api-path.invalid').pathname !== relativePath.split('?')[0]) throw new Error('An API path must be a canonical relative path starting with one slash.')
  const configured = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL
  const base = (configured || '/api').replace(/\/+$/, '')
  return `${base}${relativePath}`
}

type AccessTokenProvider = () => Promise<string | null>
let accessTokenProvider: AccessTokenProvider | null = null
/** Register a future authentication adapter; tokens remain in memory for each API call. */
export function setApiAccessTokenProvider(provider: AccessTokenProvider | null): void { accessTokenProvider = provider }

export async function apiFetch(relativePath: string, init: RequestInit = {}): Promise<Response> {
  // Validate before asking for a token. Absolute signed-storage URLs are never API requests.
  const target = apiUrl(relativePath)
  const headers = new Headers(init.headers)
  if (accessTokenProvider) {
    const token = await accessTokenProvider()
    headers.delete('Authorization')
    if (token !== null && (typeof token !== 'string' || !token || /\s/.test(token))) throw new Error('The API access-token provider returned an invalid token.')
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  // Signed storage is opened separately; API bearer credentials do not follow redirects.
  return fetch(target, { ...init, headers, redirect: 'error' })
}

function canonicalSourcePath(value: string): boolean {
  return /^\/sources\/[^/?#\\]+\/file$/.test(value) && !/[\u0000-\u0020\u007f]/.test(value) && new URL(value, 'https://source-path.invalid').pathname === value
}
function signedSourceUrl(value: string): boolean {
  if (!/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return false
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password } catch { return false }
}
export function sourceFileUrl(path: string): string {
  if (canonicalSourcePath(path)) return apiUrl(path)
  if (signedSourceUrl(path)) return path
  throw new Error('The source file URL must be a registered API path or an HTTPS storage URL.')
}

/** Group the API's decimal string without converting a financial amount to Number. */
export function formatDecimal(value: string | null | undefined, unit?: string | null): string {
  if (value == null || value === '') return 'Unavailable'
  const match = /^([+-]?)(\d+)(\.\d+)?$/.exec(value)
  const formatted = match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] || ''}` : value
  return unit ? `${formatted} ${unit}` : formatted
}
export function humanize(value: string): string {
  const words = value.replace(/^[^.]+\./, '').replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
export function formatLocator(locator?: Locator | null): string {
  if (!locator || Object.keys(locator).length === 0) return 'Location not supplied'
  const fields: string[] = []
  const add = (key: string, label: string) => { if (locator[key] != null && locator[key] !== '') fields.push(`${label}${String(locator[key])}`) }
  add('sheet', 'Sheet '); add('cell', 'Cell '); add('page', 'Page ')
  if (locator.line_start != null) fields.push(`Lines ${locator.line_start}${locator.line_end != null ? `–${locator.line_end}` : ' (end unknown)'}`)
  add('row', 'Row '); add('column', 'Column '); add('paragraph', 'Paragraph ')
  if (typeof locator.pointer === 'string') fields.push(locator.pointer || '(JSON root)')
  const seen = new Set(['kind', 'sheet', 'cell', 'page', 'line_start', 'line_end', 'row', 'column', 'paragraph', 'pointer'])
  if (!fields.length) for (const [key, value] of Object.entries(locator)) if (!seen.has(key) && value != null) fields.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
  return fields.join(' · ') || `Location details: ${String(locator.kind || 'unknown')}`
}
function period(observation: BackendObservation): string {
  const dates = observation.period_start && observation.period_end ? `${observation.period_start} – ${observation.period_end}` : observation.period_end ? `As of ${observation.period_end}` : 'Exact dates unknown'
  return observation.period_label ? `${observation.period_label} · ${dates}` : dates
}
function scalar(value: unknown): string {
  return value == null ? 'Unavailable' : typeof value === 'string' ? value : JSON.stringify(value)
}
function note(values: (string | null | undefined)[]): string { return values.filter(Boolean).join(' ') }
function sourceRows(sources: BackendSource[]): [string, string][] {
  return sources.map(source => [source.file_name, formatLocator(source.locator)])
}
export function reportEvidence(report: CompanyReport): BackendEvidence[] {
  if (!validReportBindings(report) || !validDocumentClaims(report) || !validNarrativeEvidence(report)) throw new Error('The backend returned unsupported document evidence.')
  const observationEvidence: BackendEvidence[] = report.reported_metrics.map(({ observation: o, source, context }) => ({
    id: o.id, kind: 'observation', metricKey: o.metric_key, title: o.raw_label || humanize(o.metric_key),
    file: source.file_name, locator: formatLocator(source.locator), period: period(o), unit: o.unit || 'Unknown unit',
    status: context.review_required || o.value == null ? 'Needs review' : 'Reported', value: formatDecimal(o.value, o.unit),
    description: `${source.provider} · ${o.scope || 'Scope unknown'} · ${o.scenario}`,
    excerpt: o.raw_value == null ? 'Source value unavailable.' : `Recorded source value: ${o.raw_value}`,
    rows: [['Raw source value', o.raw_value ?? 'Unavailable'], ['Normalized value', formatDecimal(o.value, o.unit)], ['Scale multiplier', o.scale_multiplier ?? 'Unknown'], ['Normalization basis', o.normalization_basis ?? 'Not supplied'], ['Definition', o.definition_key ?? 'Not reviewed'], ['Source locator', formatLocator(source.locator)]],
    note: note([...(o.notes || []), ...(context.review_reasons || []).map(humanize)]),
    hash: source.sha256, category: 'Financial data', sources: [source], graph: { nodes: report.source_graph.nodes.filter(node => node.id === o.id || node.id === source.snapshot_id), edges: report.source_graph.edges.filter(edge => edge.source === source.snapshot_id && edge.target === o.id) }, conflictNumbers: report.conflicts.some(conflict => Array.isArray(conflict.observation_ids) && conflict.observation_ids.includes(o.id) && ['value_conflict', 'aggregate_value_conflict'].includes(String(conflict.kind))), rawValue: o.raw_value, normalizationStatus: o.normalization_status, normalizedValue: o.value, context: { ...context, hasEvidence: o.value !== null || Boolean(o.raw_value?.trim()) },
  }))
  const calculationEvidence: BackendEvidence[] = report.calculations.map(entry => {
    const c = entry.calculation
    const execution = c.parameters.agent_execution as Record<string, unknown> | undefined
    const suppliedText = Array.isArray(execution?.supplied_text_evidence) ? execution.supplied_text_evidence : []
    const textSources = suppliedText.map(item => typeof item === 'object' && item !== null ? (item as Record<string, unknown>).source : null).filter(validSource) as BackendSource[]
    const sources = [...(entry.inputs.length ? entry.inputs.map(input => input.source) : entry.sources), ...textSources]
    const coverage = c.parameters.coverage as Record<string, unknown> | undefined
    const start = coverage?.requested_start || c.parameters.period_start
    const end = coverage?.requested_end || c.parameters.period_end
    const periods = [...new Set(entry.inputs.map(input => period(input.observation)))]
    return {
      id: c.id, kind: 'calculation', metricKey: c.metric_key, inputIds: c.input_ids, title: humanize(c.metric_key), file: [...new Set(sources.map(s => s.file_name))].join('; ') || 'No source inputs',
      locator: [...new Set(sources.map(s => formatLocator(s.locator)))].join('; ') || 'Location not supplied',
      period: start && end ? `${start} – ${end}` : periods.join('; ') || 'Exact dates unknown', unit: c.unit || 'Unknown unit',
      status: c.status === 'succeeded' && c.function_key !== 'llm_local_python' ? 'Reproduced' : 'Needs review', value: formatDecimal(c.value, c.unit),
      description: `${c.function_key === 'llm_local_python' ? 'Model-generated · review context' : humanize(c.status)} · ${c.function_key} v${c.function_version}`, excerpt: c.formula,
      rows: [...entry.inputs.map(input => [`${input.input_role} · ${formatLocator(input.source.locator)}`, formatDecimal(input.observation.value, input.observation.unit)] as [string, string]), ...((Array.isArray(execution?.premises) ? execution.premises : []).filter(item => typeof item === 'object' && item !== null).map(item => { const premise = item as Record<string, unknown>; return [`Source ${String(premise.role || 'premise')}`, String(premise.quote || '')] as [string, string] })), ['Stored result', formatDecimal(c.value, c.unit)]],
      formula: c.formula, note: note([...c.reasons, c.function_key === 'llm_local_python' ? 'Model-generated code executed in a local worker. Execution does not independently verify the financial interpretation. The source graph records all supplied inputs; dynamic dataflow has not been independently verified.' : null, entry.conflict_numbers ? 'Conflict numbers: differing stored values are flagged; originals are preserved.' : null, 'Displayed arithmetic and output were recorded by the backend.']),
      category: 'Financial data', sources, graph: { nodes: entry.nodes, edges: entry.edges }, conflictNumbers: Boolean(entry.conflict_numbers), calculation: c, conflicts: entry.conflicts, explanationSteps: entry.explanation_steps,
      normalizedValue: c.value, normalizationStatus: null,
      context: { status: c.status, parameters: c.parameters, function_key: c.function_key, function_version: c.function_version, hasEvidence: sources.length > 0 },
    }
  })
  const lineage = report.primary_profile.field_lineage
  const profileEvidence: BackendEvidence[] = lineage.fields.map(field => {
    const id = `field:${field.source.snapshot_id}:${field.field_path}`
    const fieldNode = lineage.nodes.find(node => node.id === id)
    const sourceNode = lineage.nodes.find(node => node.id === `file:${field.source.snapshot_id}`)
    return {
      id, kind: 'profile', title: humanize(field.field_path.split('/').filter(Boolean).join(' / ') || 'Company profile'), file: field.source.file_name,
      locator: formatLocator(field.source.locator), period: 'Saved company profile', unit: 'Profile field', status: 'Reported', value: scalar(field.value),
      description: `${field.source.provider} company information`, excerpt: scalar(field.value), rows: [['Field', field.field_path || '/'], ['Value', scalar(field.value)], ...sourceRows([field.source])],
      note: 'Reported in the stored primary company response. No new Akta retrieval was performed.', hash: field.source.sha256, category: 'Documents', sources: [field.source], conflictNumbers: false, rawValue: materialValue(field.value) ? scalar(field.value) : null, normalizedValue: null, normalizationStatus: null, context: { hasEvidence: materialValue(field.value) },
      graph: { nodes: [sourceNode, fieldNode].filter((node): node is BackendNode => Boolean(node)), edges: lineage.edges.filter(edge => edge.target === id) },
    }
  })
  const registered = new Map(report.source_files.map(source => [source.snapshot_id, source]))
  const documentEvidence: BackendEvidence[] = (report.document_claims ?? []).flatMap(claim => claim.evidence.map((item, index) => {
    const source = documentSource(registered.get(item.snapshot_id)!, item.locator)
    const id = documentEvidenceId(claim.id, index)
    const sourceNodeId = `file:${source.snapshot_id}`
    return {
      id, kind: 'statement', title: claim.statement, value: item.quote, excerpt: item.quote, rawValue: item.quote,
      file: source.file_name, locator: formatLocator(item.locator), period: claim.effective_date ? `Document context date: ${claim.effective_date}` : 'Document date not supplied', unit: 'Source quotation', status: 'Reported',
      description: `B-extracted claim · ${humanize(claim.claim_type)} · ${source.provider}`,
      rows: [['B-extracted claim / paraphrase', claim.statement], ['Stored source quotation', item.quote], ['Claim type', claim.claim_type], ['Extractor version', claim.extractor_version], ['Quote match rule', item.quote_match_rule ?? 'Not supplied'], ['Representation', item.representation_kind ?? 'Not supplied'], ['Verification status from extractor', claim.verification_status ?? 'Not supplied'], ['Source locator', formatLocator(item.locator)], ...claim.limitations.map((value, i) => [`Limitation ${i + 1}`, value] as [string, string])],
      note: note(["The title is B's extracted claim or paraphrase. The value and excerpt are the stored source quotation, not that paraphrase.", item.quote_match_rule ? `Extractor quote matching: ${item.quote_match_rule}. This does not assert a byte-exact match to the original PDF.` : 'The extractor did not supply a quote matching rule.', ...claim.limitations]),
      hash: source.sha256, category: 'Documents', sources: [source], conflictNumbers: false, normalizedValue: null, normalizationStatus: null,
      context: { hasEvidence: true, document_claim_id: claim.id, evidence_index: index, claim_type: claim.claim_type, claim_statement: claim.statement, extractor_version: claim.extractor_version, model: claim.model ?? null, verification_status: claim.verification_status ?? null, quote_match_rule: item.quote_match_rule ?? null, representation_kind: item.representation_kind ?? null, original_snapshot_id: item.original_snapshot_id ?? null, original_locators: item.original_locators ?? [], limitations: claim.limitations },
      graph: { nodes: [{ id: sourceNodeId, type: 'source', data: { kind: 'source_file', label: source.file_name, source } }, { id, type: 'text_evidence', data: { kind: 'text_evidence', label: 'Stored source quotation', text: item.quote, source, document_claim_id: claim.id } }], edges: [{ id: `source-document:${id}`, source: sourceNodeId, target: id, label: 'Extracted source quotation' }] },
    }
  }))
  const narrative = new Map((report.narrative_evidence ?? []).map(item => [item.id, item]))
  const output = new Map<string, BackendEvidence>()
  for (const item of [...calculationEvidence, ...observationEvidence, ...profileEvidence, ...documentEvidence]) {
    const citation = narrative.get(item.id)
    const quoteBasis = citation?.quote_basis ?? (item.kind === 'profile' || item.kind === 'statement' ? 'source_text' : 'structured_record')
    output.set(item.id, { ...item, citationText: citation?.text ?? item.excerpt, quoteBasis, reviewState: dataState({ conflictNumbers: item.conflictNumbers, status: item.calculation?.status ?? item.status, normalizationStatus: item.normalizationStatus, value: item.normalizedValue, rawValue: item.rawValue, hasEvidence: typeof item.context?.hasEvidence === 'boolean' ? item.context.hasEvidence : item.sources.length > 0 }) })
  }
  return [...output.values()]
}

function materialValue(value: unknown): boolean { return value !== null && value !== undefined && (typeof value === 'string' ? Boolean(value.trim()) : Array.isArray(value) ? value.length > 0 : typeof value === 'object' ? Object.keys(value).length > 0 : true) }
function documentEvidenceId(claimId: string, index: number): string { return `claim:${claimId}:evidence:${index}` }
function documentSource(source: BackendSource, locator: Locator): BackendSource {
  const fields = ['page', 'line_start', 'line_end', 'column', 'row', 'sheet', 'cell', 'pointer', 'paragraph']
  return { ...source, locator: structuredClone(locator), location: { ...source.location, ...Object.fromEntries(fields.filter(key => locator[key] !== undefined).map(key => [key, locator[key]])) } }
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function requiredString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function nullableString(value: unknown): boolean { return value === null || typeof value === 'string' }
function optionalString(value: unknown): boolean { return value === undefined || nullableString(value) }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string') }
function records(value: unknown): value is Record<string, unknown>[] { return Array.isArray(value) && value.every(object) }
function decimal(value: unknown): boolean { return value === null || typeof value === 'string' && /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value) }
function validLocator(value: unknown): boolean {
  return object(value) && (value.kind === undefined || typeof value.kind === 'string') && (value.pointer === undefined || typeof value.pointer === 'string')
}
function validSource(value: unknown): boolean {
  return object(value) && ['snapshot_id', 'file_name', 'sha256', 'provider', 'preview_url', 'ingestion_channel', 'data_role', 'visibility'].every(key => requiredString(value[key]))
    && typeof value.preview_url === 'string' && (canonicalSourcePath(value.preview_url) || signedSourceUrl(value.preview_url))
    && (value.locator == null || validLocator(value.locator)) && (value.location === undefined || object(value.location))
    && (value.context === undefined || object(value.context))
    && (value.preview_available === undefined || typeof value.preview_available === 'boolean')
    && optionalString(value.deal_id) && optionalString(value.entity_key)
}
function sameSource(left: BackendSource, right: BackendSource): boolean {
  return left.snapshot_id === right.snapshot_id && left.sha256 === right.sha256 && left.file_name === right.file_name && left.provider === right.provider
    && left.ingestion_channel === right.ingestion_channel && left.data_role === right.data_role && left.visibility === right.visibility
}
function registeredSource(source: unknown, report: CompanyReport): source is BackendSource {
  return validSource(source) && report.source_files.some(file => sameSource(file, source as BackendSource))
    && (!(source as BackendSource).deal_id || (source as BackendSource).deal_id === report.company.deal_id)
    && (!(source as BackendSource).entity_key || (source as BackendSource).entity_key === report.company.entity_key)
}
function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`
  return JSON.stringify(value ?? null)
}
function validReportBindings(report: CompanyReport): boolean {
  const ids = report.source_files.map(source => source.snapshot_id)
  if (new Set(ids).size !== ids.length) return false
  const sources = new Set(ids)
  const metrics = new Map(report.reported_metrics.map(item => [item.observation.id, item.observation]))
  const boundObservation = (observation: BackendObservation, source: BackendSource) => observation.snapshot_id === source.snapshot_id && observation.provider === source.provider
    && (!observation.entity_key || observation.entity_key === report.company.entity_key)
    && registeredSource(source, report) && canonicalValue(observation.locator) === canonicalValue(source.locator)
  if (!report.reported_metrics.every(row => boundObservation(row.observation, row.source))
    || !report.primary_profile.field_lineage.fields.every(field => registeredSource(field.source, report))
    || !report.primary_profile.field_lineage.sources.every(source => registeredSource(source, report))) return false
  return report.calculations.every(entry => {
    const calculation = entry.calculation
    return new Set(calculation.input_ids).size === calculation.input_ids.length
      && calculation.input_ids.length === entry.inputs.length
      && calculation.input_snapshots.every(snapshot => sources.has(snapshot))
      && entry.sources.every(source => registeredSource(source, report))
      && entry.inputs.every(input => {
        const stored = metrics.get(input.observation.id)
        return calculation.input_ids.includes(input.observation.id) && stored !== undefined && stored.value === input.observation.value && stored.unit === input.observation.unit && stored.snapshot_id === input.observation.snapshot_id && boundObservation(input.observation, input.source)
      })
  })
}
function validDocumentClaims(report: CompanyReport): boolean {
  const claims: unknown = report.document_claims
  if (claims === undefined) return true
  if (!records(claims) || !requiredString(report.company.entity_key)) return false
  const registered = new Map(report.source_files.map(source => [source.snapshot_id, source]))
  const claimIds = new Set<string>()
  for (const claim of claims) {
    if (!['id', 'deal_id', 'entity_key', 'snapshot_id', 'statement', 'claim_type', 'extractor_version'].every(key => requiredString(claim[key]))
      || !String(claim.statement).trim() || claim.deal_id !== report.company.deal_id || claim.entity_key !== report.company.entity_key
      || claimIds.has(String(claim.id)) || !registered.has(String(claim.snapshot_id)) || !strings(claim.limitations)
      || !records(claim.evidence) || !claim.evidence.length
      || !['effective_date', 'verification_status', 'model', 'subject_entity_id', 'subject_entity_name'].every(key => optionalString(claim[key]))
      || !['numeric', 'numeric_source'].every(key => claim[key] == null || object(claim[key]))) return false
    claimIds.add(String(claim.id))
    for (const item of claim.evidence) {
      if (!requiredString(item.snapshot_id) || !registered.has(item.snapshot_id) || !requiredString(item.quote) || !item.quote.trim() || !validLocator(item.locator)
        || !['quote_match_rule', 'representation_kind', 'original_snapshot_id', 'original_locator_origin', 'original_locator_status'].every(key => optionalString(item[key]))
        || item.original_snapshot_id != null && !registered.has(String(item.original_snapshot_id))
        || item.original_locators !== undefined && (!Array.isArray(item.original_locators) || !item.original_locators.every(validLocator))) return false
    }
  }
  return true
}
type BoundNarrativeEntry = { kind: NarrativeEvidenceRecord['kind']; text?: string; sources: BackendSource[] }
function boundNarrativeIndex(report: CompanyReport): Map<string, BoundNarrativeEntry> {
  const index = new Map<string, BoundNarrativeEntry>()
  for (const metric of report.reported_metrics) index.set(metric.observation.id, { kind: 'observation', sources: [metric.source] })
  for (const entry of report.calculations) index.set(entry.calculation.id, { kind: 'calculation', sources: [...entry.sources, ...entry.inputs.map(input => input.source)] })
  for (const field of report.primary_profile.field_lineage.fields) index.set(`field:${field.source.snapshot_id}:${field.field_path}`, { kind: 'statement', text: scalar(field.value), sources: [field.source] })
  const registered = new Map(report.source_files.map(source => [source.snapshot_id, source]))
  for (const claim of report.document_claims ?? []) for (const [number, item] of claim.evidence.entries()) index.set(documentEvidenceId(claim.id, number), { kind: 'statement', text: item.quote, sources: [documentSource(registered.get(item.snapshot_id)!, item.locator)] })
  return index
}
function validNarrativeEvidence(report: CompanyReport): boolean {
  const catalog: unknown = report.narrative_evidence
  if (catalog === undefined) return true
  if (!records(catalog)) return false
  const expected = boundNarrativeIndex(report)
  const ids = new Set<string>()
  for (const item of catalog) {
    if (!requiredString(item.id) || ids.has(item.id) || item.deal_id !== report.company.deal_id || !requiredString(item.title) || !requiredString(item.text) || !item.text.trim()
      || !['statement', 'observation', 'calculation'].includes(String(item.kind)) || item.quote_basis !== (item.kind === 'statement' ? 'source_text' : 'structured_record')) return false
    ids.add(item.id)
    const original = expected.get(item.id)
    if (!original || original.kind !== item.kind || original.text !== undefined && original.text !== item.text) return false
    if (item.source !== undefined && !registeredSource(item.source, report)) return false
    if (item.sources !== undefined && (!Array.isArray(item.sources) || !item.sources.every(source => registeredSource(source, report)))) return false
    for (const source of [...(item.source ? [item.source as BackendSource] : []), ...(item.sources as BackendSource[] | undefined ?? [])]) {
      if (!original.sources.some(bound => sameSource(bound, source) && (item.kind === 'calculation' || canonicalValue(bound.locator) === canonicalValue(source.locator)))) return false
    }
  }
  return true
}
function validGraph(value: unknown): boolean {
  return object(value) && records(value.nodes) && records(value.edges)
    && value.nodes.every(node => requiredString(node.id) && object(node.data) && (node.position === undefined || object(node.position) && typeof node.position.x === 'number' && Number.isFinite(node.position.x) && typeof node.position.y === 'number' && Number.isFinite(node.position.y)))
    && value.edges.every(edge => ['id', 'source', 'target'].every(key => requiredString(edge[key])) && optionalString(edge.label) && (edge.data === undefined || object(edge.data)))
}
function validObservation(value: unknown, dealId: string): boolean {
  return object(value) && value.deal_id === dealId && ['id', 'snapshot_id', 'metric_key', 'raw_label', 'provider', 'normalization_status', 'period_kind', 'scenario', 'verification_status'].every(key => requiredString(value[key]))
    && decimal(value.value) && nullableString(value.raw_value) && decimal(value.scale_multiplier) && strings(value.notes) && validLocator(value.locator)
    && ['unit', 'currency', 'normalization_basis', 'definition_key', 'scope', 'accounting_basis', 'period_label', 'period_start', 'period_end'].every(key => nullableString(value[key]))
    && typeof value.quarantined === 'boolean'
}
function validConflict(value: unknown): boolean {
  return object(value) && requiredString(value.id) && requiredString(value.kind) && strings(value.observation_ids) && records(value.alternatives)
    && value.alternatives.every(alternative => decimal(alternative.value) && strings(alternative.observation_ids) && optionalString(alternative.unit) && optionalString(alternative.calculation_id) && records(alternative.sources)
      && alternative.sources.every(source => optionalString(source.file_name) && (source.locator == null || validLocator(source.locator))))
}
function validPeriodRecord(value: unknown): boolean {
  return object(value) && requiredString(value.observation_id) && ['period_label', 'period_start', 'period_end', 'grain', 'reason'].every(key => optionalString(value[key]))
}
function validInterval(value: unknown): boolean { return object(value) && requiredString(value.start) && requiredString(value.end) }
function validPeriodCoverage(value: unknown, dealId: string): boolean {
  return object(value) && value.deal_id === dealId && requiredString(value.metric_key) && requiredString(value.provider)
    && ['scope', 'unit', 'available_start', 'available_end'].every(key => nullableString(value[key]))
    && ['known_periods', 'instant_periods', 'unresolved_periods'].every(key => Array.isArray(value[key]) && (value[key] as unknown[]).every(validPeriodRecord))
    && ['gaps', 'overlaps'].every(key => Array.isArray(value[key]) && (value[key] as unknown[]).every(validInterval))
    && strings(value.observation_ids)
}
function validParameters(value: unknown): boolean {
  return object(value) && optionalString(value.period_start) && optionalString(value.period_end)
    && (value.coverage === undefined || object(value.coverage) && optionalString(value.coverage.requested_start) && optionalString(value.coverage.requested_end))
}
function validCalculationReport(value: unknown, dealId: string): boolean {
  if (!object(value) || !object(value.calculation)) return false
  const calculation = value.calculation
  return calculation.deal_id === dealId && ['id', 'metric_key', 'formula', 'function_key', 'function_version', 'status'].every(key => requiredString(calculation[key]))
    && decimal(calculation.value) && nullableString(calculation.unit) && strings(calculation.reasons) && strings(calculation.input_ids) && strings(calculation.input_snapshots) && validParameters(calculation.parameters)
    && records(value.inputs) && value.inputs.every(input => validObservation(input.observation, dealId) && validSource(input.source) && requiredString(input.input_role))
    && Array.isArray(value.sources) && value.sources.every(validSource) && validGraph(value) && strings(value.reasons)
    && records(value.explanation_steps) && value.explanation_steps.every(step => requiredString(step.kind)
      && (step.source === undefined || validSource(step.source)) && (step.normalized_value === undefined || decimal(step.normalized_value)))
    && (value.conflict_numbers === undefined || typeof value.conflict_numbers === 'boolean')
    && ['conflicts', 'needs_review'].every(key => value[key] === undefined || Array.isArray(value[key]) && (value[key] as unknown[]).every(validConflict))
}
export function parseCompanyReport(payload: unknown, expectedDealId?: string): CompanyReport {
  const invalid = () => { throw new Error('The backend returned an unsupported company report. Check that the frontend and backend use the same API contract.') }
  if (!object(payload) || !requiredString(payload.report_id) || !requiredString(payload.report_version) || !requiredString(payload.generated_at_utc) || !object(payload.company) || !requiredString(payload.company.deal_id) || !requiredString(payload.company.legal_name) || !requiredString(payload.company.primary_provider)) return invalid()
  const dealId = payload.company.deal_id
  if (expectedDealId && dealId !== expectedDealId) throw new Error('The backend report belongs to a different company.')
  if (!['reported_metrics', 'calculations', 'comparisons', 'source_files', 'coverage', 'gaps', 'data_period_coverage', 'conflicts', 'flags'].every(key => Array.isArray(payload[key])) || !object(payload.summary) || typeof payload.conflict_numbers !== 'boolean' || !validGraph(payload.source_graph)) return invalid()
  const report = payload as unknown as CompanyReport
  if (report.stored_reports !== undefined && (!Array.isArray(report.stored_reports) || !report.stored_reports.every(item => object(item) && (['id', 'created_at', 'language', 'model', 'status'] as const).every(key => requiredString(item[key])) && Number.isInteger(item.section_count) && item.section_count >= 0))) return invalid()
  if (report.persistence !== undefined && (!object(report.persistence) || report.persistence.provider !== 'firestore' || !requiredString(report.persistence.project_id) || !requiredString(report.persistence.database_id))) return invalid()
  if (!strings(report.flags) || !records(report.comparisons) || !records(report.coverage) || !records(report.gaps)
    || !report.gaps.every(gap => ['message', 'code', 'metric_key'].every(key => optionalString(gap[key])))
    || !report.conflicts.every(validConflict) || !report.data_period_coverage.every(row => validPeriodCoverage(row, dealId))) return invalid()
  if (!report.source_files.every(validSource) || !report.reported_metrics.every(row => object(row) && validObservation(row.observation, dealId) && validSource(row.source) && object(row.context)
    && (row.context.review_required === undefined || typeof row.context.review_required === 'boolean')
    && (row.context.review_reasons === undefined || strings(row.context.review_reasons)))) return invalid()
  if (!report.calculations.every(row => validCalculationReport(row, dealId))) return invalid()
  const profile = report.primary_profile
  if (!object(profile) || typeof profile.available !== 'boolean' || !records(profile.records) || !object(profile.field_lineage) || !validGraph(profile.field_lineage)
    || !Array.isArray(profile.field_lineage.sources) || !profile.field_lineage.sources.every(validSource)
    || !Array.isArray(profile.field_lineage.fields) || !profile.field_lineage.fields.every(field => object(field) && typeof field.field_path === 'string' && 'value' in field && validSource(field.source))) return invalid()
  if (!report.source_files.every(source => registeredSource(source, report)) || !validReportBindings(report) || !validDocumentClaims(report) || !validNarrativeEvidence(report)) return invalid()
  return report
}
export async function fetchCompanyReport(dealId: string, signal?: AbortSignal): Promise<CompanyReport> {
  let response: Response
  try {
    response = await apiFetch(`/deals/${encodeURIComponent(dealId)}/report`, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('The backend could not be reached. Check that the backend service and API proxy are running, then retry.')
  }
  if (!response.ok) {
    if (response.status === 404) throw new Error('No stored report is available for this company yet. Prepare its data in the backend, then retry.')
    throw new Error(`The backend could not load this report (HTTP ${response.status}). Retry when the service is available.`)
  }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The API did not return JSON. Check the API proxy and backend address.')
  return parseCompanyReport(await response.json(), dealId)
}
export function useCompanyReport(dealId: string | null) {
  const [result, setResult] = useState<{ dealId: string | null; report: CompanyReport | null; loading: boolean; error: string | null; loadedAt: string | null }>({ dealId, report: null, loading: Boolean(dealId), error: null, loadedAt: null })
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    if (!dealId) { setResult({ dealId, report: null, loading: false, error: null, loadedAt: null }); return () => controller.abort() }
    setResult({ dealId, report: null, loading: true, error: null, loadedAt: null })
    fetchCompanyReport(dealId, controller.signal).then(report => {
      if (!controller.signal.aborted) setResult({ dealId, report, loading: false, error: null, loadedAt: new Date().toISOString() })
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ dealId, report: null, loading: false, error: error instanceof Error ? error.message : 'The report could not be loaded.', loadedAt: null })
    })
    return () => controller.abort()
  }, [dealId, attempt])
  // Mask previous-company state during the render before the effect runs.
  const current = result.dealId === dealId ? result : { report: null, loading: Boolean(dealId), error: null, loadedAt: null }
  return { report: current.report, loading: current.loading, error: current.error, loadedAt: current.loadedAt, refresh }
}
