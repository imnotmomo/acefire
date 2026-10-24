import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { handlers, validateReply } from '../handlers.mjs'

const runId = '12345678-1234-1234-1234-123456789012'
const config = { project: 'test-team', backend: 'http://127.0.0.1:8000', allowedDeals: new Set(['test-deal']), allowUpload: true }
const source = { bank: 'test-team', path: `acefire/chat/${runId}/answer.json`, version: 'abcdef123456' }
const content = Buffer.from('registered original')
const hash = createHash('sha256').update(content).digest('hex')
function reply() {
  return { status: 'answered', answer: 'Source-reported fact. [1]', statements: [{ text: 'Source-reported fact.', source_ids: ['citation'] }], sources: [{ id: 'citation', source: { snapshot_id: 'snapshot', sha256: hash, locator: { page: 1 }, preview_url: '/sources/snapshot/file' } }] }
}
const task = input => ({ id: 'test-task', input: { run_id: runId, deal_id: 'test-deal', ...input } })
function context(packet) {
  const saved = []
  return { saved, progress: async () => {}, read: async () => ({ content: JSON.stringify(packet), source }), save: async (path, content) => { saved.push(JSON.parse(content)); return { ...source, path } } }
}

test('answer uses local evidence API, saves full packet and returns only pinned source', async () => {
  const ctx = context()
  const result = await handlers(config, async (url, opts) => {
    assert.equal(url, 'http://127.0.0.1:8000/deals/test-deal/evidence-chat')
    assert.deepEqual(JSON.parse(opts.body), { question: 'Question?' })
    return Response.json(reply())
  }).answer(task({ question: 'Question?' }), ctx)
  assert.equal(ctx.saved[0].reply.sources.length, 1)
  assert.deepEqual(result.data.answer, source)
  assert.equal(JSON.stringify(result.data).includes('Source-reported'), false)
})

test('upload consent and deal allowlist fail before any network request', async () => {
  for (const options of [{ ...config, allowUpload: false }, { ...config, allowedDeals: new Set() }]) {
    await assert.rejects(handlers(options, () => assert.fail('Network called')).answer(task({ question: 'Q' }), context()))
  }
})

test('rejects unknown statement citations', () => {
  const result = reply(); result.statements[0].source_ids = ['invented']
  assert.throws(() => validateReply(result), /unknown/)
})

test('review reads exact version and verifies original bytes', async () => {
  const ctx = context({ run_id: runId, deal_id: 'test-deal', reply: reply() })
  const result = await handlers(config, async url => url.endsWith('/sources')
    ? Response.json([{ id: 'snapshot', deal_id: 'test-deal', sha256: hash }])
    : new Response(content)).reviewer(task({ answer: source }), ctx)
  assert.equal(result.data.status, 'passed')
  assert.equal(result.data.checks.originals_checked, 1)
  assert.deepEqual(ctx.saved[0].answer, source)
})

test('review rejects changed original, cross-deal source and arbitrary file URL', async () => {
  for (const change of ['hash', 'deal', 'url']) {
    const packet = { run_id: runId, deal_id: 'test-deal', reply: reply() }
    if (change === 'url') packet.reply.sources[0].source.preview_url = 'https://outside.invalid'
    await assert.rejects(handlers(config, async url => url.endsWith('/sources')
      ? Response.json([{ id: 'snapshot', deal_id: change === 'deal' ? 'another-deal' : 'test-deal', sha256: hash }])
      : new Response(change === 'hash' ? 'changed' : content)).reviewer(task({ answer: source }), context(packet)))
  }
})

test('review rejects unpinned or foreign answer before reading', async () => {
  for (const value of [{ ...source, version: null }, { ...source, bank: 'other-team' }, { ...source, path: '../secret' }]) {
    await assert.rejects(handlers(config).reviewer(task({ answer: value }), { read: () => assert.fail('Read called') }))
  }
})

test('insufficient evidence may be returned without fabricating citations', () => {
  validateReply({ status: 'insufficient_evidence', answer: 'Unknown', statements: [], sources: [] })
  const result = reply(); result.status = 'insufficient_evidence'
  assert.throws(() => validateReply(result))
})
