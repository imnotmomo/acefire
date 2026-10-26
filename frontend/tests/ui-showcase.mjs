import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = [], writes = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url()) })
  await page.route('**/api/deals', route => route.fulfill({ json: { companies: [] } }))
  await page.goto(`${base}/#/projects`)
  await page.locator('.ui-demo-card').first().waitFor()
  assert.equal(await page.locator('.ui-demo-card').count(), 3)
  await page.locator('.ui-demo-card img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  const storage = await page.evaluate(() => localStorage.getItem('acefire:projects:v1'))
  assert.equal(await page.getByRole('button', { name: 'Create Project', exact: true }).count(), 1)
  assert.equal(await page.locator('.projects-heading .button.primary').count(), 0)
  assert.equal(await page.locator('.brand .ingenium-logo').count(), 1)
  await page.getByRole('button', { name: 'Explore HealthTech / Biotech', exact: true }).click()
  assert.match(await page.getByRole('dialog').innerText(), /94%/)
  assert.match(await page.getByRole('dialog').innerText(), /ClinicalTrials.gov and PubMed/)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Explore Consumer / Marketplace', exact: true }).click()
  assert.match(await page.getByRole('dialog').innerText(), /150%/)
  assert.match(await page.getByRole('dialog').innerText(), /CAC/)
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => localStorage.getItem('acefire:projects:v1')), storage)
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 950 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}`)
  }
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  console.log('PASS covers, both scenario dialogs, brand, single Create Project, responsive layout; no API writes or project storage changes')
} finally { await browser.close() }
