import test from 'node:test'
import assert from 'node:assert/strict'
import { ENFUCE, emptyWorkspace, defaultConfig, generateSections, generateBackendSections, reorder, reportMarkdown, citedEvidenceIds, backendDraftEvidenceStatus, safeUrl } from '../src/domain.ts'

test('reordering preserves every module and does not mutate the source', () => {
  const source = ['overview', 'market', 'financials']
  assert.deepEqual(reorder(source, 2, 0), ['financials', 'overview', 'market'])
  assert.deepEqual(source, ['overview', 'market', 'financials'])
  assert.deepEqual(reorder(source, -1, 2), source)
})

test('a new project never inherits Enfuce claims or metrics', () => {
  const project = { ...ENFUCE, id: 'a-new-project', name: 'New project' }
  const sections = generateSections(project, emptyWorkspace())
  assert.equal(sections.every(section => section.evidenceIds.length === 0), true)
  assert.doesNotMatch(reportMarkdown(project, sections), /3,452,682|16 customers|5,095/)
  assert.match(sections[0].content, /No supporting evidence/)
})

test('financial sub-topics control which facts are included; missing inputs are explicit', () => {
  const workspace = emptyWorkspace()
  workspace.order = ['financials']
  workspace.configs.financials = { ...defaultConfig('financials'), topics: ['Cash & runway'] }
  const [section] = generateSections(ENFUCE, workspace)
  assert.deepEqual(section.evidenceIds, [])
  assert.match(section.content, /cannot be calculated/)
  assert.doesNotMatch(section.content, /3,452,682/)
})

test('scope requests are preserved without implying live external research was performed', () => {
  const workspace = emptyWorkspace()
  workspace.order = ['market']
  workspace.configs.market = { ...defaultConfig('market'), scope: 'Internal + external', focus: 'Gen Z purchasing behavior', geography: 'US', depth: 'Deep' }
  const [section] = generateSections(ENFUCE, workspace)
  assert.match(section.content, /No external search has been executed/)
  assert.match(section.content, /Gen Z purchasing behavior/)
  assert.match(section.content, /deep · US/)
  assert.deepEqual(section.evidenceIds, [])
})

test('exports cite only references that remain in the edited text', () => {
  const workspace = emptyWorkspace()
  workspace.order = ['financials']
  const sections = generateSections(ENFUCE, workspace)
  sections[0].content = 'Human revision with just this reference. [gross]'
  assert.deepEqual(citedEvidenceIds(sections), ['gross'])
  const output = reportMarkdown(ENFUCE, sections)
  assert.match(output, /PL · F7:F9/)
  assert.doesNotMatch(output, /\- \[income\]/)
  assert.match(output, /not been reverified/)
})

test('source links reject script and data protocols', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null)
  assert.equal(safeUrl('data:text/html,<h1>x</h1>'), null)
  assert.equal(safeUrl('not-a-url'), null)
  assert.equal(safeUrl('https://example.com/research'), 'https://example.com/research')
})

const circle = { ...ENFUCE, id: 'circle', name: 'Circle' }
const calculationId = '535c3ad6-f048-5923-b56e-6cddcf5450a6'
const profileId = 'field:11111111-1111-1111-1111-111111111111:/firmographic/legal_name'
const calculation = {
  id: calculationId, kind: 'calculation', metricKey: 'revenue', title: 'Recorded revenue', value: '9,007,199,254,740,993.0123456789 USD',
  file: 'source.xlsx', locator: 'Sheet Revenue · Cell B2', period: '2025-01-01 – 2025-06-30', unit: 'USD',
  status: 'Reproduced', description: 'Stored calculation', excerpt: 'SUM(inputs)', rows: [['Stored result', '9007199254740993.0123456789']],
  formula: 'SUM(inputs)', note: 'Stored partial-year result.', category: 'Financial data', conflictNumbers: true,
  calculation: { function_key: 'revenue.sum', function_version: '2', status: 'succeeded', parameters: { annualized: false } },
  inputIds: ['22222222-2222-2222-2222-222222222222'],
  sources: [{ snapshot_id: '11111111-1111-1111-1111-111111111111', file_name: 'source.xlsx', sha256: 'a'.repeat(64), locator: { kind: 'excel_cell', sheet: 'Revenue', cell: 'B2' } }],
}
const profile = {
  ...calculation, id: profileId, kind: 'profile', title: 'Legal name', value: 'Circle Internet Group, Inc.',
  unit: 'Profile field', status: 'Reported', formula: undefined, calculation: undefined, inputIds: [], conflictNumbers: false,
  rows: [['Field', '/firmographic/legal_name']],
}

test('backend reports preserve exact stored values, formulas, periods and source IDs', () => {
  const workspace = emptyWorkspace()
  workspace.order = ['overview', 'financials', 'market', 'questions']
  const report = { company: { deal_id: 'circle-2025-ipo' }, gaps: [{ message: 'Runway inputs unavailable.' }], conflict_numbers: true }
  const sections = generateBackendSections(circle, workspace, report, [calculation, profile])
  assert.match(sections[0].content, /Circle Internet Group, Inc\./)
  const financial = sections.find(section => section.id === 'financials')
  assert.match(financial.content, /9,007,199,254,740,993\.0123456789 USD/)
  assert.match(financial.content, /2025-01-01 – 2025-06-30/)
  assert.match(financial.content, /SUM\(inputs\)/)
  assert.match(financial.content, /revenue\.sum v2/)
  assert.match(financial.content, /22222222-2222-2222-2222-222222222222/)
  assert.match(financial.content, /Conflict numbers/)
  assert.match(financial.content, /Runway inputs unavailable/)
  assert.match(sections.find(section => section.id === 'market').content, /No supporting evidence/)
  assert.deepEqual(financial.evidenceIds, [calculationId])
  assert.equal(workspace.sections.length, 0)
  assert.throws(() => generateBackendSections(circle, workspace, { ...report, company: { deal_id: 'other-company' } }, []), /does not belong/)
})

test('edited backend citations keep UUID and profile paths with complete export provenance', () => {
  const sections = [{ id: 'financials', title: 'Financials', content: `Human revision. [${calculationId}] [${profileId}] [unknown-id]`, evidenceIds: [], config: defaultConfig('financials') }]
  const evidence = [calculation, profile]
  assert.deepEqual(citedEvidenceIds(sections, evidence), [calculationId, profileId])
  sections[0].content = `Human revision. [${calculationId}] [${profileId}]`
  const output = reportMarkdown(circle, sections, evidence, { kind: 'backend', reportId: 'report-123', loadedReportId: 'report-123', reportVersion: '1' })
  assert.match(output, /Report ID: report-123/)
  assert.match(output, /9007199254740993\.0123456789/)
  assert.match(output, /Input observation IDs: 22222222-2222-2222-2222-222222222222/)
  assert.match(output, /revenue\.sum v2/)
  assert.match(output, /"sheet":"Revenue","cell":"B2"/)
  assert.match(output, new RegExp('a'.repeat(64)))
  assert.doesNotMatch(output, /Historical saved extracts/)
  sections[0].content = `Keep only the profile. [${profileId}]`
  assert.deepEqual(citedEvidenceIds(sections, evidence), [profileId])
  assert.doesNotMatch(reportMarkdown(circle, sections, evidence), new RegExp(`- \\[${calculationId}\\]`))
})

test('backend financial topic selection excludes unrelated metrics while defaults retain the inventory', () => {
  const workspace = emptyWorkspace()
  workspace.order = ['financials']
  const report = { company: { deal_id: 'circle-2025-ipo' }, gaps: [], conflict_numbers: false }
  const cash = { ...calculation, id: 'cash-id', metricKey: 'orbis.cash_and_cash_equivalents', title: 'Native cash balance', value: '123.45 USD', kind: 'observation', rawValue: '123.45' }
  const assets = { ...calculation, id: 'assets-id', metricKey: 'source_total_assets_replay', title: 'Source total assets replay' }
  const [complete] = generateBackendSections(circle, workspace, report, [calculation, cash, assets])
  assert.deepEqual(complete.evidenceIds, [calculationId, 'cash-id', 'assets-id'])
  workspace.configs.financials = { ...defaultConfig('financials'), topics: ['Cash & runway'] }
  const [filtered] = generateBackendSections(circle, workspace, report, [calculation, cash, assets])
  assert.deepEqual(filtered.evidenceIds, ['cash-id'])
  assert.doesNotMatch(filtered.content, /Recorded revenue|Source total assets replay/)
  assert.match(filtered.content, /Recorded source token: 123.45/)
})

test('backend exports refuse stale drafts and missing citations without changing human edits', () => {
  const section = { id: 'financials', title: 'Financials', content: `Human note retained. [${calculationId}]`, evidenceIds: [calculationId], config: defaultConfig('financials') }
  const sections = [section]
  const unchanged = JSON.stringify(sections)
  assert.equal(backendDraftEvidenceStatus(sections, 'older-report', 'current-report', [calculation]).blocked, true)
  assert.equal(backendDraftEvidenceStatus(sections, undefined, 'current-report', [calculation]).blocked, true)
  assert.throws(() => reportMarkdown(circle, sections, [calculation], { kind: 'backend', reportId: 'older-report', loadedReportId: 'current-report' }), /Regenerate/)
  const missing = backendDraftEvidenceStatus(sections, 'current-report', 'current-report', [])
  assert.deepEqual(missing.missingIds, [calculationId])
  assert.equal(missing.blocked, true)
  assert.throws(() => reportMarkdown(circle, sections, [], { kind: 'backend', reportId: 'current-report', loadedReportId: 'current-report' }), /citations are unavailable/)
  assert.equal(backendDraftEvidenceStatus(sections, 'current-report', 'current-report', [calculation]).blocked, false)
  assert.equal(JSON.stringify(sections), unchanged)
})

test('native metric brackets are text while unavailable backend source IDs still block export', () => {
  const section = { id: 'financials', title: 'Financials', content: `Profit before tax [PBT]; [Net income]; [EBIT]; [PAT]; [Net Income before D&A]. [${calculationId}]`, evidenceIds: [calculationId], config: defaultConfig('financials') }
  const context = { kind: 'backend', reportId: 'same-report', loadedReportId: 'same-report' }
  assert.deepEqual(backendDraftEvidenceStatus([section], 'same-report', 'same-report', [calculation]).missingIds, [])
  assert.match(reportMarkdown(circle, [section], [calculation], context), /Profit before tax \[PBT\]/)
  assert.deepEqual(backendDraftEvidenceStatus([section], 'same-report', 'same-report', []).missingIds, [calculationId])
  section.content += ` [field:missing-snapshot:/legal_name]`
  assert.deepEqual(backendDraftEvidenceStatus([section], 'same-report', 'same-report', [calculation]).missingIds, ['field:missing-snapshot:/legal_name'])
})
