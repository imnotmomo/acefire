import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ConnectedDashboard from '../../src/ConnectedDashboard'
import { ConnectedEvidenceInspector } from '../../src/ConnectedEvidence'
import { parseCompanyReport, reportEvidence, setApiAccessTokenProvider } from '../../src/backend'
import '../../src/styles.css'
import '../../src/motion.css'
import '../../src/connected.css'

// Synthetic evidence only. No assertion here is a fact about a user's company.
const dealId = 'fixture-evidence-company', exact = '9007199254740993.1250'
const quotes = Array.from({ length: 12 }, (_, index) => index === 0 ? 'Fixture source period covers January through March only.' : `Fixture quotation ${index + 1} names its original source line.`)
const originals = {
  finance: `label,value\nExact source amount,${exact}\nMissing source amount,N.a.\nZero source amount,0\n`,
  pitchbook: 'label,value\nComparable source amount,100.00\n',
  profile: JSON.stringify(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`profile_${i + 1}`, `Fixture profile value ${i + 1}`])), null, 2),
  premises: quotes.join('\n'),
}
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('')
const baseSource = { ingestion_channel: 'user_upload', data_role: 'supplemental_evidence', visibility: 'deal_private' }
const finance = { ...baseSource, snapshot_id: 'finance', file_name: 'fixture-finance.csv', sha256: await hash(originals.finance), provider: 'orbis', preview_url: '/sources/finance/file', locator: { kind: 'csv_row', row: 2, column: 'value' } }
const pitchbook = { ...baseSource, snapshot_id: 'pitchbook', file_name: 'fixture-pitchbook.csv', sha256: await hash(originals.pitchbook), provider: 'pitchbook', preview_url: '/sources/pitchbook/file', locator: { kind: 'csv_row', row: 2, column: 'value' } }
const profile = { ...baseSource, snapshot_id: 'profile', file_name: 'fixture-profile.json', sha256: await hash(originals.profile), provider: 'akta', data_role: 'primary_company_data', preview_url: '/sources/profile/file', locator: { kind: 'json_pointer', pointer: '/profile_1' } }
const premises = { ...baseSource, snapshot_id: 'premises', file_name: 'fixture-premises.txt', sha256: await hash(originals.premises), provider: 'uploaded', preview_url: '/sources/premises/file', locator: { kind: 'text_lines', line_start: 1, line_end: 1 } }
const missingOriginal = { ...baseSource, snapshot_id: 'missing-original', file_name: 'fixture-unavailable.pdf', sha256: 'd'.repeat(64), provider: 'uploaded', preview_url: '/sources/missing-original/file', preview_available: false, locator: { kind: 'pdf_page', page: 4 } }
const metrics = Array.from({ length: 25 }, (_, index) => {
  const source = index === 24 ? missingOriginal : index % 2 ? pitchbook : finance
  const value = index === 0 ? exact : index === 1 ? null : index === 2 ? '0' : String(100 + index)
  const observation = { id: `observation-${index + 1}`, deal_id: dealId, entity_key: dealId, snapshot_id: source.snapshot_id, provider: source.provider,
    metric_key: `fixture.metric_${index + 1}`, raw_label: index === 0 ? 'Exact source amount' : index === 1 ? 'Missing source amount' : index === 2 ? 'Zero source amount' : `Fixture metric ${index + 1}`,
    raw_value: value ?? 'N.a.', value, unit: 'USD', currency: 'USD', scale_multiplier: '1', normalization_status: value === null ? 'missing' : 'confirmed', normalization_basis: 'Fixture source unit', definition_key: 'fixture_amount', scope: 'Fixture consolidated', accounting_basis: 'Fixture basis',
    period_kind: index === 1 ? 'unknown' : index === 2 ? 'instant' : 'duration', period_label: index === 1 ? 'Fixture period unknown' : index === 2 ? 'Fixture closing balance' : 'Fixture Q1 2024', period_start: index < 2 || index > 2 ? '2024-01-01' : null, period_end: index === 1 ? null : index === 2 ? '2024-12-31' : '2024-03-31', scenario: 'actual', verification_status: 'source_located', locator: source.locator, quarantined: false, notes: [] }
  return { observation, source, context: { review_required: true, review_reasons: ['fixture_needs_review'] } }
})
const execution = { mode: 'llm_local', model: 'fixture-model', generation_provider: 'fixture', executor: 'local_python', execution_id: 'execution-fixture', executed_at: '2026-10-26T12:00:00Z', exit_code: 0, cleanup_succeeded: true,
  code: `from decimal import Decimal\nresult = Decimal("${exact}")\nprint(result)\n`, stdout: `{"value":"${exact}"}\n`, stderr: '', code_sha256: 'b'.repeat(64), input_manifest_sha256: 'c'.repeat(64), question: 'Replay the exact supplied fixture amount without annualizing it.', explanation: 'Recorded fixture execution output; not independently verified.', assumptions: ['Only the recorded fixture quarter is covered.'], limitations: ['The fixture does not establish a full-year amount.'],
  supplied_text_evidence: [{ id: 'claim:claim-1:evidence:0', text: quotes[0], source: premises }], premises: [{ evidence_id: 'claim:claim-1:evidence:0', quote: quotes[0], role: 'period constraint', reason: 'Do not infer a full-year result.', source: premises }] }
if (new URLSearchParams(location.search).get('premise') === 'foreign') execution.premises[0].source = { ...premises, snapshot_id: 'foreign-original', sha256: 'e'.repeat(64) }
const calculation = { id: 'calculation-primary', deal_id: dealId, metric_key: 'fixture_exact_replay', function_key: 'llm_local_python', function_version: 'fixture-1', formula: 'recorded source amount', status: 'succeeded', value: exact, unit: 'USD', input_ids: ['observation-1'], input_snapshots: ['finance'], parameters: { agent_execution: execution, period_start: '2024-01-01', period_end: '2024-03-31' }, reasons: ['Fixture review remains required.'] }
const nodes = [
  { id: 'finance', type: 'source', position: { x: 0, y: 0 }, data: { label: 'Original fixture finance', source: finance } },
  { id: 'premises', type: 'source', position: { x: 0, y: 180 }, data: { label: 'Original fixture premise', source: premises } },
  { id: 'observation-1', type: 'observation', position: { x: 355, y: 0 }, data: { label: 'Exact source observation', observation: metrics[0].observation, source: finance } },
  { id: 'text-premise', type: 'text_evidence', position: { x: 355, y: 180 }, data: { label: 'Quoted period constraint', text: quotes[0], source: premises } },
  { id: calculation.id, type: 'calculation', position: { x: 710, y: 90 }, data: { label: 'Recorded fixture result', value: exact, unit: 'USD', calculation } },
]
const edges = [{ id: 'e1', source: 'finance', target: 'observation-1', label: 'Source amount' }, { id: 'e2', source: 'premises', target: 'text-premise', label: 'Original quote' }, { id: 'e3', source: 'observation-1', target: calculation.id, label: 'Numeric input' }, { id: 'e4', source: 'text-premise', target: calculation.id, label: 'Declared premise' }]
const conflict = { id: 'conflict-1', kind: 'value_conflict', observation_ids: ['observation-1', 'observation-4'], alternatives: [
  { value: exact, unit: 'USD', observation_ids: ['observation-1'], sources: [finance], scope: 'Fixture consolidated', definition_key: 'fixture_amount' },
  { value: '103', unit: 'USD', observation_ids: ['observation-4'], sources: [pitchbook], scope: 'Fixture consolidated', definition_key: 'fixture_amount' },
] }
const fields = Array.from({ length: 10 }, (_, i) => ({ field_path: `/profile_${i + 1}`, value: `Fixture profile value ${i + 1}`, source: { ...profile, locator: { kind: 'json_pointer', pointer: `/profile_${i + 1}` } } }))
const coverageBase = { deal_id: dealId, metric_key: 'fixture_amount', scope: 'Fixture consolidated', unit: 'USD', available_start: '2024-01-01', available_end: '2024-03-31', known_periods: [{ observation_id: 'observation-1', period_label: 'Fixture Q1 2024', period_start: '2024-01-01', period_end: '2024-03-31', grain: 'quarter' }], instant_periods: [{ observation_id: 'observation-3', period_label: 'Fixture closing balance', period_end: '2024-12-31' }], unresolved_periods: [{ observation_id: 'observation-2', period_label: 'Fixture period unknown', reason: 'No source dates supplied.' }], gaps: [{ start: '2024-04-01', end: '2024-12-31' }], overlaps: [{ start: '2024-01-01', end: '2024-02-01' }], observation_ids: ['observation-1', 'observation-2', 'observation-3'] }
const report = parseCompanyReport({ report_id: 'evidence-report', report_version: '1', generated_at_utc: '2026-10-26T12:00:00Z', company: { deal_id: dealId, entity_key: dealId, legal_name: 'Synthetic fixture company', domain: '', country: 'Fixture country', primary_provider: 'akta', historical_cutoff: null, identifiers: {} },
  primary_profile: { available: true, provider: 'akta', records: [], field_lineage: { fields, sources: [profile], nodes: [], edges: [] } }, reported_metrics: metrics,
  calculations: [{ calculation, inputs: [{ input_order: 1, input_role: 'Original amount', ...metrics[0] }], sources: [finance], nodes, edges, reasons: [], explanation_steps: [{ kind: 'source_normalization', source: finance, raw_value: exact, scale_multiplier: '1', normalized_value: exact, unit: 'USD', normalization_basis: 'Fixture source unit' }], conflict_numbers: true, conflicts: [conflict] }, { calculation: { ...calculation, id: 'calculation-missing', metric_key: 'fixture_missing_result', value: null, status: 'insufficient_data', input_ids: [], input_snapshots: [], parameters: {} }, inputs: [], sources: [], nodes: [], edges: [], reasons: [], explanation_steps: [], conflict_numbers: false, conflicts: [] }],
  comparisons: [], source_files: [finance, pitchbook, profile, premises, missingOriginal], coverage: [], gaps: [], summary: {}, data_period_coverage: [{ ...coverageBase, provider: 'orbis' }, { ...coverageBase, metric_key: 'fixture_second_coverage', provider: 'pitchbook', known_periods: [], available_start: null, available_end: null }],
  source_graph: { nodes: [...[finance, pitchbook, missingOriginal].map(source => ({ id: source.snapshot_id, type: 'source', data: { label: source.file_name, source } })), ...metrics.map(item => ({ id: item.observation.id, type: 'observation', data: { label: item.observation.raw_label, observation: item.observation } }))], edges: metrics.map(item => ({ id: `source-${item.observation.id}`, source: item.source.snapshot_id, target: item.observation.id })) },
  conflict_numbers: true, conflicts: [conflict], flags: ['Fixture conflict remains for review.'], document_claims: quotes.map((quote, index) => ({ id: `claim-${index + 1}`, deal_id: dealId, entity_key: dealId, snapshot_id: 'premises', statement: `Fixture extracted paraphrase ${index + 1}`, claim_type: 'fixture_source_statement', extractor_version: 'fixture-extractor', evidence: [{ snapshot_id: 'premises', quote, locator: { kind: 'text_lines', line_start: index + 1, line_end: index + 1 }, quote_match_rule: 'exact' }], limitations: ['Synthetic fixture; no user-company fact.'] })) }, dealId)
const evidence = reportEvidence(report)
setApiAccessTokenProvider(async () => 'fixture-evidence-access-token')
Object.assign(window, { evidenceFixture: { report, originals, exact, quotes, evidence } })
function Fixture() {
  const [selected, setSelected] = useState<string | null>(null), [notice, setNotice] = useState(''), [route, setRoute] = useState(''), [refreshes, setRefreshes] = useState(0)
  const item = evidence.find(entry => entry.id === selected)
  return <main style={{ padding: 24 }}><output aria-label="Fixture route">{route}</output><output aria-label="Fixture notification">{notice}</output><output aria-label="Fixture refreshes">{refreshes}</output><ConnectedDashboard project={{ id: dealId, name: 'Synthetic fixture company', sector: 'Fixture', geography: 'Fixture country', created: '', backendDealId: dealId }} report={report} inspect={setSelected} navigate={setRoute} onCalculated={() => setRefreshes(value => value + 1)} onRefresh={() => setRefreshes(value => value + 1)} />{item && <ConnectedEvidenceInspector key={item.id} evidence={item} onClose={() => setSelected(null)} notify={setNotice} />}</main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
