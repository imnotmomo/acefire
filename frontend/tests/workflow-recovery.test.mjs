import test from 'node:test'
import assert from 'node:assert/strict'
import { calculationTextEvidence } from '../src/calculationEvidence.ts'
import { parseCalculationParameters } from '../src/calculationParameters.ts'
import { chatScope, chatRequestError, checkedReply, encodeRecovery, recoverChat, chatWorkingDraft, storedMessages } from '../src/companyChatState.ts'

const source = { snapshot_id: 'deck-source', file_name: 'company.pdf', sha256: '1'.repeat(64), provider: 'uploaded',
  ingestion_channel: 'user_upload', data_role: 'supplemental_evidence', visibility: 'deal_private', preview_url: '/sources/deck-source/file', locator: { kind: 'pdf_page', page: 4, line_start: 2, line_end: 3 } }
const statement = { id: 'claim:deck-claim:evidence:0', deal_id: 'company', kind: 'statement', title: 'Source-bound company description',
  text: 'Source amount: 9007199254740993.1250. The company provides payment services.', source, quote_basis: 'source_text' }
const catalog = new Map([[statement.id, { id: statement.id, title: statement.title, excerpt: statement.text, citationText: statement.text }]])

test('document quotations are available to calculations without Akta fields, preserving their exact bindings', () => {
  const report = { company: { deal_id: 'company' }, source_files: [source], primary_profile: { field_lineage: { fields: [] } }, narrative_evidence: [statement] }
  const inputs = calculationTextEvidence(report)
  assert.equal(inputs.length, 1)
  assert.equal(inputs[0].id, statement.id)
  assert.equal(inputs[0].text, statement.text)
  assert.equal(inputs[0].source, source)
  assert.equal(inputs[0].source.locator.line_start, 2)
})

test('calculation context excludes structured metrics and sources outside the registered company', () => {
  const report = { company: { deal_id: 'company' }, source_files: [source], narrative_evidence: [statement, statement,
    { ...statement, id: 'foreign', deal_id: 'another-company' },
    { ...statement, id: 'numeric', kind: 'observation' },
    { ...statement, id: 'wrong-version', source: { ...source, sha256: '2'.repeat(64) } },
    { ...statement, id: 'unregistered', source: { ...source, snapshot_id: 'another-file' } }] }
  assert.deepEqual(calculationTextEvidence(report).map(item => item.id), [statement.id])
})

test('numeric calculation assumptions cannot round before reaching the backend', () => {
  for (const text of ['{"amount":9007199254740993}', '{"amount":1.0000000000000000001}', '{"amount":1e3}', '{"rate":0.01}']) {
    assert.throws(() => parseCalculationParameters(text), /quoted decimal strings/)
  }
  const input = '{"amount":"9007199254740993.1250","rate":"1.0000000000000000001","years":5,"period_end":"2024-12-31","note":"escaped \\"quote\\" with 1.23"}'
  assert.equal(parseCalculationParameters(input).amount, '9007199254740993.1250')
  assert.equal(parseCalculationParameters(input).rate, '1.0000000000000000001')
  assert.equal(parseCalculationParameters(input).years, 5)
  assert.throws(() => parseCalculationParameters('[]'), /JSON object/)
  assert.throws(() => parseCalculationParameters('{broken'), /valid JSON/)
  assert.throws(() => parseCalculationParameters(JSON.stringify({ note: 'x'.repeat(12_000) })), /12 KB/)
  let nested = 'value'; for (let i=0;i<14;i++) nested={ nested }
  assert.throws(() => parseCalculationParameters(JSON.stringify(nested)), /nested too deeply/)
})

test('real HTTP409 produces refresh recovery; provider errors remain actionable without a login workflow', () => {
  assert.equal(chatRequestError(409, { detail: { code: 'stale_report' } }).stale, true)
  assert.match(chatRequestError(409).message, /Refresh/)
  assert.match(chatRequestError(503, { detail: { message: 'Model API configuration is missing.' } }).message, /Model API configuration/)
  assert.doesNotMatch(chatRequestError(403).message, /[Ss]ign in/)
})

test('stale and interrupted chat questions survive refresh, revalidate citations and bind retry to the new report', () => {
  const oldScope = chatScope('company', 'old-report')
  const history = [{ role: 'assistant', content: 'Earlier supported response.' }]
  const question = { scope: oldScope, question: 'What does this company do?', history }
  const messages = [{ id: 'answer', role: 'assistant', content: 'Payment services.', state: 'verify', citations: [{ evidence_id: statement.id, quote: 'payment services', metadata: { source: { preview_url: 'https://signed.example/private?token=secret' } } }] },
    { id: 'question', role: 'user', content: question.question }]
  const saved = encodeRecovery('company', 'old-report', question, messages, 'stale')
  assert.doesNotMatch(saved, /signed\.example|preview_url|metadata|token=secret/)
  const stale = recoverChat(saved, 'company', 'old-report', catalog)
  assert.equal(stale.failure.stale, true)
  const refreshed = recoverChat(saved, 'company', 'fresh-report', catalog)
  assert.equal(refreshed.failure.stale, false)
  assert.equal(refreshed.question.scope, chatScope('company', 'fresh-report'))
  assert.equal(refreshed.question.question, question.question)
  assert.deepEqual(refreshed.question.history, history)
  assert.equal(refreshed.conversation.messages.length, 2)
  const withoutSource = recoverChat(saved, 'company', 'fresh-report', new Map())
  assert.deepEqual(withoutSource.conversation.messages.map(item => item.role), ['user'])
  const interrupted = recoverChat(encodeRecovery('company', 'old-report', question, messages, 'pending'), 'company', 'old-report', catalog)
  assert.match(interrupted.failure.message, /interrupted/)
})

test('foreign or invalid recovery data and replies cannot cross company/report boundaries', () => {
  const saved = encodeRecovery('company', 'old-report', { scope: chatScope('company', 'old-report'), question: 'Question', history: [] }, [], 'retry')
  assert.equal(recoverChat(saved, 'another-company', 'old-report', catalog), null)
  assert.equal(recoverChat('{malformed', 'company', 'old-report', catalog), null)
  assert.equal(recoverChat('x'.repeat(1_500_001), 'company', 'old-report', catalog), null)
  const oldReply = { deal_id: 'company', report_id: 'old-report', answer: 'Payment services.', state: 'verify', citations: [{ evidence_id: statement.id, quote: 'payment services' }] }
  assert.throws(() => checkedReply(oldReply, { company: { deal_id: 'company' }, report_id: 'fresh-report' }, catalog), error => error.stale === true)
  const fresh = checkedReply({ ...oldReply, report_id: 'fresh-report' }, { company: { deal_id: 'company' }, report_id: 'fresh-report' }, catalog)
  assert.equal(fresh.citations[0].quote, 'payment services')
  assert.deepEqual(Object.keys(storedMessages([fresh])[0].citations[0]).sort(), ['evidence_id', 'quote'])
})

test('large human drafts do not repeatedly break company chat or mutate the report', () => {
  const section = { id: 'overview', title: 'Company overview', content: 'Human revision.', evidenceIds: [], config: {}, humanEdited: true }
  const ordinary = chatWorkingDraft([section])
  assert.equal(ordinary.omitted, false)
  assert.equal(ordinary.data.sections[0].content, section.content)
  const large = { ...section, content: '人'.repeat(90_000) }
  const before = structuredClone(large)
  const result = chatWorkingDraft([large])
  assert.equal(result.omitted, true)
  assert.equal(result.data.omitted, true)
  assert.equal(result.data.sections.length, 0)
  assert.ok(new TextEncoder().encode(JSON.stringify(result.data)).length < 250_000)
  assert.deepEqual(large, before)
})
