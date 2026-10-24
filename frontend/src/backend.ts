import { useCallback, useEffect, useState } from 'react'
import type { Evidence } from './data.ts'

export type Locator = Record<string, unknown>
export type BackendSource = {
  snapshot_id: string; file_name: string; sha256: string; provider: string;
  ingestion_channel: string; data_role: string; visibility: string; preview_url: string;
  locator?: Locator | null; location?: Locator; category?: string; source_kind?: string;
  source_uri?: string; uploaded_at?: string | null; retrieved_at?: string | null;
  provider_as_of?: string | null; has_reported_observations?: boolean; has_profile_fields?: boolean;
  context?: Record<string, unknown>;
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
  provider: string; information_as_of?: string | null;
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
}
export type BackendEvidence = Evidence & {
  kind: 'observation' | 'calculation' | 'profile'; sources: BackendSource[]; graph?: BackendGraph;
  conflictNumbers: boolean; rawValue?: string | null; metricKey?: string; inputIds?: string[]; calculation?: BackendCalculation;
  conflicts?: Record<string, unknown>[]; explanationSteps?: Record<string, unknown>[]; context?: Record<string, unknown>;
}

export function backendProjectId(frontendId: string): string | null {
  return frontendId === 'circle' || frontendId === 'circle-2025-ipo' ? 'circle-2025-ipo' : null
}

export function apiUrl(relativePath: string): string {
  if (!relativePath.startsWith('/') || relativePath.startsWith('//')) throw new Error('An API path must start with one slash.')
  const configured = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL
  const base = (configured || '/api').replace(/\/+$/, '')
  return `${base}${relativePath}`
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
  const observationEvidence: BackendEvidence[] = report.reported_metrics.map(({ observation: o, source, context }) => ({
    id: o.id, kind: 'observation', metricKey: o.metric_key, title: o.raw_label || humanize(o.metric_key),
    file: source.file_name, locator: formatLocator(source.locator), period: period(o), unit: o.unit || 'Unknown unit',
    status: context.review_required || o.value == null ? 'Needs review' : 'Reported', value: formatDecimal(o.value, o.unit),
    description: `${source.provider} · ${o.scope || 'Scope unknown'} · ${o.scenario}`,
    excerpt: o.raw_value == null ? 'Source value unavailable.' : `Recorded source value: ${o.raw_value}`,
    rows: [['Raw source value', o.raw_value ?? 'Unavailable'], ['Normalized value', formatDecimal(o.value, o.unit)], ['Scale multiplier', o.scale_multiplier ?? 'Unknown'], ['Normalization basis', o.normalization_basis ?? 'Not supplied'], ['Definition', o.definition_key ?? 'Not reviewed'], ['Source locator', formatLocator(source.locator)]],
    note: note([...(o.notes || []), ...(context.review_reasons || []).map(humanize)]),
    hash: source.sha256, category: 'Financial data', sources: [source], graph: { nodes: report.source_graph.nodes.filter(node => node.id === o.id || node.id === source.snapshot_id), edges: report.source_graph.edges.filter(edge => edge.source === source.snapshot_id && edge.target === o.id) }, conflictNumbers: report.conflicts.some(conflict => Array.isArray(conflict.observation_ids) && conflict.observation_ids.includes(o.id) && ['value_conflict', 'aggregate_value_conflict'].includes(String(conflict.kind))), rawValue: o.raw_value, context,
  }))
  const calculationEvidence: BackendEvidence[] = report.calculations.map(entry => {
    const c = entry.calculation
    const sources = entry.inputs.length ? entry.inputs.map(input => input.source) : entry.sources
    const coverage = c.parameters.coverage as Record<string, unknown> | undefined
    const start = coverage?.requested_start || c.parameters.period_start
    const end = coverage?.requested_end || c.parameters.period_end
    const periods = [...new Set(entry.inputs.map(input => period(input.observation)))]
    return {
      id: c.id, kind: 'calculation', metricKey: c.metric_key, inputIds: c.input_ids, title: humanize(c.metric_key), file: [...new Set(sources.map(s => s.file_name))].join('; ') || 'No source inputs',
      locator: [...new Set(sources.map(s => formatLocator(s.locator)))].join('; ') || 'Location not supplied',
      period: start && end ? `${start} – ${end}` : periods.join('; ') || 'Exact dates unknown', unit: c.unit || 'Unknown unit',
      status: c.status === 'succeeded' ? 'Reproduced' : 'Needs review', value: formatDecimal(c.value, c.unit),
      description: `${humanize(c.status)} · ${c.function_key} v${c.function_version}`, excerpt: c.formula,
      rows: [...entry.inputs.map(input => [`${input.input_role} · ${formatLocator(input.source.locator)}`, formatDecimal(input.observation.value, input.observation.unit)] as [string, string]), ['Stored result', formatDecimal(c.value, c.unit)]],
      formula: c.formula, note: note([...c.reasons, entry.conflict_numbers ? 'Conflict numbers: differing stored values are flagged; originals are preserved.' : null, 'Displayed arithmetic and output were recorded by the backend.']),
      category: 'Financial data', sources, graph: { nodes: entry.nodes, edges: entry.edges }, conflictNumbers: Boolean(entry.conflict_numbers), calculation: c, conflicts: entry.conflicts, explanationSteps: entry.explanation_steps,
      context: { status: c.status, parameters: c.parameters, function_key: c.function_key, function_version: c.function_version },
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
      note: 'Reported in the stored primary company response. No new Akta retrieval was performed.', hash: field.source.sha256, category: 'Documents', sources: [field.source], conflictNumbers: false,
      graph: { nodes: [sourceNode, fieldNode].filter((node): node is BackendNode => Boolean(node)), edges: lineage.edges.filter(edge => edge.target === id) },
    }
  })
  return [...calculationEvidence, ...observationEvidence, ...profileEvidence]
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
    && typeof value.preview_url === 'string' && /^\/sources\/[^/]+\/file$/.test(value.preview_url)
    && (value.locator == null || validLocator(value.locator)) && (value.location === undefined || object(value.location))
    && (value.context === undefined || object(value.context))
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
  return report
}
export async function fetchCompanyReport(dealId: string, signal?: AbortSignal): Promise<CompanyReport> {
  let response: Response
  try {
    response = await fetch(apiUrl(`/deals/${encodeURIComponent(dealId)}/report`), { signal, headers: { Accept: 'application/json' }, cache: 'no-store' })
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
