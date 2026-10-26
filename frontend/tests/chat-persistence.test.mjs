import test from 'node:test'
import assert from 'node:assert/strict'
import { chatDraftKey, readChatDraft, saveChatDraft, documentConversationKey, encodeDocumentConversation, readDocumentConversation } from '../src/chatPersistence.ts'

const source = { snapshot_id: 'deck', file_name: 'company.pdf', sha256: 'a'.repeat(64), provider: 'uploaded', ingestion_channel: 'user_upload', data_role: 'supplemental_evidence', visibility: 'deal_private', preview_url: 'https://storage.example.test/original?token=private', locator: { kind: 'pdf_page', page: 4 } }
const report = { company: { deal_id: 'company' }, source_files: [source] }
const reply = { status: 'answered', answer: 'The source reports payment services. [1]', statements: [{ text: 'The source reports payment services.', source_ids: ['record'] }],
  sources: [{ id: 'record', label: 1, kind: 'raw', excerpt: 'We provide payment services.', source }], gaps: [], coverage: { registered_sources: 1, indexed_chunks: 1, retrieved_chunks: 1, source_gaps: [] } }
const messages = [{ id: 'user', role: 'user', text: 'What does it do?' }, { id: 'assistant', role: 'assistant', text: reply.answer, reply }]

test('unsent questions are company- and mode-scoped and cleared only on send', () => {
  const previous = globalThis.sessionStorage, values = new Map()
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  try {
    saveChatDraft('company', 'sources', 'Unsent source question'); saveChatDraft('company', 'company', 'Unsent company question')
    assert.equal(readChatDraft('company', 'sources'), 'Unsent source question'); assert.equal(readChatDraft('company', 'company'), 'Unsent company question')
    assert.equal(readChatDraft('another-company', 'sources'), '')
    assert.notEqual(chatDraftKey('company', 'company'), chatDraftKey('company', 'sources'))
    saveChatDraft('company', 'sources', ''); assert.equal(readChatDraft('company', 'sources'), '')
  } finally { globalThis.sessionStorage = previous }
})

test('source conversations restore original excerpts and locators while refreshing file grants', () => {
  const stored = encodeDocumentConversation('company', messages)
  assert.equal(stored.includes('preview_url'), false); assert.equal(stored.includes('token=private'), false)
  const current = { ...report, source_files: [{ ...source, preview_url: '/sources/deck/file' }] }
  const restored = readDocumentConversation(stored, 'company', current)
  assert.equal(restored.length, 2); assert.equal(restored[1].reply.sources[0].source.preview_url, '/sources/deck/file')
  assert.equal(restored[1].reply.sources[0].source.locator.page, 4); assert.equal(restored[1].reply.sources[0].excerpt, 'We provide payment services.')
})

test('changed or foreign sources cannot revive old assistant answers, while user questions remain recoverable', () => {
  const stored = encodeDocumentConversation('company', messages)
  assert.deepEqual(readDocumentConversation(stored, 'another-company', report), [])
  assert.equal(readDocumentConversation(stored, 'company', { ...report, source_files: [{ ...source, sha256: 'b'.repeat(64) }] }).length, 1)
  assert.equal(readDocumentConversation(stored, 'company').length, 1)
  assert.deepEqual(readDocumentConversation('invalid', 'company', report), [])
  const tampered = JSON.parse(stored); tampered.messages[1].reply.answer += ' Unsupported extra claim.'
  assert.equal(readDocumentConversation(JSON.stringify(tampered), 'company', report).length, 1)
  assert.notEqual(documentConversationKey('company'), documentConversationKey('another-company'))
})
