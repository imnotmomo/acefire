import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' })
await context.route('**/api/deals', route => route.fulfill({ json: { companies: [] } }))
const page = await context.newPage()
const errors = [], requests = [], passed = []
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => requests.push(request.url()))
await fs.mkdir('test-results/scenarios', { recursive: true })
async function check(name, run) { await run(); passed.push(name); console.log('PASS ' + name) }
const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5173'
try {
  await page.goto(`${base}/#/projects`, { waitUntil: 'networkidle' })
  await check('Three pinned demos, supplied covers, formal logo and one Create Project action', async () => {
    assert.deepEqual(await page.locator('.project-card').evaluateAll(cards => cards.map(card => card.dataset.projectId)), ['enfuce-documents', 'healthtech-demo', 'marketplace-demo'])
    await page.locator('.project-cover-image').evaluateAll(images => Promise.all(images.map(image => image.decode())))
    assert.deepEqual(await page.locator('.project-cover-image').evaluateAll(images => images.map(image => image.getAttribute('src'))), ['/images/projects/numbers.jpg', '/images/projects/claims.jpg', '/images/projects/narrative.jpg'])
    assert.equal(await page.getByRole('button', { name: 'Create Project', exact: true }).count(), 1)
    const box = await page.locator('.new-project-button').boundingBox()
    assert(box.height >= 44 && box.width >= 160)
    assert.equal(await page.locator('.brand .ingenium-logo').count(), 1)
    assert.equal(await page.locator('.lucide-sparkles,.lucide-zap,.lucide-wand-sparkles').count(), 0)
    await page.screenshot({ path: 'test-results/scenarios/projects.png', fullPage: true })
  })
  await check('HealthTech claim selection distinguishes internal/external examples and assessment limits', async () => {
    await page.getByRole('link', { name: 'Open HealthTech / Biotech dashboard', exact: true }).click()
    assert.match(await page.locator('.scenario-trace').innerText(), /94%/)
    assert.match(await page.locator('.scenario-trace').innerText(), /ClinicalTrials.gov \/ PubMed/)
    await page.locator('.scenario-claim-option').filter({ hasText: 'Hospital pilots' }).click()
    assert.match(await page.locator('.scenario-trace').innerText(), /Verified · example/)
    assert.match(await page.locator('.scenario-trace').innerText(), /does not establish clinical efficacy/)
    await page.getByRole('button', { name: 'Inspect evidence pack', exact: true }).click()
    assert.match(await page.getByRole('dialog').innerText(), /SIMULATED/)
    await page.keyboard.press('Escape')
    await page.locator('.scenario-claim-option').filter({ hasText: 'Regulatory pathway' }).click()
    assert.match(await page.locator('.scenario-trace').innerText(), /Unsupported/)
    await page.screenshot({ path: 'test-results/scenarios/healthtech.png', fullPage: true })
  })
  await check('Report selection, human edits and exports retain simulation labels and citations', async () => {
    await page.getByRole('button', { name: 'Review report', exact: true }).click()
    assert.equal(await page.locator('.finding-card').count(), 0)
    await page.locator('#section-clinical .report-claim').filter({ hasText: 'Clinical accuracy reaches 94%' }).first().click()
    assert.match(await page.locator('.finding-card').innerText(), /SIMULATED INTERNAL/)
    await page.getByRole('button', { name: 'Open source evidence', exact: true }).click()
    assert.match(await page.getByRole('dialog').innerText(), /not retrieved evidence/)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Edit Clinical / Regulatory', exact: true }).click()
    const editor = page.getByLabel('Section content', { exact: true })
    await editor.fill((await editor.inputValue()) + '\n\nReviewer note: request prospective validation.')
    await page.getByRole('button', { name: 'Save revision', exact: true }).click()
    await page.locator('.review-context-tabs').getByRole('tab', { name: /Activity/ }).click()
    await page.locator('.activity-filters').getByRole('button', { name: 'Human', exact: true }).click()
    assert.match(await page.locator('.human-revision').innerText(), /Clinical \/ Regulatory/)
    await page.reload({ waitUntil: 'networkidle' })
    assert.match(await page.locator('.report-paper').innerText(), /request prospective validation/)
    await page.getByRole('button', { name: 'Continue to export', exact: true }).click()
    await page.getByRole('button', { name: /^Markdown/ }).click()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download Markdown', exact: true }).click()
    const downloaded = await pending
    const filename = 'test-results/scenarios/healthtech-report.md'
    await downloaded.saveAs(filename)
    const text = await fs.readFile(filename, 'utf8')
    assert.match(text, /SIMULATED DEMO/)
    assert.match(text, /No live external retrieval/)
    assert.match(text, /Reviewer note/)
    assert.doesNotMatch(text, /Historical saved extracts/)
  })
  await check('Marketplace reveals growth-quality, conversion, CAC and stale-market-source risks', async () => {
    await page.goto(`${base}/#/project/marketplace-demo/dashboard`, { waitUntil: 'networkidle' })
    assert.match(await page.locator('.scenario-trace').innerText(), /150%/)
    assert.match(await page.locator('.scenario-trace').innerText(), /subsidies/)
    await page.locator('.scenario-claim-option').filter({ hasText: 'Unit economics' }).click()
    assert.match(await page.locator('.scenario-trace').innerText(), /rising CAC/)
    await page.locator('.scenario-claim-option').filter({ hasText: 'User conversion' }).click()
    assert.match(await page.locator('.scenario-trace').innerText(), /App Store \/ Reddit/)
    await page.locator('.scenario-claim-option').filter({ hasText: 'Market leadership' }).click()
    assert.match(await page.locator('.scenario-trace').innerText(), /older market-size citation/)
    await page.screenshot({ path: 'test-results/scenarios/marketplace.png', fullPage: true })
    assert.equal(requests.some(url => /pubmed|clinicaltrials|fda\.gov|reddit\.com|similarweb\.com/.test(url)), false)
  })
  await check('Desktop, tablet and mobile scenario pages do not overflow', async () => {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const route of ['/projects', '/project/healthtech-demo/dashboard', '/project/healthtech-demo/report/review', '/project/marketplace-demo/dashboard', '/project/marketplace-demo/data-room']) {
        await page.goto(`${base}/#${route}`, { waitUntil: 'networkidle' })
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow: ${width} ${route}`)
      }
    }
    await page.goto(`${base}/#/projects`, { waitUntil: 'networkidle' })
    await page.screenshot({ path: 'test-results/scenarios/projects-mobile.png', fullPage: true })
  })
  await check('Migrating the old demo catalog preserves custom projects and saved report bytes', async () => {
    const isolated = await browser.newContext()
    await isolated.addInitScript(() => {
      localStorage.setItem('acefire:projects:v1', JSON.stringify([{ id: 'enfuce', name: 'Enfuce' }, { id: 'circle', name: 'Circle' }, { id: 'backerkit', name: 'BackerKit' }, { id: 'my-project', name: 'Custom diligence', sector: 'Other', geography: 'UK', created: '2026-10-01' }]))
      localStorage.setItem('acefire:workspace:v1:enfuce', 'legacy workspace bytes')
    })
    await isolated.route('**/api/deals', route => route.fulfill({ json: { companies: [] } }))
    const migrated = await isolated.newPage()
    await migrated.goto(`${base}/#/projects`, { waitUntil: 'networkidle' })
    assert.equal(await migrated.locator('.project-card').count(), 4)
    assert.equal(await migrated.evaluate(() => localStorage.getItem('acefire:workspace:v1:enfuce')), 'legacy workspace bytes')
    assert.match(await migrated.locator('.project-card').last().innerText(), /Custom diligence/)
    await isolated.close()
  })
  assert.deepEqual(errors, [])
  console.log(`${passed.length} scenario browser flows passed; no runtime errors.`)
} finally { await browser.close() }
