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
  await sample.getByRole('status').filter({ hasText: 'actual performance' }).waitFor({ timeout: 30000 })
  assert.match(await page.locator('.ig-chat-question p').innerText(), /ARR is backed by contracts/)
  assert.match(await sample.locator('.ig-chat-header').innerText(), /Company chat · Dashboard/)
  assert.match(await sample.getByRole('status').innerText(), /not contracted revenue/)
  assert.equal(await sample.getByRole('link', { name: 'Explore the dashboard', exact: true }).getAttribute('href'), '#/project/enfuce-documents/dashboard')
  assert.equal(await sample.locator('.ig-chat-source strong').innerText(), 'ARR forecast evidence')
  assert.match(await sample.locator('.ig-chat-source small').innerText(), /Enfuce Summary - April 2020.pdf.*p.30/)
  assert.deepEqual(await sample.locator('.ig-chat-prompts button').allTextContents(), ['Trace a number', 'Challenge a claim', 'Build a report'])
  await page.screenshot({ path: 'test-results/landing-chat/desktop.png' })
  await sample.getByRole('button', { name: 'Build a report', exact: true }).click()
  await page.waitForTimeout(200)
  await sample.getByRole('button', { name: 'Challenge a claim', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await sample.getByRole('status').filter({ hasText: 'AIS/PIS licence' }).waitFor()
  assert.match(await sample.locator('.ig-chat-header').innerText(), /Source search · Data room/)
  assert.match(await sample.getByRole('status').innerText(), /This is a company claim/)
  assert.match(await sample.locator('.ig-chat-source').innerText(), /p.22/)
  assert.equal(await sample.locator('.ig-chat-source strong').innerText(), 'AIS/PIS licence statement')
  assert.equal(await sample.getByRole('link', { name: 'Explore the data room', exact: true }).getAttribute('href'), '#/project/enfuce-documents/data-room')
  await sample.getByRole('button', { name: 'Build a report', exact: true }).click()
  await sample.getByRole('status').filter({ hasText: 'open diligence requests' }).waitFor()
  assert.match(await sample.locator('.ig-chat-header').innerText(), /Company chat · Report/)
  assert.match(await sample.locator('.ig-chat-source').innerText(), /pp.4, 16, 22/)
  assert.equal(await sample.locator('.ig-chat-source strong').innerText(), 'Explore the report workflow')
  assert.match(await sample.locator('.ig-chat-source small').innerText(), /Build → Review → Export/)
  assert.equal(await sample.getByRole('link', { name: 'Open Report Builder', exact: true }).getAttribute('href'), '#/project/enfuce-documents/report/build')
  assert.equal(await sample.getByRole('button', { name: 'Pause demo' }).count(), 0)
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
