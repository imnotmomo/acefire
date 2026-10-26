import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

let executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe']) {
  if (!executablePath && await fs.access(candidate).then(() => true, () => false)) executablePath = candidate
}
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true })
const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5173'
await fs.mkdir('test-results/landing-chat', { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()) })
  await page.goto(base, { waitUntil: 'networkidle' })
  const sample = page.getByRole('region', { name: 'Ingenium chat demo' })
  await sample.getByRole('button', { name: 'Replay demo' }).click()
  await page.waitForTimeout(900)
  const partial = await page.locator('.ig-chat-question p').innerText()
  assert.ok(partial.length > 0 && partial.length < 48)
  await sample.getByRole('button', { name: 'Pause demo' }).click()
  const frozen = await page.locator('.ig-chat-question p').innerText()
  await page.waitForTimeout(400)
  assert.equal(await page.locator('.ig-chat-question p').innerText(), frozen)
  await sample.getByRole('button', { name: 'Resume demo' }).click()
  assert.equal(await sample.locator('.ig-chat-source').getAttribute('aria-disabled'), null, 'Source navigation stays available while the sample types.')
  await sample.getByRole('status').filter({ hasText: '€3,452,682.81' }).waitFor({ timeout: 15000 })
  assert.match(await sample.getByRole('status').innerText(), /€3,452,682.81/)
  await page.screenshot({ path: 'test-results/landing-chat/desktop.png' })
  await sample.getByRole('button', { name: 'Challenge a claim' }).click()
  await page.waitForTimeout(200)
  await sample.getByRole('button', { name: 'Build a report' }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await sample.getByRole('status').filter({ hasText: 'Open Report Builder' }).waitFor()
  assert.match(await sample.getByRole('status').innerText(), /Open Report Builder/)
  assert.equal(await sample.getByRole('button', { name: 'Pause demo' }).count(), 0)
  assert.equal(await sample.getByRole('link', { name: 'Open Report Builder', exact: true }).getAttribute('href'), '#/project/enfuce/report/build')
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`)
    const hero = await page.locator('.ig-hero-copy').boundingBox()
    const chat = await sample.boundingBox()
    assert.ok(width <= 760 ? chat.y >= hero.y + hero.height : chat.x >= hero.x + hero.width, `overlap at ${width}`)
  }
  await page.screenshot({ path: 'test-results/landing-chat/mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [], 'Scripted sample must not call backend APIs')
  console.log('PASS typing, pause/resume, completion, rapid switching, reduced motion, links, desktop/tablet/mobile layout; no API requests or runtime errors')
} finally { await browser.close() }
