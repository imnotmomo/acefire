import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { reportEvidence } from '../src/backend.ts'

// Fully intercepted API fixtures: exercises actual Report UI without provider calls or server writes.
const port = process.env.REPORT_WORKFLOW_PORT || '5298'
const base = process.env.FRONTEND_BASE_URL || `http://127.0.0.1:${port}`
let vite = null
if (!process.env.FRONTEND_BASE_URL) {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port], { stdio: 'pipe' })
  let logs = ''; vite.stdout.on('data', bytes => { logs += bytes }); vite.stderr.on('data', bytes => { logs += bytes })
  try {
    const deadline = Date.now() + 20_000
    while (true) {
      if (vite.exitCode !== null) throw new Error(`Report fixture server exited: ${logs}`)
      if (await fetch(`${base}/tests/report-workflow.html`).then(response => response.ok, () => false)) break
      if (Date.now() > deadline) throw new Error(`Report fixture server did not start: ${logs}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } catch (error) { vite.kill(); throw error }
}
const output = path.resolve('test-results/report-workflow')
await fs.mkdir(output, { recursive: true })
let executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
if (!executablePath) {
  const candidates = process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : process.platform === 'win32' ? ['C:/Program Files/Google/Chrome/Application/chrome.exe'] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  for (const candidate of candidates) if (await fs.access(candidate).then(() => true, () => false)) { executablePath = candidate; break }
}
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true }).catch(error => { vite?.kill(); throw error })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
const errors = [], writes = [], records = new Map(), results = []
let mode = 'success', release = null, attempt = 0
const stamp = '2026-10-26T12:00:00Z'
function summary(record) { const { draft, workspace, deal_id, ...rest } = record; return rest }
function record(id, workspace = null, draft = null) { return { id, deal_id: 'fixture-company', version: 1, created_at: stamp, updated_at: stamp, based_on_report_id: 'report-v1', model: draft?.model ?? null, section_count: workspace?.sections.length ?? draft?.sections.length ?? 0, workspace, draft } }
await context.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url()), endpoint = url.pathname
  if (request.method() !== 'GET') writes.push({ method: request.method(), endpoint, body: request.postDataJSON() })
  if (endpoint.endsWith('/report/draft')) {
    const submitted = request.postDataJSON(), currentAttempt = ++attempt
    if (mode === 'delay') await new Promise(resolve => { release = resolve })
    if (mode === 'failure') return route.fulfill({ status: 503, json: { detail: { message: 'Fixture provider unavailable.' } } }).catch(() => {})
    const report = await page.evaluate(() => window.reportFixture.report)
    const evidence = reportEvidence(report)[0]
    const draft = { id: `generated-${currentAttempt}`, deal_id: 'fixture-company', based_on_report_id: submitted.based_on_report_id, model: 'fixture-model', generated_at: stamp, status: 'model_generated_unverified', persisted_version: 1, drafting_preferences: submitted.sections,
      sections: submitted.sections.map(section => ({ id: section.id, title: section.title, claims: [{ id: `claim-${currentAttempt}-${section.id}`, text: `Generated summary ${currentAttempt}.`, kind: 'reported_summary', citations: [{ evidence_id: evidence.id, kind: 'statement', quote: evidence.citationText ?? evidence.excerpt, source: evidence.sources[0] }] }], gaps: [] })) }
    records.set(draft.id, record(draft.id, null, draft))
    return route.fulfill({ json: draft }).catch(() => {})
  }
  if (endpoint.endsWith('/report-drafts') && request.method() === 'GET') return route.fulfill({ json: { drafts: [...records.values()].map(summary) } })
  if (endpoint.endsWith('/report-drafts') && request.method() === 'POST') {
    const body = request.postDataJSON(), id = `manual-${records.size + 1}`, saved = record(id, body.workspace)
    records.set(id, saved); return route.fulfill({ json: saved })
  }
  const id = endpoint.split('/report-drafts/')[1]
  if (id && records.has(id)) {
    const saved = records.get(id)
    if (request.method() === 'GET') { if (mode === 'delay-load') await new Promise(resolve => { release = resolve }); return route.fulfill({ json: saved }).catch(() => {}) }
    const body = request.postDataJSON()
    if (mode === 'save-failure') return route.fulfill({ status: 503, json: { detail: { message: 'Shared save temporarily unavailable. Your local copy is preserved.' } } })
    if (mode === 'conflict' || body.expected_version !== saved.version) return route.fulfill({ status: 409, json: { detail: { code: 'draft_version_conflict' } } })
    saved.workspace = body.workspace; saved.version++; return route.fulfill({ json: saved })
  }
  throw new Error(`Unexpected report fixture API: ${request.method()} ${endpoint}`)
})
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
const fixture = () => page.evaluate(() => window.reportFixture.workspace)
async function check(name, callback) { await callback(); results.push(name); console.log(`PASS ${name}`) }
async function open() { await page.goto(`${base}/tests/report-workflow.html`, { waitUntil: 'networkidle' }); await page.getByRole('heading', { name: 'Report', exact: true }).waitFor() }
async function build() { await page.getByRole('button', { name: /^1 Build/ }).click() }
async function edit(text) { await page.getByRole('button', { name: 'Edit Company overview', exact: true }).click(); await page.getByLabel('Section content').fill(text); await page.getByRole('button', { name: 'Save revision', exact: true }).click() }
try {
  await open()
  await check('generation preserves settings edited while its delayed response is pending', async () => {
    mode = 'delay'
    await page.getByRole('button', { name: /^Generate report preview/ }).click()
    await page.getByLabel('Additional focus', { exact: false }).fill('Changed during the request')
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent !== '')
    while (!release) await new Promise(resolve => setTimeout(resolve, 10))
    release(); release = null
    await page.getByRole('alert').filter({ hasText: 'settings changed' }).waitFor()
    const w = await fixture(); assert.equal(w.sections.length, 0); assert.equal(w.configs.overview.focus, 'Changed during the request')
  })
  await check('stopping a request retains draft/settings and permits a new successful request', async () => {
    mode = 'delay'
    await page.getByRole('button', { name: /^Generate report preview/ }).click()
    while (!release) await new Promise(resolve => setTimeout(resolve, 10))
    await page.getByRole('button', { name: 'Stop waiting', exact: true }).click()
    mode = 'success'; release(); release = null
    await page.getByRole('button', { name: /^Generate report preview/ }).click()
    await page.locator('.report-paper').waitFor()
    assert.equal((await fixture()).sharedDraftVersion, 1)
  })
  await check('edits stay local until explicit versioned save; quotations remain traceable', async () => {
    const count = writes.length, original = (await fixture()).sections[0].content
    await edit(original + '\n\nHuman note: exact decimal 9007199254740993.0123456789.')
    assert.equal(writes.length, count)
    mode = 'save-failure'
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Shared save temporarily unavailable' }).waitFor()
    assert.equal((await fixture()).sharedDraftVersion, 1)
    assert.match((await fixture()).sections[0].content, /Human note: exact decimal/)
    mode = 'success'
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.getByLabel('Notification').filter({ hasText: 'version 2' }).waitFor()
    assert.equal(writes.at(-1).body.expected_version, 1)
    await page.locator('#section-overview .report-claim').first().click()
    await page.getByText('Original supporting text (1 claims)', { exact: true }).click()
    assert.match(await page.locator('.report-claim-quotation').innerText(), /Original source company description/)
    await page.getByRole('button', { name: 'Inspect supporting evidence', exact: true }).click()
    assert.match(await page.getByLabel('Inspected evidence').innerText(), /field:fixture-source/)
  })
  await check('version conflict preserves local text; load latest keeps a restorable full local copy', async () => {
    const local = (await fixture()).sections[0].content + '\n\nMy local conflict copy.'
    await edit(local)
    const id = (await fixture()).sharedDraftId
    const remote = records.get(id)
    remote.workspace = structuredClone(remote.workspace); remote.workspace.sections[0].content += '\n\nTeammate shared edit.'; remote.version++
    mode = 'conflict'
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.getByRole('button', { name: 'Load latest shared version', exact: true }).waitFor()
    assert.equal((await fixture()).sections[0].content, local)
    mode = 'success'
    await page.getByRole('button', { name: 'Load latest shared version', exact: true }).click()
    await page.locator('#section-overview').filter({ hasText: 'Teammate shared edit' }).waitFor()
    await page.getByRole('button', { name: 'Restore previous local copy', exact: true }).click()
    assert.equal((await fixture()).sections[0].content, local)
    await page.getByRole('button', { name: 'Save as new report', exact: true }).click()
    await page.getByLabel('Notification').filter({ hasText: 'version 1' }).waitFor()
    assert.match((await fixture()).sharedDraftId, /manual/)
    assert.ok([...records.values()].some(item => item.workspace?.sections[0].content.includes('Teammate shared edit.')))
  })
  await check('a saved current-basis report cannot load invented original quotations over a local copy', async () => {
    const before = await fixture(), saved = records.get(before.sharedDraftId)
    const quotation = saved.workspace.sections[0].sourceClaims[0].citations[0].quote
    saved.workspace.sections[0].sourceClaims[0].citations[0].quote = 'Invented supporting sentence.'
    await page.locator('.shared-report-browser>summary').click()
    await page.locator('.stored-report-row').filter({ hasText: 'current report' }).getByRole('button', { name: 'Load shared report', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'quotation no longer matches' }).waitFor()
    assert.deepEqual(await fixture(), before)
    saved.workspace.sections[0].sourceClaims[0].citations[0].quote = quotation
    await page.locator('.shared-report-browser>summary').click()
  })
  await check('revision history restores real text as another human revision', async () => {
    const before = (await fixture()).sections[0].content
    await edit(before + '\n\nTemporary human text.')
    await page.getByRole('button', { name: /Version history/ }).click()
    await page.getByRole('dialog', { name: 'Revision history' }).getByRole('button', { name: 'Restore earlier text', exact: true }).first().click()
    assert.equal((await fixture()).sections[0].content, before)
    assert.equal((await fixture()).revisions.at(-1).author, 'You · restored revision')
  })
  await check('stale evidence blocks export until explicit source reference refresh, preserving human text', async () => {
    const before = (await fixture()).sections[0].content
    await page.evaluate(() => window.reportFixture.refreshEvidence())
    await page.getByRole('button', { name: /^3 Export/ }).click()
    assert.equal(await page.getByRole('button', { name: 'Download PDF', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Refresh source references', exact: false }).click()
    assert.equal((await fixture()).sections[0].content, before)
    assert.equal((await fixture()).backendEvidenceCheckedReportId, 'report-v2')
    assert.equal(await page.getByRole('button', { name: 'Download PDF', exact: true }).isEnabled(), true)
  })
  await check('PDF font errors stay visible and retry successfully without altering the report', async () => {
    const before = (await fixture()).sections[0].content
    await page.route('**/fonts/IngeniumExportCJK-Regular.ttf', route => route.fulfill({ status: 503, body: 'Temporary fixture font outage' }))
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Unicode PDF font could not be loaded' }).waitFor()
    assert.equal((await fixture()).sections[0].content, before)
    await page.unroute('**/fonts/IngeniumExportCJK-Regular.ttf')
  })
  await check('all three export downloads contain real bytes and preserve Unicode names', async () => {
    await page.getByRole('button', { name: /^3 Export/ }).click()
    for (const format of ['Markdown', 'DOCX', 'PDF']) {
      await page.locator('.format-options').getByRole('button', { name: new RegExp(`^${format}`) }).click()
      const event = page.waitForEvent('download')
      await page.getByRole('button', { name: `Download ${format}`, exact: true }).click()
      const download = await event
      assert.match(download.suggestedFilename(), /^财务公司-diligence-report\./)
      const filename = path.join(output, download.suggestedFilename()); await download.saveAs(filename)
      const bytes = await fs.readFile(filename); assert.ok(bytes.length > 1000)
      if (format === 'Markdown') { assert.ok(bytes.toString().includes('9007199254740993.0123456789')); assert.ok(bytes.toString().includes('a'.repeat(64))) }
      if (format === 'PDF') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
      if (format === 'DOCX') assert.equal(bytes.subarray(0, 2).toString(), 'PK')
    }
  })
  await check('shared reports reload after a fresh page without using the old local workspace', async () => {
    const id = (await fixture()).sharedDraftId
    const text = records.get(id).workspace.sections[0].content
    await open(); assert.equal((await fixture()).sections.length, 0)
    await page.locator('.stored-report-row').filter({ hasText: 'Team report' }).getByRole('button', { name: 'Load shared report', exact: true }).last().click()
    await page.locator('.report-paper').waitFor()
    assert.equal((await fixture()).sections[0].content, text)
  })
  await check('a delayed shared load cannot overwrite settings changed while it is pending', async () => {
    await open(); mode = 'delay-load'
    await page.locator('.stored-report-row').first().getByRole('button', { name: 'Load shared report', exact: true }).click()
    while (!release) await new Promise(resolve => setTimeout(resolve, 10))
    await page.getByLabel('Additional focus', { exact: false }).fill('Keep my settings during the shared load')
    release(); release = null; mode = 'success'
    await page.getByRole('alert').filter({ hasText: 'settings changed' }).waitFor()
    assert.equal((await fixture()).sections.length, 0)
    assert.equal((await fixture()).configs.overview.focus, 'Keep my settings during the shared load')
  })
  await check('automatically persisted generated reports reconstruct their original module settings', async () => {
    await open()
    const saved = [...records.values()].find(item => item.workspace === null)
    const index = [...records.keys()].indexOf(saved.id)
    await page.locator('.stored-report-row').nth(index).getByRole('button', { name: 'Load shared report', exact: true }).click()
    await page.locator('.report-paper').waitFor()
    const loaded = await fixture()
    assert.equal(loaded.sharedDraftId, saved.id)
    assert.deepEqual(loaded.configs.overview.topics, saved.draft.drafting_preferences[0].topics)
    assert.equal(loaded.backendReportId, saved.based_on_report_id)
    assert.equal(loaded.sections[0].sourceClaims[0].citations[0].source.sha256, 'a'.repeat(64))
  })
  await check('shared report controls and provenance remain reachable on a small screen', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#section-overview .report-claim').first().click()
    await page.getByText('Original supporting text (1 claims)', { exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.screenshot({ path: path.join(output, 'report-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1100 })
  })
  await check('empty evidence blocks generation and links to the file upload workflow', async () => {
    await build(); await page.evaluate(() => window.reportFixture.clearEvidence())
    await page.getByRole('button', { name: 'Add source files', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: /^Regenerate preview/ }).isDisabled(), true)
    await page.getByRole('button', { name: 'Add source files', exact: true }).click()
    assert.equal(await page.getByLabel('Fixture route').innerText(), 'data-room')
  })
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, writes: writes.map(({method, endpoint}) => ({method, endpoint})), errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ results, error: String(error), errors }, null, 2)); throw error
} finally { await browser.close(); vite?.kill() }
