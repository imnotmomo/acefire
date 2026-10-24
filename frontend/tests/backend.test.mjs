import test from 'node:test'
import assert from 'node:assert/strict'
import { backendProjectId, apiUrl, formatDecimal, formatLocator, parseCompanyReport, reportEvidence, fetchCompanyReport, apiFetch, setApiAccessTokenProvider, sourceFileUrl } from '../src/backend.ts'

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
  const unknownLocations = JSON.parse(JSON.stringify(fixture())); unknownLocations.source_files[0].locator = null
  assert.doesNotThrow(() => parseCompanyReport(unknownLocations))
})


function documentFixture() {
  const report = fixture()
  const documentSource = { ...source, snapshot_id: 'pdf-source-1', file_name: 'synthetic-company.pdf', provider: 'uploaded', sha256: 'a'.repeat(64), preview_url: '/sources/pdf-source-1/file', locator: null }
  report.company = { ...report.company, deal_id: 'enfuce-2020', entity_key: 'enfuce-documents', legal_name: 'Enfuce' }
  report.source_files = [documentSource]
  report.reported_metrics = []; report.calculations = []; report.conflicts = []; report.conflict_numbers = false
  report.primary_profile = { available: false, provider: 'akta', records: [], field_lineage: { fields: [], sources: [], nodes: [], edges: [] } }
  report.source_graph = { nodes: [], edges: [] }
  report.document_claims = [{ id: 'synthetic-document-claim', deal_id: report.company.deal_id, entity_key: report.company.entity_key, snapshot_id: documentSource.snapshot_id, statement: 'B paraphrase: the company has a broad customer portfolio.', claim_type: 'customer_profile', extractor_version: 'b-document-extraction-v3', model: 'test-extractor', verification_status: 'needs_review', effective_date: null, limitations: ['Customer figures are reported in the source.'], numeric: null, numeric_source: null, evidence: [{ snapshot_id: documentSource.snapshot_id, original_snapshot_id: documentSource.snapshot_id, quote: 'The company has 14 customers.', locator: { kind: 'pdf_page', page: 2, extractor_version: 'b-document-extraction-v3' }, quote_match_rule: 'NFKC_whitespace_quote_typography_v1', representation_kind: 'original_pdf', original_locators: [], original_locator_origin: null, original_locator_status: null }] }]
  return report
}

test('document company mapping preserves the separate legacy Enfuce fixture', () => {
  assert.equal(backendProjectId('enfuce-documents'), 'enfuce-2020')
  assert.equal(backendProjectId('enfuce-2020'), 'enfuce-2020')
  assert.equal(backendProjectId('enfuce'), null)
  assert.equal(backendProjectId('circle-2025-ipo'), dealId)
})

test('B document claims expose original stored quotes rather than extracted paraphrases', () => {
  const report = parseCompanyReport(documentFixture(), 'enfuce-2020')
  const [item] = reportEvidence(report)
  const claim = report.document_claims[0]
  assert.equal(item.id, `claim:${claim.id}:evidence:0`)
  assert.equal(item.kind, 'statement')
  assert.equal(item.value, claim.evidence[0].quote)
  assert.equal(item.excerpt, claim.evidence[0].quote)
  assert.notEqual(item.excerpt, claim.statement)
  assert.equal(item.title, claim.statement)
  assert.equal(item.sources[0].provider, 'uploaded')
  assert.equal(item.sources[0].locator.page, 2)
  assert.equal(item.hash, 'a'.repeat(64))
  assert.equal(item.context.claim_type, 'customer_profile')
  assert.equal(item.context.extractor_version, 'b-document-extraction-v3')
  assert.equal(item.context.quote_match_rule, 'NFKC_whitespace_quote_typography_v1')
  assert.match(item.note, /paraphrase/)
  assert.match(item.note, /does not assert a byte-exact match/)
  assert.equal(item.reviewState, 'verify')
  assert.equal(item.graph.nodes[1].data.text, claim.evidence[0].quote)
  assert.equal(item.graph.edges[0].target, item.id)
})

test('document evidence rejects wrong company, entity, snapshot and malformed optional arrays', () => {
  const mutations = [
    value => { value.document_claims = null },
    value => { value.document_claims = [null] },
    value => { value.document_claims[0].id = 12 },
    value => { value.document_claims.push(structuredClone(value.document_claims[0])) },
    value => { value.document_claims[0].deal_id = dealId },
    value => { value.document_claims[0].entity_key = 'different-entity' },
    value => { value.document_claims[0].snapshot_id = 'foreign-file' },
    value => { value.document_claims[0].evidence[0].snapshot_id = 'foreign-file' },
    value => { value.document_claims[0].evidence[0].original_snapshot_id = 'foreign-file' },
    value => { value.document_claims[0].evidence = [null] },
    value => { value.document_claims[0].evidence[0].quote = { paraphrase: 'Wrong type' } },
    value => { value.document_claims[0].evidence[0].quote = '  ' },
    value => { value.document_claims[0].evidence[0].original_locators = [null] },
    value => { value.document_claims[0].limitations = [null] },
    value => { value.source_files[0].deal_id = dealId },
    value => { value.source_files[0].entity_key = 'foreign-entity' },
  ]
  for (const mutate of mutations) { const value = documentFixture(); mutate(value); assert.throws(() => parseCompanyReport(value), /unsupported company report/) }
})

test('server narrative catalog preserves exact numeric descriptors, original source text and unique evidence IDs', () => {
  const report = fixture()
  const profileId = 'field:source-1:/legal_name'
  const exactDescriptor = 'Normalized source amount 9007199254740993.1250 USD; original raw amount 9007199254740993.1250.'
  report.narrative_evidence = [
    { id: observation.id, deal_id: dealId, kind: 'observation', title: 'Stored assets', text: exactDescriptor, source, quote_basis: 'structured_record' },
    { id: profileId, deal_id: dealId, kind: 'statement', title: 'Legal name', text: 'Circle', source: report.primary_profile.field_lineage.fields[0].source, quote_basis: 'source_text' },
  ]
  const catalog = reportEvidence(parseCompanyReport(report))
  assert.equal(catalog.find(item => item.id === observation.id).citationText, exactDescriptor)
  assert.equal(catalog.find(item => item.id === observation.id).quoteBasis, 'structured_record')
  assert.equal(catalog.filter(item => item.id === profileId).length, 1)
  assert.equal(catalog.find(item => item.id === profileId).citationText, 'Circle')
  const document = documentFixture()
  const claim = document.document_claims[0]
  const original = { ...document.source_files[0], locator: structuredClone(claim.evidence[0].locator) }
  document.narrative_evidence = [{ id: `claim:${claim.id}:evidence:0`, deal_id: document.company.deal_id, kind: 'statement', title: claim.statement, text: claim.evidence[0].quote, source: original, quote_basis: 'source_text' }]
  assert.equal(reportEvidence(parseCompanyReport(document))[0].citationText, claim.evidence[0].quote)
  for (const mutate of [value => { value.narrative_evidence = [null] }, value => { value.narrative_evidence[0].id = 'claim:unknown:evidence:0' }, value => { value.narrative_evidence[0].text = claim.statement }, value => { value.narrative_evidence[0].source.sha256 = 'f'.repeat(64) }, value => { value.narrative_evidence[0].source.locator.page = 99 }, value => { value.narrative_evidence[0].quote_basis = 'structured_record' }, value => { value.narrative_evidence[0].deal_id = dealId }, value => { value.narrative_evidence.push(structuredClone(value.narrative_evidence[0])) }]) {
    const changed = structuredClone(document); mutate(changed); assert.throws(() => parseCompanyReport(changed), /unsupported company report/)
  }
})

test('normalization fields distinguish missing data, retained ranges and actual zero', () => {
  const missing = fixture(); Object.assign(missing.reported_metrics[0].observation, { normalization_status: 'missing', value: null, raw_value: 'N.a.' })
  const missingItem = reportEvidence(parseCompanyReport(missing)).find(item => item.kind === 'observation')
  // Remove the independent conflict flag to inspect the underlying data state.
  missing.conflicts = []
  assert.equal(reportEvidence(parseCompanyReport(missing)).find(item => item.kind === 'observation').reviewState, 'missing')
  assert.equal(missingItem.normalizationStatus, 'missing')
  assert.equal(missingItem.normalizedValue, null)
  const range = fixture(); range.conflicts = []; Object.assign(range.reported_metrics[0].observation, { normalization_status: 'unresolved', value: null, raw_value: '$25B+' })
  assert.equal(reportEvidence(parseCompanyReport(range)).find(item => item.kind === 'observation').reviewState, 'verify')
  const zero = fixture(); zero.conflicts = []; Object.assign(zero.reported_metrics[0].observation, { value: '0', raw_value: '0' })
  const zeroItem = reportEvidence(parseCompanyReport(zero)).find(item => item.kind === 'observation')
  assert.equal(zeroItem.normalizedValue, '0')
  assert.equal(zeroItem.reviewState, 'verify')
})

test('source URLs support canonical files and HTTPS signed storage without allowing active protocols', () => {
  const signed = 'https://storage.example.test/company.pdf?alt=media&token=synthetic-signature'
  assert.equal(sourceFileUrl('/sources/source-1/file'), '/api/sources/source-1/file')
  assert.equal(sourceFileUrl(signed), signed)
  const report = fixture(); report.source_files[0].preview_url = signed; report.source_files[0].preview_available = false
  assert.doesNotThrow(() => parseCompanyReport(report))
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,test', '//storage.example.test/file', 'http://storage.example.test/file', 'https://user:password@storage.example.test/file', '/sources/../file', '/sources/%2e%2e/file', '/sources/source-1/file#fragment', 'https://storage.example.test/\\evil']) {
    assert.throws(() => sourceFileUrl(unsafe), /source file URL/)
    const changed = fixture(); changed.source_files[0].preview_url = unsafe
    assert.throws(() => parseCompanyReport(changed), /unsupported company report/)
  }
  const badAvailable = fixture(); badAvailable.source_files[0].preview_available = 'yes'
  assert.throws(() => parseCompanyReport(badAvailable), /unsupported company report/)
})

test('replaceable API authentication stays on API paths and never follows signed-storage redirects', async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const calls = []
  let tokenRequests = 0
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Authentication tokens must not be stored here.') } })
    globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }) }
    setApiAccessTokenProvider(null)
    await apiFetch('/health', { headers: { Accept: 'application/json' } })
    assert.equal(calls[0].options.headers.get('Authorization'), null)
    setApiAccessTokenProvider(async () => { tokenRequests++; return `synthetic-firebase-token-${tokenRequests}` })
    await apiFetch('/deals/circle/report', { headers: { 'X-Request': 'test' }, redirect: 'follow' })
    assert.equal(calls[1].url, '/api/deals/circle/report')
    assert.equal(calls[1].options.headers.get('Authorization'), 'Bearer synthetic-firebase-token-1')
    assert.equal(calls[1].options.headers.get('X-Request'), 'test')
    assert.equal(calls[1].options.redirect, 'error')
    await apiFetch('/health')
    assert.equal(calls[2].options.headers.get('Authorization'), 'Bearer synthetic-firebase-token-2')
    const signed = 'https://storage.example.test/file?token=synthetic-storage-grant'
    await assert.rejects(apiFetch(signed), /canonical relative path/)
    await assert.rejects(apiFetch('//storage.example.test/file'), /canonical relative path/)
    await assert.rejects(apiFetch('/sources/../file'), /canonical relative path/)
    assert.equal(tokenRequests, 2)
    assert.equal(sourceFileUrl(signed), signed)
    assert.equal(calls.length, 3)
    setApiAccessTokenProvider(async () => null)
    await apiFetch('/health', { headers: { Authorization: 'Bearer stale-token' } })
    assert.equal(calls[3].options.headers.get('Authorization'), null)
  } finally {
    setApiAccessTokenProvider(null)
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else delete globalThis.localStorage
  }
})


test('all rendered numeric inputs remain bound to their registered company source records', () => {
  const mutations = [
    value => { value.reported_metrics[0].observation.snapshot_id = 'foreign-file' },
    value => { value.reported_metrics[0].observation.entity_key = 'foreign-company' },
    value => { value.reported_metrics[0].source.provider = 'uploaded' },
    value => { value.calculations[0].calculation.input_ids = ['invented-record'] },
    value => { value.calculations[0].calculation.input_snapshots = ['foreign-file'] },
    value => { value.calculations[0].inputs[0].observation = { ...value.calculations[0].inputs[0].observation, value: '123' } },
    value => { value.source_files.push(structuredClone(value.source_files[0])) },
  ]
  for (const mutate of mutations) { const value = JSON.parse(JSON.stringify(fixture())); mutate(value); assert.throws(() => parseCompanyReport(value), /unsupported company report/) }
})
