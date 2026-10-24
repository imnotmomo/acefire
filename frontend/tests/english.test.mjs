import test from 'node:test'
import assert from 'node:assert/strict'
import { EVIDENCE } from '../src/data.ts'
import { ENFUCE, emptyWorkspace, defaultConfig, generateSections, reportMarkdown } from '../src/domain.ts'
import { hasChinese, migrateLegacyEnglish, migrateStoredEnglish, needsStoredEnglish } from '../src/english.ts'

const at = '2026-10-24T20:00:00Z'
function storedFixture() {
  const source = { snapshot_id: 'snapshot-1', file_name: 'Deck.pdf', sha256: 'a'.repeat(64), provider: 'uploaded', locator: { kind: 'pdf_page', page: 2 } }
  const citation = { evidence_id: 'evidence-1', kind: 'statement', quote: 'The company has 14 customers.', quote_basis: 'source_text', source }
  const claim = { id: 'claim-1', text: '材料报告有14名客户。', kind: 'reported_summary', citations: [citation], reviewState: 'verify' }
  const section = { id: 'customers', title: 'Customers', config: defaultConfig('customers'), content: `User opening. ${claim.text} [evidence-1]\n\nEvidence gap: 缺少合同。\n\nUser note: 保留这段人工备注。`, evidenceIds: ['evidence-1'], sourceClaims: [claim], gaps: ['缺少合同。'], humanEdited: true }
  const prior = { id: 'prior-revision', at, section: 'customers', title: 'Customers', before: 'Original text.', after: section.content, author: 'You' }
  const workspace = { ...emptyWorkspace(), order: ['customers'], configs: { customers: { ...section.config, focus: 'Keep my focus' } }, sections: [section], revisions: [prior], generatedAt: at, backendReportId: 'report-1', backendDraftId: 'stored-1' }
  const english = [{ ...section, content: '', sourceClaims: [{ ...claim, text: 'The source reports 14 customers.' }], gaps: ['Contracts were not supplied.'] }]
  return { workspace, english }
}

test('built-in evidence display fields and generated report prose are English', () => {
  for (const evidence of EVIDENCE) {
    const { originalExcerpt, originalLocator, ...display } = evidence
    assert.equal(hasChinese(JSON.stringify(display)), false, evidence.id)
  }
  const definition = EVIDENCE.find(item => item.id === 'definition')
  assert.match(definition.originalLocator, /近五年财务情况/)
  assert.match(definition.originalExcerpt, /营业收入/)
  assert.match(EVIDENCE.find(item => item.id === 'company').originalExcerpt, /成立于2016年/)
  assert.match(EVIDENCE.find(item => item.id === 'customers').originalExcerpt, /客户16家/)
  const sections = generateSections(ENFUCE, emptyWorkspace())
  assert.equal(hasChinese(sections.map(section => section.content).join('\n')), false)
  const markdown = reportMarkdown(ENFUCE, sections)
  assert.equal(hasChinese(markdown), false)
  assert.match(markdown, /3,452,682.81/)
  assert.match(markdown, /Five-year financial summary/)
})

test('legacy migration keeps human text, settings, timestamps and prior history', () => {
  const workspace = emptyWorkspace()
  const section = { id: 'financials', title: 'Financials', config: defaultConfig('financials'), evidenceIds: ['definition'], content: 'My introduction. The summary’s “营业收入” figure requires review. [definition]\nMy manual closing note.' }
  workspace.sections = [section]; workspace.generatedAt = at
  workspace.revisions = [{ id: 'old', at, section: 'financials', title: 'Financials', before: 'Earlier.', after: section.content, author: 'You' }]
  const original = structuredClone(workspace)
  const migrated = migrateLegacyEnglish(workspace, at)
  assert.deepEqual(workspace, original)
  assert.match(migrated.sections[0].content, /My introduction.*“operating revenue”/)
  assert.match(migrated.sections[0].content, /My manual closing note/)
  assert.deepEqual(migrated.sections[0].evidenceIds, section.evidenceIds)
  assert.equal(migrated.configs, workspace.configs)
  assert.equal(migrated.generatedAt, at)
  assert.deepEqual(migrated.revisions[0], workspace.revisions[0])
  assert.equal(migrated.revisions[1].author, 'English presentation translation')
  assert.equal(migrateLegacyEnglish(migrated, at), migrated)
})

test('stored migration replaces only exact passages and preserves unknown human edits', () => {
  const { workspace, english } = storedFixture()
  const before = structuredClone(workspace)
  assert.equal(needsStoredEnglish(workspace, ['stored-1']), true)
  const migrated = migrateStoredEnglish(workspace, english, 'stored-1', at)
  assert.deepEqual(workspace, before)
  assert.match(migrated.sections[0].content, /User opening. The source reports 14 customers\. \[evidence-1\]/)
  assert.match(migrated.sections[0].content, /Evidence gap: Contracts were not supplied/)
  assert.match(migrated.sections[0].content, /User note: 保留这段人工备注。/)
  assert.equal(migrated.sections[0].humanEdited, true)
  assert.deepEqual(migrated.sections[0].sourceClaims[0].citations, workspace.sections[0].sourceClaims[0].citations)
  assert.deepEqual(migrated.configs, workspace.configs)
  assert.deepEqual(migrated.revisions[0], workspace.revisions[0])
  assert.equal(migrated.revisions.length, 2)
  assert.equal(migrated.generatedAt, workspace.generatedAt)
  assert.equal(needsStoredEnglish(migrated, ['stored-1']), false)
  assert.equal(migrateStoredEnglish(migrated, english, 'stored-1', at), migrated)
})

test('human-replaced or removed passages are not restored from the saved report', () => {
  const { workspace, english } = storedFixture()
  workspace.sections[0].content = 'My replacement wording. [evidence-1]'
  const migrated = migrateStoredEnglish(workspace, english, 'stored-1', at)
  assert.equal(migrated.sections[0].content, 'My replacement wording. [evidence-1]')
  assert.equal(migrated.sections[0].sourceClaims[0].text, 'The source reports 14 customers.')
})

test('the operating revenue label also migrates when saved without quotation marks', () => {
  const workspace = emptyWorkspace()
  workspace.sections = [{ id: 'financials', title: 'Financials', config: defaultConfig('financials'),
    evidenceIds: ['definition'], content: 'Check 营业收入 against the income definition. [definition]' }]
  const migrated = migrateLegacyEnglish(workspace, at)
  assert.equal(hasChinese(migrated.sections[0].content), false)
  assert.match(migrated.sections[0].content, /operating revenue/)
  assert.deepEqual(migrated.sections[0].evidenceIds, ['definition'])
})

test('foreign drafts, changed numbers and quotations cannot overwrite saved text', () => {
  const { workspace, english } = storedFixture()
  assert.equal(needsStoredEnglish(workspace, ['other-report']), false)
  assert.equal(migrateStoredEnglish(workspace, english, 'different-draft', at), workspace)
  const candidates = [
    [],
    [{ ...english[0], sourceClaims: [{ ...english[0].sourceClaims[0], id: 'different-claim' }] }],
    [{ ...english[0], sourceClaims: [{ ...english[0].sourceClaims[0], text: 'The source reports 16 customers.' }] }],
    [{ ...english[0], sourceClaims: [{ ...english[0].sourceClaims[0], citations: [{ ...english[0].sourceClaims[0].citations[0], quote: 'Different quotation.' }] }] }],
    [{ ...english[0], gaps: [] }],
  ]
  const before = structuredClone(workspace)
  for (const candidate of candidates) assert.throws(() => migrateStoredEnglish(workspace, candidate, 'stored-1', at), /English presentation/)
  assert.deepEqual(workspace, before)
})

test('server-validated English presentation accepts translated Chinese number words with bound originals', () => {
  const { workspace, english } = storedFixture()
  workspace.sections[0].sourceClaims[0].text = '公司有五位创始人。'
  workspace.sections[0].content = '公司有五位创始人。 [evidence-1]'
  english[0].sourceClaims[0].text = 'The company has 5 founders.'
  const metadata = { language: 'en', original_records_preserved: true, source_record_sha256: 'a'.repeat(64), manifest_sha256: 'b'.repeat(64) }
  assert.throws(() => migrateStoredEnglish(workspace, english, 'stored-1', at), /numbers/)
  const migrated = migrateStoredEnglish(workspace, english, 'stored-1', at, metadata)
  assert.equal(migrated.sections[0].content, 'The company has 5 founders. [evidence-1]')
  assert.deepEqual(migrated.sections[0].sourceClaims[0].citations, workspace.sections[0].sourceClaims[0].citations)
  assert.throws(() => migrateStoredEnglish(workspace, english, 'stored-1', at, { ...metadata, source_record_sha256: 'invalid' }), /source-version binding/)
})
