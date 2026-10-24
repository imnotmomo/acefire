import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { formatDecimal, humanize, reportEvidence } from '../src/backend.ts'

const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5173'
const artifactDir = path.resolve('test-results/integration')
await fs.mkdir(artifactDir, { recursive: true })
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}), headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, acceptDownloads: true })
const page = await context.newPage()
const errors = []
const mutations = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
context.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') mutations.push({ url: request.url(), method: request.method() }) })
const results = []
const apiPattern = '**/api/deals/circle-2025-ipo/report'
const dashboard = `${base}/#/project/circle/dashboard`
async function check(name, callback) { await callback(); results.push(name); console.log(`PASS ${name}`) }
async function connected(target = page) { await target.getByText('Stored company report connected', { exact: true }).waitFor() }
async function refreshStored(target = page) {
  const response = target.waitForResponse(item => item.url().endsWith('/api/deals/circle-2025-ipo/report'))
  await target.getByRole('button', { name: 'Refresh stored report', exact: true }).click()
  await response
  await connected(target)
}
try {
  const response = await context.request.get(`${base}/api/deals/circle-2025-ipo/report`)
  assert.equal(response.status(), 200, 'Start the C backend, prepare Circle, and configure the Vite API proxy first.')
  const report = await response.json()
  assert.equal(report.company.deal_id, 'circle-2025-ipo')
  const calculated = report.calculations.filter(item => item.calculation.status === 'succeeded').sort((a, b) => String(b.calculation.parameters.agent_execution?.executed_at ?? '').localeCompare(String(a.calculation.parameters.agent_execution?.executed_at ?? '')))[0]
  assert.ok(calculated, 'Prepare the Circle demo calculation for integration testing.')
  const calculation = calculated.calculation
  const calculationTitle = humanize(calculation.metric_key)
  const evidence = reportEvidence(report)
  const narrative = sourceReport => async route => {
    // Deterministic UI fixture only: this suite never calls the live model.
    const request = route.request().postDataJSON()
    const sentence = evidence.find(item => item.kind === 'profile' && item.id.includes('company_description_short'))
    const result = evidence.find(item => item.id === calculation.id)
    const claims = item => [{ id: `fixture-${item.id}`, text: item.kind === 'calculation' ? `Stored asset-component sum: ${formatDecimal(calculation.value, calculation.unit)}.` : 'The stored company profile describes Circle.', kind: 'reported_summary', citations: [{ evidence_id: item.id, kind: item.kind === 'profile' ? 'statement' : item.kind, quote: item.citationText ?? item.excerpt, ...(item.kind === 'calculation' ? { sources: item.sources } : { source: item.sources[0] }) }] }]
    await route.fulfill({ json: { id: 'integration-ui-draft', deal_id: sourceReport.company.deal_id, based_on_report_id: sourceReport.report_id, model: 'mock-ui-contract', generated_at: '2026-10-24T18:00:00Z', status: 'model_generated_unverified', sections: request.sections.map(section => ({ id: section.id, claims: section.id === 'overview' && sentence ? claims(sentence) : section.id === 'financials' ? claims(result) : [], gaps: ['overview', 'financials'].includes(section.id) ? [] : ['Supporting source evidence is unavailable.'] })) } })
  }
  await context.route('**/api/deals/circle-2025-ipo/report/draft', narrative(report))

  await check('Circle reads the real backend report with exact stored calculation and inventory', async () => {
    await page.goto(dashboard, { waitUntil: 'networkidle' })
    await connected()
    assert.match(await page.locator('.connected-inventory').innerText(), new RegExp(String(report.reported_metrics.length)))
    assert.equal(await page.locator('.connected-hero-value').innerText(), formatDecimal(calculation.value, calculation.unit))
    assert.match(await page.locator('.connected-formula').first().innerText(), new RegExp(calculation.formula.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await page.screenshot({ path: path.join(artifactDir, 'circle-dashboard.png'), fullPage: true })
  })
  await check('Calculation evidence includes actual inputs, source cells, SHA and selectable lineage', async () => {
    await page.getByRole('button', { name: `Inspect ${calculationTitle}`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Evidence inspector', exact: true })
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /I49/)
    assert.match(await dialog.innerText(), /I53/)
    assert.match(await dialog.innerText(), new RegExp(calculated.sources[0].sha256))
    await dialog.getByRole('tab', { name: 'Lineage', exact: true }).click()
    assert.equal(await dialog.locator('.connected-graph-node').count(), calculated.nodes.length)
    assert.equal(await dialog.locator('.connected-graph-edges g').count(), calculated.edges.length)
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click()
    assert.match(await dialog.locator('.lineage-toolbar').innerText(), /110%/)
    await dialog.locator('.connected-graph-node.formula').click()
    assert.match(await dialog.locator('.connected-node-details').innerText(), /Function version/)
    await page.screenshot({ path: path.join(artifactDir, 'calculation-lineage.png'), fullPage: true })
    await page.keyboard.press('Escape')
  })
  await check('Reported values are searchable and preserve raw unresolved values and source lineage', async () => {
    await page.getByLabel('Search reported values', { exact: true }).fill('Valuation')
    const row = page.locator('.connected-observations tbody tr').first()
    assert.match(await row.innerText(), /Unavailable/)
    assert.match(await row.innerText(), /\$25B\+/)
    await row.getByRole('button').click()
    const dialog = page.getByRole('dialog', { name: 'Evidence inspector', exact: true })
    assert.match(await dialog.innerText(), /\$25B\+/)
    await dialog.getByRole('tab', { name: 'Lineage', exact: true }).click()
    assert.equal(await dialog.locator('.connected-graph-node').count(), 2)
    assert.equal(await dialog.locator('.connected-graph-edges g').count(), 1)
    await page.keyboard.press('Escape')
    await page.getByLabel('Search reported values', { exact: true }).fill('')
  })
  await check('Report generation, UUID citations, edits and stored-report refresh work together', async () => {
    await page.getByRole('link', { name: 'Report', exact: true }).click()
    await page.getByRole('button', { name: 'Generate report preview', exact: false }).click()
    await page.locator('.report-paper').waitFor()
    const financials = page.locator('#section-financials')
    assert.match(await financials.innerText(), /45,834,409,000 USD/)
    await financials.getByRole('button', { name: `Inspect ${calculationTitle} evidence`, exact: true }).click()
    assert.match(await page.locator('.findings-panel').innerText(), /45,834,409,000 USD/)
    await page.getByRole('button', { name: 'Open source evidence', exact: true }).click()
    await page.getByRole('dialog', { name: 'Evidence inspector', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Edit Company overview', exact: true }).click()
    const editor = page.getByLabel('Section content', { exact: true })
    await editor.fill(`${await editor.inputValue()}\n\nIntegration reviewer note: retain source scope.`)
    await page.getByRole('button', { name: 'Save revision', exact: true }).click()
    await refreshStored()
    assert.match(await page.locator('#section-overview').innerText(), /Integration reviewer note/)
    await page.reload({ waitUntil: 'networkidle' })
    await connected()
    assert.match(await page.locator('#section-overview').innerText(), /Integration reviewer note/)
  })
  await check('Changed backend evidence pauses export and preserves the edited draft', async () => {
    const changed = structuredClone(report); changed.report_id = 'integration-test-new-report-version'
    await page.route(apiPattern, route => route.fulfill({ json: changed }))
    await refreshStored()
    assert.match(await page.locator('#section-overview').innerText(), /Integration reviewer note/)
    await page.goto(`${base}/#/project/circle/report/export`, { waitUntil: 'networkidle' })
    assert.equal(await page.getByRole('button', { name: 'Download PDF', exact: true }).isDisabled(), true)
    await page.unroute(apiPattern)
    await refreshStored()
    assert.equal(await page.getByRole('button', { name: 'Download PDF', exact: true }).isEnabled(), true)
    await page.goto(`${base}/#/project/circle/report/review`, { waitUntil: 'networkidle' })
  })
  await check('Markdown, PDF and DOCX exports contain backend evidence references', async () => {
    await page.getByRole('button', { name: 'Continue to export', exact: true }).click()
    for (const format of ['Markdown', 'PDF', 'DOCX']) {
      await page.locator('.format-options').getByRole('button', { name: new RegExp(`^${format}`) }).click()
      const waiting = page.waitForEvent('download')
      await page.getByRole('button', { name: `Download ${format}`, exact: true }).click()
      const download = await waiting
      const filename = path.join(artifactDir, download.suggestedFilename())
      await download.saveAs(filename)
      const bytes = await fs.readFile(filename)
      assert.ok(bytes.length > 500)
      if (format === 'PDF') assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
      if (format === 'DOCX') assert.equal(bytes.subarray(0, 2).toString(), 'PK')
      if (format === 'Markdown') {
        assert.match(bytes.toString(), new RegExp(calculation.id))
        assert.match(bytes.toString(), /45,834,409,000 USD/)
        assert.match(bytes.toString(), /Input observation IDs/)
        assert.match(bytes.toString(), new RegExp(calculated.sources[0].sha256))
        assert.match(bytes.toString(), /Integration reviewer note/)
      }
    }
  })
  await check('Registered source files open through the proxy and uploads are available', async () => {
    await page.getByRole('link', { name: 'Data room', exact: true }).click()
    await page.locator('.backend-source-table tbody tr').first().waitFor()
    assert.equal(await page.locator('.backend-source-table tbody tr').count(), report.source_files.length)
    assert.equal(await page.getByRole('button', { name: 'Upload files', exact: true }).isEnabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Akta retrieval unavailable', exact: true }).isDisabled(), true)
    assert.equal(await page.locator('input[type=file]').count(), 1)
    const waiting = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download original', exact: true }).first().click()
    const downloaded = await waiting
    assert.ok(downloaded.suggestedFilename().length > 0)
    await page.screenshot({ path: path.join(artifactDir, 'registered-sources.png'), fullPage: true })
    assert.ok(mutations.every(item => item.url.endsWith('/report/draft')), 'Only mocked narrative requests are permitted; no backend records are mutated.')
  })
  await check('Circle and Enfuce stay isolated and mobile routes do not overflow', async () => {
    await page.goto(`${base}/#/project/enfuce/dashboard`, { waitUntil: 'networkidle' })
    assert.match(await page.locator('.hero-number').innerText(), /3,417,663.76/)
    assert.equal(await page.locator('.connected-inventory').count(), 0)
    await page.setViewportSize({ width: 390, height: 844 })
    for (const route of ['dashboard', 'report/review', 'data-room']) {
      await page.goto(`${base}/#/project/circle/${route}`, { waitUntil: 'networkidle' }); await connected()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, route)
    }
    await page.screenshot({ path: path.join(artifactDir, 'circle-mobile.png'), fullPage: true })
    assert.deepEqual(errors, [])
  })
  await check('Loading, unavailable backend and retry are explicit without fixture fallback', async () => {
    const isolated = await browser.newContext()
    const retryPage = await isolated.newPage()
    let release
    const gate = new Promise(resolve => { release = resolve })
    await retryPage.route(apiPattern, async route => { await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Test unavailable service"}' }) })
    await retryPage.goto(dashboard, { waitUntil: 'domcontentloaded' })
    await retryPage.getByRole('heading', { name: 'Loading company evidence', exact: true }).waitFor()
    release()
    await retryPage.getByRole('heading', { name: 'Company report unavailable', exact: true }).waitFor()
    assert.equal(await retryPage.locator('.hero-number,.connected-hero-value').count(), 0)
    await retryPage.unroute(apiPattern)
    await retryPage.getByRole('button', { name: 'Retry connection', exact: true }).click(); await connected(retryPage)
    await isolated.close()
  })
  await check('Wrong-company responses fail closed and numeric conflicts remain nonblocking flags', async () => {
    const isolated = await browser.newContext()
    const testPage = await isolated.newPage()
    const wrong = structuredClone(report); wrong.company.deal_id = 'different-company'
    await testPage.route(apiPattern, route => route.fulfill({ json: wrong }))
    await testPage.goto(dashboard, { waitUntil: 'networkidle' })
    await testPage.getByRole('heading', { name: 'Company report unavailable', exact: true }).waitFor()
    assert.match(await testPage.getByRole('alert').innerText(), /different company/)
    await testPage.unroute(apiPattern)
    const flagged = structuredClone(report)
    flagged.conflict_numbers = true
    const alternative = { calculation_id: calculation.id, value: calculation.value, unit: calculation.unit, observation_ids: calculation.input_ids, sources: calculated.sources }
    const conflict = { id: 'integration-test-conflict', observation_ids: calculation.input_ids, kind: 'aggregate_value_conflict', status: 'conflict_numbers', alternatives: [alternative, { ...alternative, value: '45834409001' }] }
    flagged.conflicts = [conflict]
    flagged.calculations.find(item => item.calculation.id === calculation.id).conflict_numbers = true
    flagged.calculations.find(item => item.calculation.id === calculation.id).conflicts = [conflict]
    await testPage.route(apiPattern, route => route.fulfill({ json: flagged }))
    await testPage.route('**/api/deals/circle-2025-ipo/report/draft', narrative(flagged))
    await testPage.getByRole('button', { name: 'Retry connection', exact: true }).click(); await connected(testPage)
    const flags = testPage.getByRole('region', { name: 'Conflict numbers', exact: true })
    // A named section has region semantics through aria-label.
    assert.match(await flags.innerText(), /45,834,409,001 USD/)
    assert.equal(await testPage.getByRole('button', { name: /approve|resolve|choose authoritative/i }).count(), 0)
    await testPage.getByRole('button', { name: 'Build report', exact: true }).click()
    await testPage.getByRole('button', { name: 'Generate report preview', exact: false }).click()
    await testPage.locator('.report-paper').waitFor()
    assert.match(await testPage.locator('.report-paper').innerText(), /45,834,409,000 USD/)
    assert.match(await testPage.locator('.report-paper').innerText(), /Conflict/)
    await isolated.close()
  })
  await fs.writeFile(path.join(artifactDir, 'results.json'), JSON.stringify({ passed: results, happy_path_errors: errors, backend_mutations: mutations, report_id: report.report_id, source_count: report.source_files.length, observation_count: report.reported_metrics.length }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(artifactDir, 'failure.png'), fullPage: false }).catch(() => {})
  await fs.writeFile(path.join(artifactDir, 'failure.json'), JSON.stringify({ passed: results, errors, message: String(error) }, null, 2))
  throw error
} finally { await browser.close() }
