import test from 'node:test'
import assert from 'node:assert/strict'
import { documentChatDeal, parseDocumentReply, documentChatError, documentQuestionKey, pendingDocumentQuestion } from '../src/documentChatState.ts'

const source = { snapshot_id: 'deck', file_name: 'company.pdf', sha256: 'a'.repeat(64), provider: 'uploaded',
  ingestion_channel: 'user_upload', data_role: 'supplemental_evidence', visibility: 'deal_private', preview_url: '/sources/deck/file', locator: { kind: 'pdf_page', page: 4 } }
const report = { company: { deal_id: 'company' }, source_files: [source] }
function reply() { return { status: 'answered', answer: 'The historical document reports payment services. [1]',
  statements: [{ text: 'The historical document reports payment services.', source_ids: ['record-one'] }],
  sources: [{ id: 'record-one', label: 1, kind: 'raw', excerpt: 'We provide payment services.', source }], gaps: [],
  coverage: { registered_sources: 1, indexed_chunks: 4, retrieved_chunks: 1, source_gaps: [], method: 'lexical' } } }

test('document chat requires an explicit backend workspace and keeps historical Enfuce isolated', () => {
  assert.equal(documentChatDeal({ id: 'enfuce' }), null)
  assert.equal(documentChatDeal({ id: 'unregistered-project' }), null)
  assert.equal(documentChatDeal({ id: 'enfuce-documents' }), 'enfuce-2020')
  assert.equal(documentChatDeal({ id: 'new-project', backendDealId: 'registered-company' }), 'registered-company')
})

test('source search preserves quoted excerpts, page locators and registered file hashes', () => {
  const parsed = parseDocumentReply(reply(), 'company', report)
  assert.equal(parsed.sources[0].source.sha256, source.sha256)
  assert.equal(parsed.sources[0].source.locator.page, 4)
  assert.equal(parsed.sources[0].excerpt, 'We provide payment services.')
  const unavailable = parseDocumentReply(reply(), 'company', { ...report, source_files: [{ ...source, preview_available: false }] })
  assert.equal(unavailable.sources[0].source.preview_available, false)
})

test('wrong-company files, changed hashes, active URLs and unbound source labels cannot become displayed answers', () => {
  const cases = [
    value => { value.deal_id = 'another-company' },
    value => { value.sources[0].source.snapshot_id = 'foreign' },
    value => { value.sources[0].source.sha256 = 'b'.repeat(64) },
    value => { value.sources[0].source.file_name = 'different.pdf' },
    value => { value.sources[0].source.preview_url = 'javascript:alert(1)' },
    value => { value.sources[0].source.preview_url = '/sources/foreign/file' },
    value => { value.sources[0].source.preview_url = 'https://user:password@example.test/file' },
    value => { value.sources[0].label = 2 },
    value => { value.statements[0].source_ids = ['invented'] },
    value => { value.answer += '\nAn uncited extra assertion.' },
    value => { value.statements = [] },
    value => { value.coverage.retrieved_chunks = 25 },
    value => { value.coverage.source_gaps = [{ snapshot_id: 'foreign', reason: 'Unknown source' }] },
  ]
  for (const mutate of cases) { const value = structuredClone(reply()); mutate(value); assert.throws(() => parseDocumentReply(value, 'company', report), /invalid company evidence/) }
  assert.throws(() => parseDocumentReply(reply(), 'another-company', report), /invalid company evidence/)
})

test('insufficient evidence remains a bounded missing state and configuration failures preserve the question', () => {
  const value = { status: 'insufficient_evidence', answer: 'No matching evidence is available.', statements: [], sources: [], gaps: ['No matching evidence.'],
    coverage: { registered_sources: 1, indexed_chunks: 0, retrieved_chunks: 0, source_gaps: [{ snapshot_id: 'deck', reason: 'Original unavailable.' }] } }
  assert.equal(parseDocumentReply(value, 'company', report).status, 'insufficient_evidence')
  assert.match(documentChatError(503), /model configuration/)
  assert.match(documentChatError(502, { detail: 'Citation validation failed.' }), /preserved/)
  assert.equal(pendingDocumentQuestion('Where is the revenue source?'), 'Where is the revenue source?')
  assert.equal(pendingDocumentQuestion('x'.repeat(4001)), '')
  assert.equal(pendingDocumentQuestion(' '), '')
  assert.notEqual(documentQuestionKey('company-a'), documentQuestionKey('company-b'))
})
