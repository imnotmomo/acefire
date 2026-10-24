import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompany, fetchUploadJob, listCompanies, MAX_UPLOAD_BYTES, parseUploadJob, uploadCompanyFile, validateUploadFile, WorkspaceApiError } from '../src/workspaceApi.ts'
import { setApiAccessTokenProvider } from '../src/backend.ts'

const company = { deal_id: 'deal-a', entity_key: 'entity-a', legal_name: 'Acme', domain: '', country: 'US', identifiers: { workspace_sector: 'Other' } }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

test('company list/create requests share the API client and preserve returned identifiers', async () => {
  const original = globalThis.fetch; const calls = []
  setApiAccessTokenProvider(async () => 'api-token')
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return json(init.method === 'POST' ? { company } : { companies: [company] }, init.method === 'POST' ? 201 : 200) }
  try {
    assert.deepEqual(await listCompanies(), [company])
    assert.deepEqual(await createCompany({ name: ' Acme ', sector: 'Other' }), company)
    assert.equal(calls[0].url, '/api/deals')
    assert.equal(calls[1].init.method, 'POST')
    assert.equal(JSON.parse(calls[1].init.body).name, 'Acme')
    assert.equal(new Headers(calls[1].init.headers).get('Authorization'), 'Bearer api-token')
    await assert.rejects(createCompany({ name: 'Acme', deal_id: 'other-company' }), /different identifier/)
  } finally { globalThis.fetch = original; setApiAccessTokenProvider(null) }
})

test('upload file validation rejects empty, oversized and active unsupported formats before requesting the API', async () => {
  assert.throws(() => validateUploadFile({ name: 'empty.pdf', size: 0 }), /empty/)
  assert.throws(() => validateUploadFile({ name: 'large.pdf', size: MAX_UPLOAD_BYTES + 1 }), /50 MiB/)
  for (const name of ['page.html', 'vector.svg', 'program.js', 'unknown.bin']) assert.throws(() => validateUploadFile({ name, size: 10 }), /Choose/)
  for (const name of ['deck.PDF', 'contract.docx', 'deck.ppt', 'image.png', 'data.csv', 'data.xlsx', 'data.xlsm', 'source.txt', 'source.json']) assert.doesNotThrow(() => validateUploadFile({ name, size: 10 }))
  const original = globalThis.fetch
  globalThis.fetch = async () => assert.fail('An oversized file must not be sent')
  try { await assert.rejects(uploadCompanyFile('deal-a', { name: 'large.pdf', size: MAX_UPLOAD_BYTES + 1 }), /50 MiB/) }
  finally { globalThis.fetch = original }
})

test('a retried stable company ID recovers an interrupted creation only when human-supplied company metadata matches', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => init.method === 'POST' ? json({ detail: 'Workspace exists.' }, 409) : json({ companies: [company] })
  try {
    assert.deepEqual(await createCompany({ name: 'Acme', sector: 'Other', geography: 'US', deal_id: 'deal-a' }), company)
    await assert.rejects(createCompany({ name: 'Different company', deal_id: 'deal-a' }), /Workspace exists/)
  } finally { globalThis.fetch = original }
})

test('multipart uploads retain original bytes and job polling stays company scoped', async () => {
  const original = globalThis.fetch; const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return json({ id: 'job-one', deal_id: 'deal-a', status: init.method === 'POST' ? 'queued' : 'completed', snapshot_id: 'source-one', warnings: ['Source reported'], claims: 3, observations: 2 }, init.method === 'POST' ? 202 : 200)
  }
  try {
    const file = new File(['original source'], 'deck.pdf', { type: 'application/pdf' })
    const receipt = await uploadCompanyFile('deal-a', file, 'pitchbook')
    assert.equal(receipt.status, 'queued')
    assert.equal(calls[0].url, '/api/deals/deal-a/uploads')
    assert.equal(calls[0].init.body.get('provider'), 'pitchbook')
    assert.equal(await calls[0].init.body.get('file').text(), 'original source')
    assert.equal(new Headers(calls[0].init.headers).get('Content-Type'), null)
    const complete = await fetchUploadJob('deal-a', receipt.id)
    assert.equal(complete.snapshot_id, 'source-one'); assert.equal(complete.claims, 3)
    assert.equal(calls[1].url, '/api/deals/deal-a/uploads/job-one')
    assert.equal(calls[1].init.cache, 'no-store')
    assert.throws(() => parseUploadJob({ id: 'job-one', deal_id: 'other', status: 'completed' }, 'deal-a'), /different company/)
    assert.throws(() => parseUploadJob({ id: 'other-job', status: 'completed' }, 'deal-a', 'job-one'), /different company or upload/)
    assert.throws(() => parseUploadJob({ id: 'job-one', status: 'invented_success' }, 'deal-a'), /unsupported/)
  } finally { globalThis.fetch = original }
})

test('processing and proxy failures remain actionable errors rather than successful evidence', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => json({ detail: 'Upload job not found.' }, 404)
    await assert.rejects(fetchUploadJob('deal-a', 'missing'), error => error instanceof WorkspaceApiError && error.status === 404)
    globalThis.fetch = async () => new Response('too large', { status: 413 })
    await assert.rejects(uploadCompanyFile('deal-a', new File(['source'], 'file.txt')), /rejected.*size/)
    globalThis.fetch = async () => json({ companies: [company, company] })
    await assert.rejects(listCompanies(), /duplicate/)
  } finally { globalThis.fetch = original }
})
