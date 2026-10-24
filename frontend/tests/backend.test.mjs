import test from 'node:test'
import assert from 'node:assert/strict'
import { backendProjectId, apiUrl, formatDecimal, formatLocator, parseCompanyReport, reportEvidence, fetchCompanyReport } from '../src/backend.ts'

const dealId = 'circle-2025-ipo'
const source = { snapshot_id: 'source-1', file_name: 'company.xlsx', sha256: 'hash', provider: 'orbis', ingestion_channel: 'user_upload', data_role: 'supplemental_evidence', visibility: 'deal_private', preview_url: '/sources/source-1/file', locator: { kind: 'xlsx_cell', sheet: 'Finance', cell: 'I49' } }
const observation = { id: 'b759a8e4-1234-4234-8234-123456789abc', deal_id: dealId, snapshot_id: 'source-1', provider: 'orbis', metric_key: 'orbis.total_assets', raw_label: 'Total assets', raw_value: '9007199254740993.1250', value: '9007199254740993.1250', unit: 'USD', currency: 'USD', scale_multiplier: '1', normalization_status: 'confirmed', normalization_basis: 'source unit', definition_key: null, scope: 'Consolidated', accounting_basis: 'US GAAP', period_kind: 'instant', period_label: 'FY2024', period_start: null, period_end: '2024-12-31', scenario: 'actual', verification_status: 'source_located', locator: source.locator, quarantined: false, notes: [] }
const calculation = { id: '9cda078a-1234-4234-8234-123456789abc', deal_id: dealId, metric_key: 'source_total_assets_replay', function_key: 'replay', function_version: '1', formula: 'a + b', status: 'succeeded', value: '9007199254740993.1250', unit: 'USD', input_ids: [observation.id], input_snapshots: ['source-1'], parameters: {}, reasons: [] }
function fixture() {
  const graph = { nodes: [{ id: source.snapshot_id, type: 'source', data: { label: source.file_name } }, { id: observation.id, type: 'observation', data: { label: observation.raw_label } }], edges: [{ id: 'source-observation', source: source.snapshot_id, target: observation.id }] }
  return structuredClone({
    report_id: 'report-1', report_version: '1', generated_at_utc: '2026-10-24T10:00:00Z', company: { deal_id: dealId, legal_name: 'Circle', entity_key: 'circle', domain: 'circle.com', country: 'USA', primary_provider: 'akta', historical_cutoff: null, identifiers: {} },
    primary_profile: { available: true, provider: 'akta', records: [], field_lineage: { fields: [{ field_path: '/legal_name', value: 'Circle', source: { ...source, locator: { kind: 'json_pointer', pointer: '/response/data/legal_name' } } }], sources: [source], nodes: [], edges: [] } },
    reported_metrics: [{ observation, source, context: { review_required: true, review_reasons: ['definition_not_reviewed'] } }],
    calculations: [{ calculation, inputs: [{ input_order: 1, input_role: 'assets', observation, source }], sources: [source], nodes: [], edges: [], reasons: [], explanation_steps: [{ kind: 'stored_result', value: calculation.value }], conflict_numbers: true, conflicts: [] }],
    comparisons: [], source_files: [source], coverage: [], gaps: [], summary: {}, data_period_coverage: [], source_graph: graph,
    conflict_numbers: true, conflicts: [{ id: 'conflict-1', kind: 'value_conflict', observation_ids: [observation.id], alternatives: [] }], flags: ['conflict numbers'],
  })
}

test('decimal presentation preserves digits beyond floating precision and trailing zeros', () => {
  assert.equal(formatDecimal('9007199254740993.1250', 'USD'), '9,007,199,254,740,993.1250 USD')
  assert.equal(formatDecimal('-0.00000000000000000001'), '-0.00000000000000000001')
  assert.equal(formatDecimal(null, 'USD'), 'Unavailable')
  assert.equal(formatDecimal('0', 'USD'), '0 USD')
  assert.equal(formatDecimal('1.250E+30', 'USD'), '1.250E+30 USD')
})
test('project mapping only connects declared company identities and API URLs remain under proxy', () => {
  assert.equal(backendProjectId('circle'), dealId)
  assert.equal(backendProjectId('enfuce'), null)
  assert.equal(backendProjectId('a-new-project'), null)
  assert.equal(apiUrl('/deals/circle-2025-ipo/report'), '/api/deals/circle-2025-ipo/report')
  assert.throws(() => apiUrl('//example.com/file'))
})
test('report adapter preserves UUIDs, exact locators, source hashes and nonblocking flags', () => {
  const report = parseCompanyReport(fixture(), dealId)
  const catalog = reportEvidence(report)
  const metric = catalog.find(item => item.kind === 'observation')
  const computed = catalog.find(item => item.kind === 'calculation')
  assert.equal(metric.id, observation.id)
  assert.equal(computed.id, calculation.id)
  assert.equal(metric.value, '9,007,199,254,740,993.1250 USD')
  assert.equal(metric.sources[0].locator.cell, 'I49')
  assert.equal(metric.hash, 'hash')
  assert.equal(metric.graph.edges[0].target, observation.id)
  assert.equal(computed.formula, 'a + b')
  assert.deepEqual(computed.inputIds, [observation.id])
  assert.equal(computed.conflictNumbers, true)
  assert.equal(metric.conflictNumbers, true)
  assert.equal(computed.status, 'Reproduced')
  const profile = catalog.find(item => item.kind === 'profile')
  assert.equal(profile.locator, '/response/data/legal_name')
  assert.equal(profile.id, 'field:source-1:/legal_name')
})
test('missing normalized amounts remain unavailable and raw values are retained', () => {
  const report = fixture()
  report.reported_metrics[0].observation.value = null
  report.reported_metrics[0].observation.raw_value = '$25B+'
  const metric = reportEvidence(parseCompanyReport(report)).find(item => item.kind === 'observation')
  assert.equal(metric.value, 'Unavailable')
  assert.equal(metric.rawValue, '$25B+')
  assert.equal(metric.status, 'Needs review')
  assert.equal(formatLocator({ kind: 'pdf_page', page: 12 }), 'Page 12')
  assert.equal(formatLocator(null), 'Location not supplied')
})
test('invalid report responses cannot silently masquerade as a loaded company', () => {
  assert.throws(() => parseCompanyReport({ detail: 'Not Found' }), /unsupported company report/)
  assert.throws(() => parseCompanyReport(fixture(), 'different-deal'), /different company/)
  const floats = fixture(); floats.reported_metrics[0].observation.value = 1.5
  assert.throws(() => parseCompanyReport(floats), /unsupported company report/)
  const badPreview = fixture(); badPreview.source_files[0].preview_url = 'javascript:alert(1)'
  assert.throws(() => parseCompanyReport(badPreview), /unsupported company report/)
})
test('request failures and HTML proxy fallbacks produce actionable errors', async () => {
  const before = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('not found', { status: 404 })
    await assert.rejects(fetchCompanyReport(dealId), /No stored report/)
    globalThis.fetch = async () => new Response('<html/>', { headers: { 'Content-Type': 'text/html' } })
    await assert.rejects(fetchCompanyReport(dealId), /API proxy/)
    let options
    globalThis.fetch = async (_url, opts) => { options = opts; return new Response(JSON.stringify(fixture()), { headers: { 'Content-Type': 'application/json' } }) }
    const controller = new AbortController()
    const report = await fetchCompanyReport(dealId, controller.signal)
    assert.equal(report.company.deal_id, dealId)
    assert.equal(options.signal, controller.signal)
    assert.equal(options.cache, 'no-store')
  } finally { globalThis.fetch = before }
})

const periodCoverage = () => ({ deal_id: dealId, metric_key: 'revenue', provider: 'uploaded', scope: null, unit: 'USD', available_start: null, available_end: null, known_periods: [], instant_periods: [], unresolved_periods: [], gaps: [], overlaps: [], observation_ids: [observation.id] })
test('consumed report arrays reject null entries before rendering', () => {
  for (const key of ['gaps', 'conflicts', 'data_period_coverage', 'coverage', 'comparisons']) {
    const payload = fixture(); payload[key] = [null]
    assert.throws(() => parseCompanyReport(payload), /unsupported company report/, key)
  }
  for (const key of ['known_periods', 'instant_periods', 'unresolved_periods', 'gaps', 'overlaps']) {
    const payload = fixture(); const coverage = periodCoverage(); coverage[key] = [null]; payload.data_period_coverage = [coverage]
    assert.throws(() => parseCompanyReport(payload), /unsupported company report/, key)
  }
  const good = fixture(); good.data_period_coverage = [periodCoverage()]
  assert.doesNotThrow(() => parseCompanyReport(good))
})
test('nested normalization, conflict, graph and locator metadata is checked at the boundary', () => {
  const cases = [
    payload => { payload.calculations[0].explanation_steps = [null] },
    payload => { payload.calculations[0].explanation_steps[0].source = null },
    payload => { payload.calculations[0].conflicts = [null] },
    payload => { payload.conflicts[0].alternatives = [null] },
    payload => { payload.source_graph.nodes[0].position = { x: null, y: 0 } },
    payload => { payload.reported_metrics[0].source.locator.pointer = 12 },
    payload => { payload.reported_metrics[0].context.review_reasons = [null] },
    payload => { payload.primary_profile.field_lineage.fields = [null] },
    payload => { payload.calculations[0].calculation.parameters.coverage = null },
  ]
  for (const mutate of cases) { const payload = fixture(); mutate(payload); assert.throws(() => parseCompanyReport(payload), /unsupported company report/) }
  const unknownLocations = fixture(); unknownLocations.source_files[0].locator = null
  assert.doesNotThrow(() => parseCompanyReport(unknownLocations))
})
