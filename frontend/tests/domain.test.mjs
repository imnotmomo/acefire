import test from 'node:test'
import assert from 'node:assert/strict'
import { ENFUCE, emptyWorkspace, defaultConfig, generateSections, generateBackendSections, generatedDraftToSections, reorder, reportMarkdown, citedEvidenceIds, backendDraftEvidenceStatus, safeUrl } from '../src/domain.ts'

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


const statement = { ...profile, title: 'Company description', value: 'Circle provides programmable money services.', excerpt: 'Circle provides programmable money services.', citationText: 'Circle provides programmable money services.', quoteBasis: 'source_text', sources: [{ ...profile.sources[0], file_name: 'company.json', locator: { kind: 'json_pointer', pointer: '/response/data/firmographic/company_description_short' } }] }
const numericNarrativeEvidence = { ...calculation, citationText: 'Stored revenue record: 9007199254740993.0123456789 USD for 2025-01-01 to 2025-06-30.', quoteBasis: 'structured_record' }
function narrativeFixture() {
  const workspace = emptyWorkspace(); workspace.order = ['overview', 'financials', 'market']
  const report = { report_id: 'narrative-report-version', company: { deal_id: 'circle-2025-ipo' } }
  const draft = { id: 'narrative-draft-id', deal_id: 'circle-2025-ipo', based_on_report_id: report.report_id, model: 'openai/gpt-6.1-sol', generated_at: '2026-10-24T17:00:00Z', status: 'model_generated_unverified', sections: [
    { id: 'overview', title: 'Company overview', claims: [{ id: 'overview-claim', text: 'The saved company description presents Circle as a provider of programmable money services.', kind: 'reported_summary', citations: [{ evidence_id: profileId, kind: 'statement', quote: statement.excerpt }] }], gaps: [] },
    { id: 'financials', title: 'Financials', claims: [{ id: 'financial-claim', text: 'The stored partial-period revenue record remains available for review.', kind: 'reported_summary', citations: [{ evidence_id: calculationId, kind: 'calculation', quote: numericNarrativeEvidence.citationText }] }], gaps: [] },
    { id: 'market', title: 'Market', claims: [], gaps: ['No source-backed market sizing was supplied.'] },
  ] }
  return { workspace, report, draft }
}

test('model narrative sections retain claim-to-quote-to-file links and explicit unsupported gaps', () => {
  const { workspace, report, draft } = narrativeFixture()
  const before = JSON.stringify(workspace)
  const sections = generatedDraftToSections(circle, workspace, report, [statement, numericNarrativeEvidence], draft)
  assert.deepEqual(sections.map(section => section.id), workspace.order)
  assert.match(sections[0].content, /saved company description/)
  assert.match(sections[0].content, new RegExp(profileId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(sections[0].sourceClaims[0].citations[0].quote, statement.excerpt)
  assert.equal(sections[0].sourceClaims[0].citations[0].source.locator.pointer, '/response/data/firmographic/company_description_short')
  assert.equal(sections[1].sourceClaims[0].citations[0].quote_basis, 'structured_record')
  assert.match(sections[2].content, /Evidence gap: No source-backed market sizing/)
  assert.equal(JSON.stringify(workspace), before)
  const markdown = reportMarkdown(circle, sections, [statement, numericNarrativeEvidence], { kind: 'backend', reportId: report.report_id, loadedReportId: report.report_id, draftId: draft.id, model: draft.model })
  assert.match(markdown, /Claim-to-source quotations/)
  assert.match(markdown, /Original model summary: The saved company description/)
  assert.match(markdown, /> Circle provides programmable money services\./)
  assert.match(markdown, /Stored numeric record \(structured backend evidence, not a verbatim document sentence\)/)
  assert.match(markdown, /9007199254740993\.0123456789/)
  assert.match(markdown, /company_description_short/)
  assert.match(markdown, new RegExp('a'.repeat(64)))
  assert.match(markdown, /narrative-draft-id/)
})

test('invalid narrative drafts cannot replace edits or introduce unbound quotations', () => {
  const { workspace, report, draft } = narrativeFixture()
  workspace.sections = [{ id: 'overview', title: 'Company overview', content: 'My existing edited draft.', evidenceIds: [], config: defaultConfig('overview') }]
  const unchanged = JSON.stringify(workspace)
  const badDrafts = [
    { ...draft, deal_id: 'different-company' },
    { ...draft, based_on_report_id: 'outdated-report' },
    { ...draft, sections: draft.sections.slice(1) },
    { ...draft, sections: [...draft.sections, draft.sections[0]] },
    { ...draft, sections: draft.sections.map((section, index) => index ? section : { ...section, claims: [{ ...section.claims[0], citations: [] }] }) },
    { ...draft, sections: draft.sections.map((section, index) => index ? section : { ...section, claims: [{ ...section.claims[0], citations: [{ evidence_id: 'invented-evidence', kind: 'statement', quote: statement.excerpt }] }] }) },
    { ...draft, sections: draft.sections.map((section, index) => index ? section : { ...section, claims: [{ ...section.claims[0], citations: [{ evidence_id: profileId, kind: 'statement', quote: 'Invented source sentence.' }] }] }) },
    { ...draft, sections: draft.sections.map((section, index) => index ? section : { ...section, claims: [{ ...section.claims[0], citations: [{ evidence_id: profileId, kind: 'statement', quote: statement.excerpt, source: { ...statement.sources[0], sha256: 'f'.repeat(64) } }] }] }) },
  ]
  for (const candidate of badDrafts) assert.throws(() => generatedDraftToSections(circle, workspace, report, [statement, numericNarrativeEvidence], candidate), /preserved/)
  assert.equal(JSON.stringify(workspace), unchanged)
})

test('narrative export omits removed citation support and labels human-edited source relationships', () => {
  const { workspace, report, draft } = narrativeFixture()
  const sections = generatedDraftToSections(circle, workspace, report, [statement, numericNarrativeEvidence], draft)
  sections[0].content = `Human wording retained. [${profileId}]`; sections[0].humanEdited = true
  let output = reportMarkdown(circle, [sections[0]], [statement], { kind: 'backend', reportId: report.report_id, loadedReportId: report.report_id })
  assert.match(output, /human edited/)
  assert.match(output, /Original model summary/)
  sections[0].content = 'Human wording with the old citation removed.'
  output = reportMarkdown(circle, [sections[0]], [statement], { kind: 'backend', reportId: report.report_id, loadedReportId: report.report_id })
  assert.doesNotMatch(output, /Claim-to-source quotations|Original model summary|> Circle provides/)
})


test('document-company narrative uses its own quoted claims and never inherits the legacy Enfuce fixture', () => {
  const project = { ...ENFUCE, id: 'enfuce-2020', name: 'Enfuce · Document claims' }
  const report = { report_id: 'document-report', company: { deal_id: 'enfuce-2020' } }
  const workspace = emptyWorkspace(); workspace.order = ['customers']
  const id = 'claim:33333333-3333-3333-3333-333333333333:evidence:0'
  const documentEvidence = { ...statement, id, kind: 'statement', citationText: 'The company has 14 customers.', excerpt: 'The company has 14 customers.', sources: [{ ...statement.sources[0], file_name: 'Enfuce source.pdf', locator: { kind: 'pdf_page', page: 2 } }] }
  const draft = { id: 'enfuce-document-draft', deal_id: 'enfuce-2020', based_on_report_id: 'document-report', model: 'test-model', generated_at: '2026-10-24T17:00:00Z', status: 'model_generated_unverified', sections: [{ id: 'customers', title: 'Customers', claims: [{ id: 'customer-claim', text: 'The supplied document reports 14 customers.', kind: 'reported_summary', citations: [{ evidence_id: id, kind: 'statement', quote: 'The company has 14 customers.' }] }], gaps: [] }] }
  const sections = generatedDraftToSections(project, workspace, report, [documentEvidence], draft)
  const text = reportMarkdown(project, sections, [documentEvidence], { kind: 'backend', reportId: report.report_id, loadedReportId: report.report_id })
  assert.match(text, /14 customers/)
  assert.match(text, /Enfuce source\.pdf/)
  assert.doesNotMatch(text, /16 customers|ST1/)
  const missing = backendDraftEvidenceStatus([{ ...sections[0], evidenceIds: [], content: `[${id}]` }], report.report_id, report.report_id, [])
  assert.deepEqual(missing.missingIds, [id])
})
