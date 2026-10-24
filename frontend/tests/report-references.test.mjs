import test from 'node:test'
import assert from 'node:assert/strict'
import { backendDraftEvidenceStatus, defaultConfig, emptyWorkspace, reportMarkdown } from '../src/domain.ts'
import { checkedReferenceStatus, refreshReportSourceReferences } from '../src/reportReferences.ts'

const project = { id: 'old-browser-project', backendDealId: 'deal-company', name: 'Company', sector: 'Fintech', geography: 'US', created: '' }
const id = 'claim:11111111-1111-1111-1111-111111111111:evidence:0'
const otherId = '22222222-2222-2222-2222-222222222222'
const source = { snapshot_id: 'source-one', file_name: 'original.pdf', sha256: 'a'.repeat(64), provider: 'uploaded', locator: { kind: 'pdf_page', page: 4 }, preview_url: '/sources/source-one/file', data_role: 'supplemental_evidence', preview_available: false }
const evidence = { id, kind: 'statement', quoteBasis: 'source_text', citationText: 'The company reports 14 customers.', excerpt: 'The company reports 14 customers.', value: 'The company reports 14 customers.', sources: [source], title: 'Customer source', file: source.file_name, locator: 'Page 4', period: '2020', unit: 'Source text', status: 'Needs review', rows: [], note: 'Source-reported, not independently verified.' }
const report = { report_id: 'current-evidence-report', company: { deal_id: 'deal-company' } }
const checkedAt = '2026-10-24T20:00:00Z'
function fixture() {
  return { ...emptyWorkspace(), order: ['customers'], backendReportId: 'original-generation-report', backendReportVersion: '1', backendDraftId: 'original-draft', generatedAt: '2026-10-24T19:00:00Z',
    revisions: [{ id: 'human-revision', author: 'You', before: 'Earlier prose.', after: 'Human wording remains.', at: '2026-10-24T19:30:00Z', section: 'customers', title: 'Customers' }],
    sections: [{ id: 'customers', title: 'Customers', content: `Human wording remains. [${id}]`, evidenceIds: [id], humanEdited: true, config: defaultConfig('customers'),
      sourceClaims: [{ id: 'original-claim', kind: 'reported_summary', text: 'Original model summary.', citations: [{ evidence_id: id, kind: 'statement', quote_basis: 'source_text', quote: evidence.citationText, source: structuredClone(source) }] }],
      generation: { draftId: 'original-draft', model: 'test-model', generatedAt: '2026-10-24T19:00:00Z', status: 'model_generated_unverified' } }] }
}
function context(workspace) {
  return { kind: 'backend', reportId: workspace.backendReportId, loadedReportId: report.report_id, draftId: workspace.backendDraftId,
    evidenceCheckedReportId: workspace.backendEvidenceCheckedReportId, evidenceCheckedAt: workspace.backendEvidenceCheckedAt, referenceCheck: workspace.backendEvidenceReferenceCheck }
}

test('explicit reference refresh keeps human text, revisions and original generation basis while allowing current bound references', () => {
  const original = fixture(); const before = JSON.stringify(original)
  assert.equal(backendDraftEvidenceStatus(original.sections, original.backendReportId, report.report_id, [evidence]).blocked, true)
  assert.throws(() => reportMarkdown(project, original.sections, [evidence], context(original)), /Regenerate/)
  const refreshed = refreshReportSourceReferences(project, original, report, [evidence], checkedAt)
  assert.equal(JSON.stringify(original), before)
  assert.equal(refreshed.sections, original.sections); assert.equal(refreshed.revisions, original.revisions)
  assert.equal(refreshed.backendReportId, 'original-generation-report')
  assert.equal(refreshed.backendDraftId, 'original-draft')
  const status = backendDraftEvidenceStatus(refreshed.sections, refreshed.backendReportId, report.report_id, [evidence], refreshed.backendEvidenceReferenceCheck, report.company.deal_id)
  assert.equal(status.stale, true); assert.equal(status.referencesRefreshed, true); assert.equal(status.blocked, false)
  const text = reportMarkdown(project, refreshed.sections, [evidence], context(refreshed))
  assert.match(text, /Human wording remains/)
  assert.match(text, /Original draft generation basis remains original-generation-report/)
  assert.match(text, /Source references refreshed against evidence report current-evidence-report/)
  assert.match(text, /Report text and human judgment were not reverified or rewritten/)
  assert.match(text, /Original model summary/)
})

test('missing evidence, changed quotes, hashes, locators and company mismatches refuse refresh without changing the draft', () => {
  const original = fixture(); const before = JSON.stringify(original)
  for (const candidates of [[], [{ ...evidence, citationText: 'Changed source wording.' }],
    [{ ...evidence, sources: [{ ...source, sha256: 'b'.repeat(64) }] }],
    [{ ...evidence, sources: [{ ...source, locator: { kind: 'pdf_page', page: 9 } }] }],
    [{ ...evidence, sources: [{ ...source, deal_id: 'different-company' }] }]]) {
    assert.throws(() => refreshReportSourceReferences(project, original, report, candidates, checkedAt))
    assert.equal(JSON.stringify(original), before)
  }
  assert.throws(() => refreshReportSourceReferences(project, original, { ...report, company: { deal_id: 'different-company' } }, [evidence]), /different company/)
  const unbound = fixture(); delete unbound.sections[0].sourceClaims
  assert.throws(() => refreshReportSourceReferences(project, unbound, report, [evidence]), /does not retain the original quote/)
})

test('reference checks remain company and version scoped and cannot silently approve later citation changes', () => {
  const original = fixture(); const refreshed = refreshReportSourceReferences(project, original, report, [evidence], checkedAt)
  const check = refreshed.backendEvidenceReferenceCheck
  assert.equal(checkedReferenceStatus(refreshed.sections, refreshed.backendReportId, report.report_id, [evidence], check, 'different-company').valid, false)
  assert.equal(checkedReferenceStatus(refreshed.sections, refreshed.backendReportId, 'later-report', [evidence], check, 'deal-company').valid, false)
  assert.throws(() => reportMarkdown(project, refreshed.sections, [{ ...evidence, sources: [{ ...source, sha256: 'c'.repeat(64) }] }], context(refreshed)), /Regenerate/)
  const changed = structuredClone(refreshed.sections); changed[0].content += ` [${otherId}]`
  assert.throws(() => reportMarkdown(project, changed, [evidence, { ...evidence, id: otherId }], context(refreshed)), /Regenerate/)
  assert.throws(() => reportMarkdown(project, refreshed.sections, [evidence], { ...context(refreshed), evidenceCheckedAt: undefined }), /Regenerate/)
})

test('deleted references stay deleted; refreshing never restores old claims or re-verifies edited prose', () => {
  const workspace = fixture(); workspace.sections[0].content = 'Human paragraph with its source citation deliberately removed.'
  const refreshed = refreshReportSourceReferences(project, workspace, report, [], checkedAt)
  assert.equal(refreshed.sections[0].content, workspace.sections[0].content)
  assert.deepEqual(refreshed.backendEvidenceReferenceCheck.retainedIds, [])
  const text = reportMarkdown(project, refreshed.sections, [], context(refreshed))
  assert.doesNotMatch(text, /Claim-to-source quotations|Original model summary|14 customers/)
  assert.match(text, /No cited evidence/)
})
