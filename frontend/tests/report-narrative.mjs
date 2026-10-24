import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { reportEvidence, formatLocator } from '../src/backend.ts'

// Mocked narrative responses validate the UI contract, not live model generation.
const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5174'
const output = path.resolve('test-results/report-narrative')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}), headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, acceptDownloads: true })
const page = await context.newPage()
const pageErrors = []
const mutations = []
const passed = []
page.on('pageerror', error => pageErrors.push(error.message))
context.on('request', request => { if (request.method() !== 'GET') mutations.push(request.url()) })
async function check(name, callback) { await callback(); passed.push(name); console.log(`PASS ${name}`) }
try {
  const response = await context.request.get(`${base}/api/deals/circle-2025-ipo/report`)
  assert.equal(response.status(), 200, 'Start the existing Circle backend and frontend proxy first.')
  const report = await response.json()
  const evidence = reportEvidence(report)
  const statement = evidence.find(item => item.kind === 'profile' && item.rows.some(([label, value]) => label === 'Field' && value === '/firmographic/company_description_short'))
  const calculation = evidence.find(item => item.kind === 'calculation' && item.calculation?.status === 'succeeded')
  assert.ok(statement); assert.ok(calculation)
  const summary = 'The stored description presents Circle as a financial technology provider of programmable money services.'
  const numericSummary = 'The stored asset-component calculation is available as a separate numeric record for review.'
  let requested
  let mode = 'success'
  let attempt = 0
  await page.route('**/api/deals/circle-2025-ipo/report/draft', async route => {
    attempt++
    requested = route.request().postDataJSON()
    if (mode === 'failure') return route.fulfill({ status: 503, json: { detail: { message: 'Narrative provider temporarily unavailable.' } } })
    const draft = { id: `mock-narrative-${attempt}`, deal_id: mode === 'wrong-company' ? 'unrelated-company' : report.company.deal_id, based_on_report_id: report.report_id, model: 'openai/gpt-6.1-sol', generated_at: '2026-10-24T17:00:00Z', status: 'model_generated_unverified', sections: requested.sections.map(section => ({ id: section.id, title: section.title, claims: section.id === 'overview' ? [{ id: 'mock-overview-claim', text: summary, kind: 'reported_summary', citations: [{ evidence_id: statement.id, kind: 'statement', quote: mode === 'invalid-quote' ? 'An invented source sentence.' : statement.citationText ?? statement.excerpt, source: statement.sources[0] }] }] : section.id === 'financials' ? [{ id: 'mock-financial-claim', text: numericSummary, kind: 'reported_summary', citations: [{ evidence_id: calculation.id, kind: 'calculation', quote: calculation.citationText ?? calculation.excerpt, sources: calculation.sources }] }] : [], gaps: ['overview', 'financials'].includes(section.id) ? [] : [`No supported ${section.title.toLowerCase()} claims were supplied.`] })) }
    return route.fulfill({ json: draft })
  })
  await page.goto(`${base}/#/project/circle/report/build`, { waitUntil: 'networkidle' })
  await check('Circle requests model narrative with selected module preferences and evidence version', async () => {
    await page.getByLabel('Additional focus', { exact: false }).fill('Use the original company description and keep unsupported topics explicit.')
    await page.getByRole('button', { name: 'Generate report preview', exact: false }).click()
    await page.locator('.report-paper').waitFor()
    assert.equal(requested.based_on_report_id, report.report_id)
    assert.ok(requested.sections.every(section => Array.isArray(section.topics) && typeof section.depth === 'string' && typeof section.horizon === 'string'))
    assert.match(await page.locator('#section-overview').innerText(), /stored description presents Circle/)
    assert.match(await page.locator('#section-market').innerText(), /Evidence gap: No supported market/)
    assert.match(await page.locator('.report-narrative-mode').innerText(), /Model-generated · unverified/)
  })
  await check('Summary claims expose exact original supporting text and source pointers/hashes', async () => {
    const section = page.locator('#section-overview')
    await section.getByText('Original supporting text (1 claims)', { exact: true }).click()
    assert.equal(await section.locator('.report-claim-quotation blockquote').textContent(), statement.citationText ?? statement.excerpt)
    assert.match(await section.locator('.report-source-support').innerText(), new RegExp(statement.sources[0].sha256))
    assert.match(await section.locator('.report-source-support').innerText(), new RegExp(formatLocator(statement.sources[0].locator).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await section.getByRole('button', { name: 'Inspect supporting evidence', exact: true }).click()
    await page.getByRole('dialog', { name: 'Evidence inspector', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: path.join(output, 'narrative-source-support.png'), animations: 'disabled' })
  })
  await check('Human edits survive failed or invalid model generation without fixed-text fallback', async () => {
    await page.getByRole('button', { name: 'Edit Company overview', exact: true }).click()
    const editor = page.getByLabel('Section content', { exact: true })
    await editor.fill(`${await editor.inputValue()}\n\nHuman reviewer note: retain the original quoted context.`)
    await page.getByRole('button', { name: 'Save revision', exact: true }).click()
    for (mode of ['failure', 'wrong-company', 'invalid-quote']) {
      await page.goto(`${base}/#/project/circle/report/build`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Regenerate preview', exact: false }).click()
      await page.getByRole('alert').waitFor()
      assert.match(await page.getByRole('alert').innerText(), /preserved|kept/)
      await page.goto(`${base}/#/project/circle/report/review`, { waitUntil: 'networkidle' })
      assert.match(await page.locator('#section-overview').innerText(), /Human reviewer note/)
      assert.match(await page.locator('#section-overview').innerText(), /stored description presents Circle/)
    }
  })
  await check('Narrative exports preserve original claim-to-quote-to-source links and edited body', async () => {
    await page.goto(`${base}/#/project/circle/report/export`, { waitUntil: 'networkidle' })
    await page.locator('.format-options').getByRole('button', { name: /^Markdown/ }).click()
    const waiting = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download Markdown', exact: true }).click()
    const download = await waiting
    const filename = path.join(output, download.suggestedFilename())
    await download.saveAs(filename)
    const text = await fs.readFile(filename, 'utf8')
    assert.match(text, /Human reviewer note/)
    assert.match(text, /Claim-to-source quotations/)
    assert.match(text, /Original model summary/)
    assert.ok(text.includes(statement.citationText ?? statement.excerpt))
    assert.ok(text.includes(statement.id))
    assert.ok(text.includes(statement.sources[0].sha256))
    assert.ok(text.includes(JSON.stringify(statement.sources[0].locator)))
    assert.match(text, /Stored numeric record \(structured backend evidence, not a verbatim document sentence\)/)
  })
  await check('Report support stays usable on mobile and only narrative API writes occur', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${base}/#/project/circle/report/review`, { waitUntil: 'networkidle' })
    await page.locator('#section-overview .report-source-support>summary').click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true)
    await page.screenshot({ path: path.join(output, 'narrative-mobile.png'), animations: 'disabled' })
    assert.equal(mutations.length, 4)
    assert.equal(mutations.every(url => url.endsWith('/report/draft')), true)
    assert.deepEqual(pageErrors, [])
  })
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed, simulation: 'Mocked narrative responses with existing Circle source evidence', mutations, page_errors: pageErrors }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ passed, message: String(error), page_errors: pageErrors }, null, 2))
  throw error
} finally { await browser.close() }
