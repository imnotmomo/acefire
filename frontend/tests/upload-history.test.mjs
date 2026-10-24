import test from 'node:test'
import assert from 'node:assert/strict'
import { listUploadJobs, MAX_SHARED_UPLOAD_HISTORY } from '../src/workspaceApi.ts'
import { mergeUploadReceipts } from '../src/uploadHistory.ts'
import { setApiAccessTokenProvider } from '../src/backend.ts'

const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const receipt = (id, status = 'processing', created_at = '2026-10-24T12:00:00Z') => ({ id, deal_id: 'company', snapshot_id: `source-${id}`, filename: `${id}.pdf`, sha256: 'a'.repeat(64), created_at, status, warnings: [], observations: 0, claims: 0 })
const local = (clientId, serverId, status = 'queued') => ({ clientId, serverId, dealId: 'company', name: 'original.pdf', size: 321, type: 'application/pdf', provider: 'pitchbook', added: '2026-10-24T12:00:00Z', status, warnings: [], legacyId: 'preserved-browser-document' })

test('shared processing history is fetched through the company-scoped authenticated API and preserves public original receipts', async () => {
  const original = globalThis.fetch; let request
  setApiAccessTokenProvider(async () => 'test-api-token')
  globalThis.fetch = async (url, init) => { request = { url, init }; return json({ uploads: [receipt('job-one')] }) }
  try {
    const rows = await listUploadJobs('company')
    assert.equal(request.url, '/api/deals/company/uploads')
    assert.equal(request.init.cache, 'no-store')
    assert.equal(new Headers(request.init.headers).get('Authorization'), 'Bearer test-api-token')
    assert.equal(rows[0].filename, 'job-one.pdf'); assert.equal(rows[0].sha256, 'a'.repeat(64))
    assert.equal(rows[0].created_at, '2026-10-24T12:00:00Z')
  } finally { globalThis.fetch = original; setApiAccessTokenProvider(null) }
})

test('malformed or foreign shared jobs fail without becoming successful evidence', async () => {
  const original = globalThis.fetch
  try {
    for (const mutate of [
      job => { job.deal_id = 'foreign' }, job => { delete job.deal_id }, job => { delete job.snapshot_id },
      job => { job.sha256 = 'changed' }, job => { job.filename = '' }, job => { job.created_at = 'not a timestamp' },
      job => { job.status = 'invented_success' }, job => { job.claims = -1 }, job => { job.warnings = [null] },
    ]) {
      const job = receipt('one'); mutate(job)
      globalThis.fetch = async () => json({ uploads: [job] })
      await assert.rejects(listUploadJobs('company'))
    }
    globalThis.fetch = async () => json({ uploads: [receipt('one'), receipt('one')] })
    await assert.rejects(listUploadJobs('company'), /duplicate/)
    globalThis.fetch = async () => json({ uploads: Array(10_001).fill(receipt('one')) })
    await assert.rejects(listUploadJobs('company'), /unsupported shared processing history/)
  } finally { globalThis.fetch = original }
})

test('shared history is bounded while retaining active jobs ahead of older completed receipts', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => json({ uploads: [receipt('active', 'processing', '2020-01-01T00:00:00Z'), ...Array.from({ length: 120 }, (_, i) => receipt(`done-${i}`, 'completed', new Date(Date.UTC(2026, 0, i + 1)).toISOString()))] })
  try {
    const rows = await listUploadJobs('company')
    assert.equal(rows.length, MAX_SHARED_UPLOAD_HISTORY)
    assert.equal(rows[0].id, 'active'); assert.equal(rows[1].id, 'done-119')
  } finally { globalThis.fetch = original }
})

test('shared job merges preserve local client/cache identities and expose server-only jobs without invented file bytes', () => {
  const original = local('browser-cache-id', 'one')
  const merged = mergeUploadReceipts([original], [{ ...receipt('one', 'completed'), claims: 4 }, receipt('teammate-failed', 'failed')], 'company')
  assert.equal(merged[0].clientId, original.clientId); assert.equal(merged[0].legacyId, original.legacyId)
  assert.equal(merged[0].size, 321); assert.equal(merged[0].provider, 'pitchbook'); assert.equal(merged[0].status, 'completed')
  assert.equal(merged[0].claims, 4)
  assert.equal(merged[1].remoteOnly, true); assert.equal(merged[1].size, null)
  assert.equal(merged[1].name, 'teammate-failed.pdf'); assert.equal(merged[1].status, 'failed')
})

test('stale list responses cannot regress progress or clobber uploads started while the request was pending', () => {
  const before = local('existing', 'one')
  const finished = { ...before, status: 'completed', claims: 5 }
  const startedDuringFetch = local('new-browser-cache', 'two', 'processing')
  const result = mergeUploadReceipts([finished, startedDuringFetch], [receipt('one', 'queued'), receipt('two', 'failed')], 'company', [before])
  assert.equal(result[0], finished); assert.equal(result[1], startedDuringFetch)
  assert.deepEqual(result.map(job => job.status), ['completed', 'processing'])
})

test('a delayed upload receipt replaces only its duplicate remote placeholder and never another company history', () => {
  const browser = local('browser-cache-id', 'one', 'processing')
  const remote = mergeUploadReceipts([], [receipt('one')], 'company')[0]
  const foreign = { ...local('foreign-cache', 'foreign'), dealId: 'another-company' }
  const merged = mergeUploadReceipts([remote, browser, foreign], [], 'company')
  assert.deepEqual(merged, [browser])
  assert.deepEqual(mergeUploadReceipts([], [{ ...receipt('foreign'), deal_id: 'another-company' }], 'company'), [])
})
