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
  await page.locator('.project-card').first().waitFor()
  assert.equal(await page.locator('.project-card').count(), 3)
  assert.equal(await page.locator('.ui-demo-showcase').count(), 0)
  assert.equal(await page.getByText('Numbers. Claims. Narrative.', { exact: true }).count(), 0)
  assert.equal(await page.locator('.project-card a[href="#/project/enfuce-documents/dashboard"]').count(), 0)
  assert.deepEqual(await page.locator('.project-cover-image').evaluateAll(images => images.map(image => image.getAttribute('src'))), ['/images/projects/narrative.jpg', '/images/projects/claims.jpg', '/images/projects/numbers.jpg'])
  await page.locator('.project-cover-image').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  assert.equal(await page.locator('.nav-count').innerText(), '3')
  assert.equal(await page.getByRole('button', { name: 'Create Project', exact: true }).count(), 1)
  assert.equal(await page.locator('.brand .ingenium-logo').count(), 1)
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem('acefire:projects:v1')).some(project => project.id === 'enfuce-documents')))
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 950 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}`)
  }
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  console.log('PASS three requested project cards and covers, removed showcase, correct counts, retained stored project, responsive layout; no API writes')
} finally { await browser.close() }
