import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'

const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 5307, strictPort: true } })
await server.listen()
const base = server.resolvedUrls.local[0]
let executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (!executablePath && await fs.access(candidate).then(() => true, () => false)) executablePath = candidate
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true })
const output = path.resolve('test-results/evidence-workflow'); await fs.mkdir(output, { recursive: true })
const errors = [], unexpected = [], mutations = [], requests = [], findings = [], results = []
const cpuRate = Math.max(1, Math.min(8, Number(process.env.EVIDENCE_TEST_CPU_RATE) || 1))
let fileMode = 'okay'
const page = await context.newPage(); page.setDefaultTimeout(10_000); page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
if (cpuRate > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
await context.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url())
  requests.push({ path: url.pathname, auth: request.headers().authorization ?? null })
  if (request.method() !== 'GET') { mutations.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 405, json: { detail: 'No writes or model calls permitted.' } }); return }
  if (url.pathname === '/api/calculation-runtime') { await route.fulfill({ json: { mode: 'llm_local', configured: false, model: 'fixture-model', executor: 'local_python', generation_provider: 'fixture', missing: ['No live provider in fixture'], maximum_inputs: 100 } }); return }
  const source = /^\/api\/sources\/([^/]+)\/file$/.exec(url.pathname)
  if (source) {
    if (request.headers().authorization !== 'Bearer fixture-evidence-access-token') { await route.fulfill({ status: 401, json: { detail: 'Fixture original requires its API access token.' } }); return }
    if (fileMode === 'unavailable') { await route.fulfill({ status: 503, json: { detail: 'Fixture source storage unavailable.' } }); return }
    const originals = await page.evaluate(() => window.evidenceFixture.originals)
    if (!(source[1] in originals)) { unexpected.push(url.pathname); await route.fulfill({ status: 404, json: { detail: 'No fixture original.' } }); return }
    await route.fulfill({ body: fileMode === 'tamper' ? 'Different evidence version.' : originals[source[1]], headers: { 'Content-Type': 'text/plain' } }); return
  }
  unexpected.push(url.pathname); await route.fulfill({ status: 501, json: { detail: 'No live API permitted.' } })
})
const inspector = () => page.getByRole('dialog', { name: 'Evidence inspector', exact: true })
async function close() { await page.keyboard.press('Escape'); await inspector().waitFor({ state: 'detached' }) }
async function primary() { await page.getByRole('button', { name: 'Inspect Fixture exact replay', exact: true }).click(); await inspector().waitFor() }
async function check(name, callback) { console.log(`CHECK ${name}`); await callback(); results.push(name); console.log(`PASS ${name}`) }
try {
  await page.goto(`${base}tests/evidence-workflow.html`, { waitUntil: 'networkidle' }); await page.locator('.connected-observations').waitFor()
  await check('Dashboard inventory and route controls use actual fixture records and retain exact decimal digits', async () => {
    assert.match(await page.locator('.connected-calculation-hero').innerText(), /9,007,199,254,740,993\.1250 USD/)
    assert.match(await page.getByRole('region', { name: 'Report inventory', exact: true }).innerText(), /25/)
    await page.getByRole('button', { name: 'Build report', exact: true }).click(); assert.equal(await page.getByLabel('Fixture route').innerText(), '/project/fixture-evidence-company/report/build')
    await page.getByRole('button', { name: 'Open data room', exact: true }).click(); assert.equal(await page.getByLabel('Fixture route').innerText(), '/project/fixture-evidence-company/data-room')
    await page.getByRole('button', { name: 'Refresh stored calculations', exact: true }).click(); assert.equal(await page.getByLabel('Fixture refreshes').innerText(), '1')
  })
  await check('Reported values support paging, metric search, provider and Missing/Verify/Conflict filters without zero substitution', async () => {
    const region = page.locator('.connected-observations'), rows = region.locator('tbody tr')
    assert.equal(await rows.count(), 20); await region.getByRole('button', { name: 'Show more values', exact: true }).click(); assert.equal(await rows.count(), 25)
    await page.getByLabel('Search reported values', { exact: true }).fill('Fixture metric 25'); assert.equal(await rows.count(), 1)
    await page.getByLabel('Search reported values', { exact: true }).fill('no-match'); await region.getByText('No matching source values', { exact: true }).waitFor()
    await page.getByLabel('Search reported values', { exact: true }).fill(''); await page.getByLabel('Filter reported values by source', { exact: true }).selectOption('pitchbook'); assert.equal(await rows.count(), 12)
    await page.getByLabel('Filter reported values by source', { exact: true }).selectOption('all'); await page.getByLabel('Filter reported values by state', { exact: true }).selectOption('missing'); assert.equal(await rows.count(), 1); assert.match(await rows.innerText(), /Unavailable/); assert.match(await rows.innerText(), /N\.a\./)
    await page.getByLabel('Filter reported values by state', { exact: true }).selectOption('conflict'); assert.equal(await rows.count(), 2)
    await page.getByLabel('Filter reported values by state', { exact: true }).selectOption('verify'); assert.equal(await rows.count(), 20)
    await page.getByLabel('Filter reported values by state', { exact: true }).selectOption('all')
  })
  await check('Profile fields and original source sentences page, search and open their exact bound evidence', async () => {
    assert.equal(await page.locator('.connected-profile-fields>button').count(), 8); await page.getByRole('button', { name: 'Show more profile fields', exact: true }).click(); assert.equal(await page.locator('.connected-profile-fields>button').count(), 10)
    await page.getByLabel('Search company profile', { exact: true }).fill('value 9'); assert.equal(await page.locator('.connected-profile-fields>button').count(), 1); await page.locator('.connected-profile-fields>button').click()
    assert.equal(await inspector().locator('.connected-source-quotation').innerText(), 'Fixture profile value 9'); await inspector().getByRole('tab', { name: 'Source details', exact: true }).click(); assert.match(await inspector().innerText(), /field:profile:\/profile_9/); await close()
    await page.getByLabel('Search company profile', { exact: true }).fill('missing'); await page.getByText('No matching profile fields.', { exact: true }).waitFor(); await page.getByLabel('Search company profile', { exact: true }).fill('')
    assert.equal(await page.locator('.connected-statement-card').count(), 8); await page.getByRole('button', { name: 'Show more source sentences', exact: true }).click(); assert.equal(await page.locator('.connected-statement-card').count(), 12)
    await page.getByLabel('Search source sentences', { exact: true }).fill('quotation 12'); assert.equal(await page.locator('.connected-statement-card').count(), 1); await page.locator('.connected-statement-card').getByRole('button', { name: 'Inspect sentence evidence', exact: true }).click()
    assert.equal(await inspector().locator('.connected-source-quotation').innerText(), 'Fixture quotation 12 names its original source line.'); assert.match(await inspector().innerText(), /Fixture extracted paraphrase 12/); assert.match(await inspector().innerText(), /Lines 12–12/); await close()
    await page.getByLabel('Search source sentences', { exact: true }).fill('')
  })
  await check('Period coverage chooser and duration, closing-balance and unresolved records open their own observations', async () => {
    const coverage = page.locator('.connected-period-section')
    assert.match(await coverage.innerText(), /2024-01-01 – 2024-03-31/); assert.match(await coverage.innerText(), /does not annualize/)
    await coverage.getByRole('button', { name: /Fixture Q1 2024/ }).click(); assert.match(await inspector().innerText(), /Exact source amount/); await close()
    await coverage.getByRole('button', { name: /Fixture closing balance/ }).click(); assert.match(await inspector().locator('.connected-exact-value').innerText(), /^0 USD/); await close()
    await coverage.getByRole('button', { name: /Fixture period unknown/ }).click(); assert.match(await inspector().locator('.connected-exact-value').innerText(), /^Unavailable/); await close()
    await coverage.getByRole('combobox', { name: 'Metric and source', exact: true }).selectOption('1'); assert.match(await coverage.innerText(), /No exact duration span/)
    await coverage.getByRole('combobox', { name: 'Metric and source', exact: true }).selectOption('0')
  })
  await check('Conflict alternatives and stored Missing calculations keep original values and distinct evidence identities', async () => {
    const alternatives = page.locator('.connected-flags .connected-conflict-alternative')
    assert.equal(await alternatives.count(), 2); await alternatives.nth(1).getByRole('button', { name: 'Inspect source', exact: true }).click(); assert.match(await inspector().innerText(), /Fixture metric 4/); await close()
    await page.locator('.connected-small-calculation').click(); assert.match(await inspector().locator('.connected-exact-value').innerText(), /^Unavailable/); assert.equal(await inspector().getByRole('tab', { name: 'Execution', exact: true }).count(), 0)
    await inspector().getByRole('tab', { name: 'Lineage', exact: true }).click(); await inspector().getByText('No recorded graph', { exact: true }).waitFor(); await close()
  })
  await check('Calculation Evidence and Execution show exact recorded amounts, normalization, quoted premises, code and worker output', async () => {
    await page.getByRole('button', { name: 'Follow the calculation', exact: true }).click()
    const dialog = inspector(); assert.match(await dialog.locator('.connected-exact-value').innerText(), /9,007,199,254,740,993\.1250 USD/)
    await dialog.getByText('How source inputs were normalized', { exact: true }).click(); assert.match(await dialog.locator('.connected-normalization').innerText(), /9007199254740993\.1250/)
    assert.equal(await dialog.locator('.connected-quoted-premise blockquote').innerText(), 'Fixture source period covers January through March only.')
    await dialog.locator('.connected-quoted-premise').getByText('Original source text', { exact: true }).click(); assert.equal(await dialog.locator('.connected-original-text').innerText(), 'Fixture source period covers January through March only.')
    await dialog.getByRole('tab', { name: 'Execution', exact: true }).click(); assert.match(await dialog.getByLabel('Generated calculation Python', { exact: true }).innerText(), /Decimal\("9007199254740993\.1250"\)/)
    assert.equal(await dialog.getByLabel('Calculation standard output', { exact: true }).innerText(), '{"value":"9007199254740993.1250"}\n')
    await dialog.getByText('All supplied source text (1)', { exact: true }).click(); assert.match(await dialog.locator('.connected-supplied-text').innerText(), /Fixture source period covers January through March only/)
    assert.match(await dialog.innerText(), /does not establish a full-year amount/)
  })
  await check('Recorded graph nodes expose source hashes, exact numbers, formula and original quotation; zoom bounds and keyboard scrolling work', async () => {
    const dialog = inspector(); await dialog.getByRole('tab', { name: 'Lineage', exact: true }).click()
    const graph = dialog.locator('.connected-lineage'), nodes = graph.locator('.connected-graph-node'); assert.equal(await nodes.count(), 5)
    await nodes.filter({ hasText: 'Exact source observation' }).click(); assert.match(await graph.locator('.connected-node-details').innerText(), /9,007,199,254,740,993\.1250 USD/)
    await nodes.filter({ hasText: 'Quoted period constraint' }).click(); assert.equal(await graph.locator('.connected-node-quote').innerText(), 'Fixture source period covers January through March only.')
    await nodes.filter({ hasText: 'Recorded fixture result' }).click(); assert.match(await graph.locator('.connected-node-details').innerText(), /recorded source amount/); assert.match(await graph.locator('.connected-node-details').innerText(), /fixture-1/)
    await nodes.filter({ hasText: 'Original fixture finance' }).click(); const sha = await page.evaluate(() => window.evidenceFixture.report.source_files[0].sha256); assert.match(await graph.locator('.connected-node-details').innerText(), new RegExp(sha))
    for (let i = 0; i < 5; i++) await graph.getByRole('button', { name: 'Zoom out', exact: true }).click(); assert.equal(await graph.getByRole('button', { name: 'Zoom out', exact: true }).isDisabled(), true)
    for (let i = 0; i < 10; i++) await graph.getByRole('button', { name: 'Zoom in', exact: true }).click(); assert.equal(await graph.getByRole('button', { name: 'Zoom in', exact: true }).isDisabled(), true)
    assert.equal(await graph.locator('.connected-graph-surface').evaluate(element => element.style.transform), 'scale(1.5)')
    const scroll = graph.getByRole('region', { name: 'Scrollable calculation graph', exact: true }); await scroll.evaluate(element => { element.scrollLeft = 0 }); await scroll.focus(); await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.querySelector('.connected-graph-scroll').scrollLeft > 0)
    assert.ok(await scroll.evaluate(element => element.scrollWidth > element.clientWidth))
  })
  await check('Source details copy the exact reference, record identity, source locator and SHA, and explain denied clipboard permission', async () => {
    const dialog = inspector(); await dialog.getByRole('tab', { name: 'Source details', exact: true }).click(); await dialog.getByRole('button', { name: 'Copy reference', exact: true }).click()
    await page.getByLabel('Fixture notification').filter({ hasText: 'Source reference copied.' }).waitFor()
    const copied = await page.evaluate(() => navigator.clipboard.readText()); assert.match(copied, /calculation-primary/); assert.match(copied, /9,007,199,254,740,993\.1250 USD/); assert.match(copied, /SHA-256/); assert.match(copied, /Lines 1–1/)
    await page.evaluate(() => { window.evidenceFixture.clipboard = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = async () => { throw new DOMException('Fixture denied clipboard', 'NotAllowedError') } })
    await dialog.getByRole('button', { name: 'Copy reference', exact: true }).click(); await page.getByLabel('Fixture notification').filter({ hasText: 'Clipboard access was denied' }).waitFor(); assert.match(await page.getByLabel('Fixture notification').innerText(), /Clipboard access was denied/)
    await page.evaluate(() => { navigator.clipboard.writeText = window.evidenceFixture.clipboard })
    await dialog.locator('.connected-source-reference').last().getByText('Original locator details', { exact: true }).click(); assert.match(await dialog.locator('.connected-source-reference').last().innerText(), /Line start/)
  })
  await check('File tab selects each bound source, retries storage failures and reads the authenticated SHA-checked original', async () => {
    const dialog = inspector(); fileMode = 'unavailable'; await dialog.getByRole('tab', { name: 'File', exact: true }).click(); await dialog.getByRole('button', { name: 'Retry preview', exact: true }).waitFor()
    fileMode = 'okay'; await dialog.getByRole('button', { name: 'Retry preview', exact: true }).click(); await dialog.locator('.source-preview-text').waitFor(); assert.match(await dialog.locator('.source-preview-text').innerText(), /9007199254740993\.1250/)
    await dialog.getByLabel('Inspect source file', { exact: true }).selectOption('1'); await dialog.locator('.source-preview-text').filter({ hasText: 'Fixture source period covers' }).waitFor()
    assert.match(await dialog.locator('.source-preview-heading').innerText(), /fixture-premises.txt/)
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.locator('.source-preview').getByRole('button', { name: 'Download original', exact: true }).click()])
    assert.equal(download.suggestedFilename(), 'fixture-premises.txt'); assert.equal(await fs.readFile(await download.path(), 'utf8'), await page.evaluate(() => window.evidenceFixture.originals.premises))
    assert.equal(requests.filter(request => request.path.startsWith('/api/sources/')).every(request => request.auth === 'Bearer fixture-evidence-access-token'), true)
  })
  await check('Original download rejects changed bytes, permits retry and preserves the exact original content', async () => {
    const dialog = inspector(); fileMode = 'tamper'; const toolbar = dialog.locator('.inspector-file-toolbar'); await toolbar.getByRole('button', { name: 'Download original', exact: true }).click(); await toolbar.getByRole('alert').filter({ hasText: 'does not match' }).waitFor()
    fileMode = 'okay'; const [download] = await Promise.all([page.waitForEvent('download'), toolbar.getByRole('button', { name: 'Download original', exact: true }).click()]); assert.equal(await fs.readFile(await download.path(), 'utf8'), await page.evaluate(() => window.evidenceFixture.originals.premises))
    await close(); await page.getByLabel('Search reported values', { exact: true }).fill('Fixture metric 25'); await page.locator('.connected-observations').getByRole('button', { name: 'Fixture metric 25', exact: true }).click()
    assert.equal(await inspector().getByRole('button', { name: 'Open file', exact: true }).first().isDisabled(), true); await inspector().getByRole('tab', { name: 'File', exact: true }).click(); assert.match(await inspector().innerText(), /Original file unavailable here/); await close(); await page.getByLabel('Search reported values', { exact: true }).fill('')
  })
  await check('Evidence controls stay reachable within mobile dialog bounds and keep graph overflow inside its scrolling region', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await primary(); await inspector().getByRole('tab', { name: 'Lineage', exact: true }).click()
    assert.equal(await inspector().evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
    await inspector().getByRole('tab', { name: 'Execution', exact: true }).click(); await inspector().getByLabel('Generated calculation Python', { exact: true }).scrollIntoViewIfNeeded()
    assert.equal(await inspector().evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
    await page.screenshot({ path: path.join(output, 'mobile-execution.png'), fullPage: false, animations: 'disabled' }); await close(); await page.setViewportSize({ width: 1440, height: 1100 })
  })
  await check('A premise source opens through the same authenticated and version-checked original-file workflow', async () => {
    await primary(); const dialog = inspector(); const before = requests.length
    await dialog.locator('.connected-quoted-premise').getByRole('button', { name: 'Open file', exact: true }).click()
    await dialog.locator('.source-preview-text').filter({ hasText: 'Fixture source period covers' }).waitFor()
    assert.equal(await dialog.getByRole('tab', { name: 'File', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(await dialog.getByLabel('Inspect source file', { exact: true }).inputValue(), '1')
    assert.match(await dialog.locator('.source-preview-heading').innerText(), /fixture-premises.txt/); assert.match(await dialog.locator('.source-preview-heading').innerText(), /Lines 1–1/)
    assert.equal(await dialog.locator('.source-preview-text').innerText(), await page.evaluate(() => window.evidenceFixture.originals.premises))
    const originalRequest = requests.slice(before).find(request => request.path === '/api/sources/premises/file')
    assert.equal(originalRequest?.auth, 'Bearer fixture-evidence-access-token')
    await dialog.getByRole('tab', { name: 'Execution', exact: true }).click(); await dialog.locator('.connected-quoted-premise').getByRole('button', { name: 'Open file', exact: true }).click()
    await dialog.locator('.source-preview-text').filter({ hasText: 'Fixture source period covers' }).waitFor()
    assert.equal(context.pages().length, 1, 'Premise originals use the inspector rather than an unauthenticated popup.')
  })
  await check('A changed or foreign premise original cannot become a clickable file action while the recorded quotation stays visible', async () => {
    const other = await context.newPage(); other.setDefaultTimeout(10_000); other.on('pageerror', error => errors.push(error.message))
    if (cpuRate > 1) await (await context.newCDPSession(other)).send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
    await other.goto(`${base}tests/evidence-workflow.html?premise=foreign`, { waitUntil: 'networkidle' })
    await other.getByRole('button', { name: 'Inspect Fixture exact replay', exact: true }).click()
    const premise = other.getByRole('dialog', { name: 'Evidence inspector', exact: true }).locator('.connected-quoted-premise')
    assert.equal(await premise.locator('blockquote').innerText(), 'Fixture source period covers January through March only.')
    assert.equal(await premise.getByRole('button', { name: 'Open file', exact: true }).count(), 0)
    assert.equal(await premise.getByRole('button', { name: 'Download original', exact: true }).count(), 0)
    assert.match(await premise.innerText(), /no matching supplied original/); await other.close()
  })
  assert.deepEqual(unexpected, []); assert.deepEqual(mutations, []); assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: results, cpuRate, findings, mocked_api: true, live_model_calls: 0, browser_errors: errors, unexpected_api: unexpected, mutations }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: results, findings, error: String(error), mocked_api: true, browser_errors: errors, unexpected_api: unexpected, mutations }, null, 2)); throw error
} finally { await context.close(); await browser.close(); await server.close() }
