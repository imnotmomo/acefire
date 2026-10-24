import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

// Reads the configured real database; a paid model call is explicitly opt-in.
const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:4173'
const output = 'test-results/firebase'
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}), headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, acceptDownloads: true })
const page = await context.newPage()
const errors = [], passed = []
page.on('pageerror', error => errors.push(error.message))
async function check(name, run) { await run(); passed.push(name); console.log('PASS ' + name) }
try {
  const health = await (await context.request.get(`${base}/api/health`)).json()
  assert.equal(health.storage, 'firestore')
  const report = await (await context.request.get(`${base}/api/deals/enfuce-2020/report`)).json()
  assert.equal(report.persistence.database_id, 'acefire')
  assert.equal(report.reported_metrics.length, 19)
  assert.ok(report.reported_metrics.every(entry => entry.observation.value === null))
  const saved = report.stored_reports[0]
  const draft = await (await context.request.get(`${base}/api/deals/enfuce-2020/stored-reports/${saved.id}/draft`)).json()
  const citation = draft.sections[0].claims[0].citations[0]
  await page.goto(`${base}/#/project/enfuce-documents/report/build`, { waitUntil: 'networkidle' })
  await check('Firebase reports load in Ingenium with all imported sections', async () => {
    assert.match(await page.locator('.backend-connection').innerText(), /Firebase · acefire/)
    assert.equal(await page.getByRole('button', { name: 'Load saved report', exact: true }).count(), 2)
    await page.getByRole('button', { name: 'Load saved report', exact: true }).first().click()
    await page.locator('.report-paper').waitFor()
    assert.equal(await page.locator('.report-section').count(), draft.sections.length)
    assert.ok((await page.locator('#section-overview').innerText()).includes(draft.sections[0].claims[0].text))
    assert.match(await page.locator('.report-narrative-mode').innerText(), /unverified/)
  })
  await check('Original quotations retain their source page and SHA-256', async () => {
    await page.locator('#section-overview .citation').first().click()
    await page.getByRole('button', { name: 'Open source evidence', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Evidence inspector', exact: true })
    await dialog.waitFor()
    assert.ok((await dialog.innerText()).includes(citation.source.sha256))
    assert.match(await dialog.innerText(), /Page 4/)
    assert.match(await dialog.innerText(), /Original file unavailable here/)
    await page.keyboard.press('Escape')
    await page.locator('.findings-panel .report-source-support summary').click()
    assert.ok((await page.locator('#section-overview .report-source-support').innerText()).includes(citation.quote))
    await page.screenshot({ path: `${output}/enfuce-source-report.png`, fullPage: true })
  })
  await check('Human edits and original support survive refresh and Markdown export', async () => {
    await page.getByRole('button', { name: 'Edit Company overview', exact: true }).click()
    const editor = page.getByLabel('Section content', { exact: true })
    await editor.fill(`${await editor.inputValue()}\n\nReviewer note: retain the historical source period.`)
    await page.getByRole('button', { name: 'Save revision', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh stored report', exact: true }).click()
    await page.locator('.report-paper').waitFor()
    assert.match(await page.locator('#section-overview').innerText(), /Reviewer note/)
    await page.goto(`${base}/#/project/enfuce-documents/report/export`, { waitUntil: 'networkidle' })
    await page.locator('.format-options').getByRole('button', { name: /^Markdown/ }).click()
    const waiting = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download Markdown', exact: true }).click()
    await (await waiting).saveAs(`${output}/enfuce-source-report.md`)
    const markdown = await fs.readFile(`${output}/enfuce-source-report.md`, 'utf8')
    assert.match(markdown, /Reviewer note/); assert.ok(markdown.includes(citation.source.sha256))
  })
  if (process.env.LIVE_COMPANY_CHAT === '1') await check('Live chat answers from Firebase evidence with inspectable citations', async () => {
    await page.locator('.assistant-launcher').click()
    await page.getByLabel('Ask about this company', { exact: true }).fill('What does Enfuce do? Cite original source sentences and preserve their historical context.')
    const waiting = page.waitForResponse(r => r.url().endsWith('/deals/enfuce-2020/chat') && r.request().method() === 'POST', { timeout: 150000 })
    await page.getByRole('button', { name: 'Send company question', exact: true }).click()
    const response = await waiting; assert.equal(response.status(), 200)
    const answer = await response.json(); assert.equal(answer.context_scope, 'entire_company'); assert.ok(answer.citations.length)
    await page.locator('.company-chat-message.assistant').waitFor()
    await page.locator('.company-chat-citations summary').first().click()
    assert.ok((await page.locator('.company-chat-citations').innerText()).includes(answer.citations[0].quote))
    await page.screenshot({ path: `${output}/enfuce-live-company-chat.png`, fullPage: false })
    await page.getByRole('button', { name: /^Inspect .* evidence$/ }).last().click()
    await page.getByRole('dialog', { name: 'Evidence inspector', exact: true }).waitFor()
  })
  assert.deepEqual(errors, [])
  await fs.writeFile(`${output}/results.json`, JSON.stringify({ passed, errors, database: health.database_id, stored_report_id: saved.id }, null, 2))
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {})
  throw error
} finally { await browser.close() }
