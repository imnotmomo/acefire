import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyWorkspace, defaultBackendConfig } from '../src/domain.ts'
import { checkedSharedWorkspace, checkedSharedReport, checkedSharedReportList, workspaceForDraftPreferences, sharedReportError } from '../src/sharedReports.ts'
import { assertReportOperationCurrent, reportFilename } from '../src/reportOperations.ts'

const date = '2026-10-26T12:00:00Z'
function workspace() {
  return { ...emptyWorkspace(), order: ['financials'], configs: { financials: defaultBackendConfig('financials') }, generatedAt: date,
    sections: [{ id: 'financials', title: 'Financials', content: 'Source value 9007199254740993.0123456789. [source-id]', evidenceIds: ['source-id'], config: defaultBackendConfig('financials'),
      sourceClaims: [{ id: 'claim-id', text: 'Source value 9007199254740993.0123456789.', kind: 'reported_summary', citations: [{ evidence_id: 'source-id', kind: 'observation', quote: '9007199254740993.0123456789', quote_basis: 'structured_record', source: { snapshot_id: 'snapshot-id', file_name: '财务.csv', sha256: 'a'.repeat(64), provider: 'upload', deal_id: 'circle', locator: { row: 7 } } }] }],
      generation: { draftId: 'draft-id', model: 'model', generatedAt: date, status: 'model_generated_unverified' } }] }
}
function record(saved = workspace()) { return { id: 'draft-id', deal_id: 'circle', version: 2, created_at: date, updated_at: date, based_on_report_id: 'report-v1', model: 'model', section_count: 1, draft: null, workspace: saved } }

test('shared report round trip preserves exact decimal tokens, sentences and source locators', () => {
  const original = record()
  const checked = checkedSharedReport(JSON.parse(JSON.stringify(original)), 'circle')
  assert.deepEqual(checked, original)
  checked.workspace.sections[0].sourceClaims[0].citations[0].source.locator.row = 8
  assert.equal(original.workspace.sections[0].sourceClaims[0].citations[0].source.locator.row, 7)
  assert.equal(checked.workspace.sections[0].sourceClaims[0].citations[0].quote, '9007199254740993.0123456789')
})

test('large sourced workspaces retain all revisions and citations above the old450KB limit', () => {
  const saved = workspace()
  const exact = 'Human history preserves 9007199254740993.0123456789 and the original quotation. '.repeat(800)
  saved.revisions = Array.from({ length: 35 }, (_, index) => ({ id: `history-${index}`, at: date, section: 'financials', title: 'Financials', before: exact + 'Before', after: exact + 'After', author: 'You' }))
  const bytes = new TextEncoder().encode(JSON.stringify(saved)).length
  assert.ok(bytes > 4000000 && bytes < 5_000_000)
  const checked = checkedSharedReport(JSON.parse(JSON.stringify(record(saved))), 'circle')
  assert.deepEqual(checked.workspace, saved)
  assert.equal(checked.workspace.revisions.length, 35)
  assert.equal(checked.workspace.sections[0].sourceClaims[0].citations[0].source.sha256, 'a'.repeat(64))
  const oversized = structuredClone(saved); oversized.revisions.push(...structuredClone(saved.revisions))
  assert.throws(() => checkedSharedWorkspace(oversized, 'circle'), /5 MB/)
})

test('saved workspaces reject foreign companies, malformed settings and missing quotation provenance before replacement', () => {
  const changes = [
    w => { w.sections[0].sourceClaims[0].citations[0].source.deal_id = 'other' },
    w => { delete w.configs.financials.topics },
    w => { w.sections[0].sourceClaims[0].citations[0].source.sha256 = 'not-a-hash' },
    w => { w.sections.push(w.sections[0]) },
    w => { w.order.push('financials') },
    w => { w.revisions = [{ id: 'x', at: date, section: 'financials', title: 'Financials', before: '', after: 'Edited', author: null }] },
  ]
  for (const change of changes) { const w = workspace(); change(w); assert.throws(() => checkedSharedWorkspace(w, 'circle'), /preserved/) }
  assert.throws(() => checkedSharedReport(record(), 'wrong-company'), /company/)
  const tooLarge = workspace(); tooLarge.sections[0].content = 'X'.repeat(450001)
  assert.throws(() => checkedSharedWorkspace(tooLarge, 'circle'), /preserved/)
})

test('report lists validate versions and duplicate IDs and accept empty lists', () => {
  const { workspace: ignored, draft, deal_id, ...summary } = record()
  assert.deepEqual(checkedSharedReportList({ drafts: [summary] }), [summary])
  assert.deepEqual(checkedSharedReportList({ drafts: [] }), [])
  assert.throws(() => checkedSharedReportList({ drafts: [summary, summary] }))
  assert.throws(() => checkedSharedReportList({ drafts: [{ ...summary, version: 0 }] }))
})

test('stored module preferences must be complete and never silently overwrite with undefined settings', () => {
  const w = workspace(), preference = { id: 'financials', ...defaultBackendConfig('financials') }
  assert.deepEqual(workspaceForDraftPreferences(w, { drafting_preferences: [preference] }, 'circle').configs.financials, defaultBackendConfig('financials'))
  assert.throws(() => workspaceForDraftPreferences(w, { drafting_preferences: [{ id: 'financials' }] }, 'circle'), /configuration/)
  assert.throws(() => workspaceForDraftPreferences(w, { drafting_preferences: [preference, preference] }, 'circle'), /configuration/)
})

test('optimistic version conflicts and stale evidence provide distinct recovery instructions', () => {
  assert.equal(sharedReportError({ detail: { code: 'draft_version_conflict' } }, 409).conflict, true)
  assert.match(sharedReportError({}, 409).message, /keep both/)
  assert.equal(sharedReportError({ detail: { code: 'stale_report', message: 'Refresh evidence' } }, 409).conflict, false)
  assert.match(sharedReportError({ detail: { message: 'Temporary outage' } }, 503).message, /Temporary outage/)
  assert.equal(sharedReportError({ detail: { code: 'draft_storage_integrity', message: 'Storage integrity failed' } }, 409).conflict, false)
  assert.match(sharedReportError({ detail: { code: 'draft_storage_integrity', message: 'Storage integrity failed' } }, 409).message, /integrity/)
})

test('generation and loading detect settings, text and evidence races while accepting unchanged copies', () => {
  const before = workspace()
  assert.doesNotThrow(() => assertReportOperationCurrent(before, structuredClone(before), 'v1', 'v1'))
  const mutations = [w => { w.configs.financials.focus = 'new focus' }, w => { w.order = [] }, w => { w.sections[0].content += ' Human review.' }, w => { w.backendEvidenceCheckedAt = date }]
  for (const change of mutations) { const after = structuredClone(before); change(after); assert.throws(() => assertReportOperationCurrent(before, after, 'v1', 'v1'), /preserved/) }
  assert.throws(() => assertReportOperationCurrent(before, before, 'v1', 'v2'), /evidence changed/)
})

test('export filenames retain Unicode company names and reject path/control characters', () => {
  assert.equal(reportFilename('财务公司'), '财务公司-diligence-report')
  assert.equal(reportFilename('A/B:C\u0000'), 'A-B-C--diligence-report')
  assert.equal(reportFilename('  ...  '), 'company-diligence-report')
})
