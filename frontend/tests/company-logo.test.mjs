import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { normalizeCompanyWebsite, parseCompanyLogo, companyLogoBlob, cachedCompanyLogo, setCompanyLogoWebsite } from '../src/companyLogoApi.ts'
import { companyProject, mergeCompanyProjects } from '../src/workspaceProjects.ts'
import { createCompany } from '../src/workspaceApi.ts'
import { setApiAccessTokenProvider } from '../src/backend.ts'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const sha256 = createHash('sha256').update(png).digest('hex')
const ready = { status: 'ready', domain: 'company.example.com', sha256, asset_path: `/deals/deal-icon/logo/image/${sha256}` }
const pending = { status: 'awaiting_website', domain: null, sha256: null, asset_path: null }
const company = { deal_id: 'deal-icon', entity_key: 'icon-company', legal_name: 'Fixture Company', domain: '', country: 'US', identifiers: {} }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
test('logo identity accepts explicit public hosts, strips URL paths and never guesses company names', () => {
  assert.equal(normalizeCompanyWebsite('https://Company.Example.com/about?q=private#fragment'), 'company.example.com')
  assert.equal(normalizeCompanyWebsite('company.example.com'), 'company.example.com')
  for (const value of ['Circle','Acme corporation','localhost','https://127.0.0.1','https://[::1]','https://0x7f000001','169.254.169.254','metadata.google.internal','http://user:password@company.com','company.com:8443','javascript:alert(1)','file:///etc/passwd','company.invalid','company.local','company.test','company.corp','company.onion','linkedin.com/company/name','news.facebook.com','www.youtube.com']) assert.throws(() => normalizeCompanyWebsite(value), /public company website/)
  for (const value of ['company.example','company.home.arpa','1.0.0.127.in-addr.arpa','company.ip6.arpa']) assert.throws(() => normalizeCompanyWebsite(value), /public company website/)
})
test('logo metadata is company-bound and rejects external hotlinks, token URLs and invalid cache states', () => {
  assert.deepEqual(parseCompanyLogo(ready, 'deal-icon'), ready)
  assert.deepEqual(parseCompanyLogo(pending, 'deal-icon'), pending)
  assert.equal(parseCompanyLogo(undefined, 'deal-icon'), undefined)
  for (const patch of [{ asset_path:'https://company.example.com/logo.png' },{ asset_path:ready.asset_path+'?token=secret' },{ sha256:'fake' },{ domain:'localhost' },{ status:'invented-success' }]) assert.throws(() => parseCompanyLogo({ ...ready,...patch }, 'deal-icon'))
  assert.throws(() => parseCompanyLogo(ready, 'another-company'), /belong/)
  assert.throws(() => parseCompanyLogo({ ...ready,status:'unavailable' }, 'deal-icon'), /inconsistent/)
})
test('company adapters preserve legacy covers, propagate saved icons and isolate invalid optional metadata', () => {
  assert.equal(companyProject(company).companyLogo, undefined)
  assert.deepEqual(companyProject({ ...company,company_logo:ready }).companyLogo, ready)
  assert.equal(companyProject({ ...company,company_logo:{ ...ready,asset_path:'https://untrusted.example/logo' } }).companyLogo, undefined)
  assert.deepEqual(mergeCompanyProjects([{ ...companyProject(company),companyLogo:pending }], [{ ...company,company_logo:ready }])[0].companyLogo, ready)
})
test('card image loading uses authenticated scoped cache bytes and verifies the actual PNG hash', async () => {
  const original = globalThis.fetch, calls = []
  setApiAccessTokenProvider(async () => 'fixture-icon-token')
  globalThis.fetch = async (url,init) => { calls.push({ url,init }); return new Response(png,{ headers:{ 'Content-Type':'image/png' } }) }
  try {
    assert.deepEqual(Buffer.from(await (await companyLogoBlob(ready,'deal-icon')).arrayBuffer()), png)
    assert.equal(calls[0].url, '/api'+ready.asset_path)
    assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer fixture-icon-token')
    assert.equal(calls[0].init.cache, 'force-cache'); assert.equal(calls[0].init.redirect, 'error')
    await assert.rejects(companyLogoBlob({ ...ready,sha256:'b'.repeat(64),asset_path:'/deals/deal-icon/logo/image/'+'b'.repeat(64) },'deal-icon'), /integrity/)
    globalThis.fetch = async () => new Response('<svg onload=alert(1)>',{ headers:{ 'Content-Type':'image/svg+xml' } })
    await assert.rejects(companyLogoBlob(ready,'deal-icon'), /could not be loaded/)
  } finally { globalThis.fetch = original; setApiAccessTokenProvider(null) }
})
test('cached status reads never use a provider URL and website submission sends only its normalized public domain', async () => {
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (url,init) => { calls.push({ url,init }); return json({ logo:pending }) }
  try {
    await cachedCompanyLogo('deal-icon')
    await setCompanyLogoWebsite('deal-icon','https://company.example.com/private-path?private-token=not-sent')
    assert.equal(calls[0].url,'/api/deals/deal-icon/logo'); assert.equal(calls[0].init.method,undefined)
    assert.equal(calls[1].url,'/api/deals/deal-icon/logo/website'); assert.deepEqual(JSON.parse(calls[1].init.body),{ website:'company.example.com' })
    await assert.rejects(setCompanyLogoWebsite('deal-icon','127.0.0.1'), /public company website/)
    assert.equal(calls.length,2)
  } finally { globalThis.fetch = original }
})
test('new-company creation normalizes website identity and cannot recover a different public domain', async () => {
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (url,init) => { calls.push({ url,init }); return json({ company:{ ...company,domain:'company.example.com' } },201) }
  try {
    await createCompany({ name:company.legal_name,deal_id:company.deal_id,website:'https://Company.Example.com/path' })
    assert.equal(JSON.parse(calls[0].init.body).website,'company.example.com')
    globalThis.fetch = async (_url,init) => init.method === 'POST' ? json({ detail:'Workspace exists.' },409) : json({ companies:[{ ...company,domain:'other.example.com' }] })
    await assert.rejects(createCompany({ name:company.legal_name,deal_id:company.deal_id,website:'company.example.com' }), /Workspace exists/)
  } finally { globalThis.fetch = original }
})
