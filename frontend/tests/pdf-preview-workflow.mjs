import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { waitForFixtureGate } from './workflowGuards.mjs'

const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 5311, strictPort: true } })
await server.listen()
const base = server.resolvedUrls.local[0]
let executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe']) if (!executablePath && await fs.access(candidate).then(() => true, () => false)) executablePath = candidate
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
const page = await context.newPage(); page.setDefaultTimeout(10_000)
const output = path.resolve('test-results/pdf-preview-workflow'); await fs.mkdir(output, { recursive: true })
const errors = [], unexpected = [], requests = [], results = []
let mode = 'okay', fileMode = 'okay', release = null, waitingGate = null, delayedResponseCompleted = false
page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
await context.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url())
  requests.push({ method: request.method(), path: url.pathname, query: url.search, auth: request.headers().authorization ?? null })
  if (request.method() !== 'GET' || request.headers().authorization !== 'Bearer fixture-pdf-access-token') { unexpected.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 405, json: { detail: 'Only scoped authenticated fixture reads are permitted.' } }); return }
  const match = /^\/api\/sources\/(pdf-source-[ab])\/(pdf-preview|file)$/.exec(url.pathname)
  if (!match) { unexpected.push(url.pathname); await route.fulfill({ status: 501, json: { detail: 'No live API permitted.' } }); return }
  if (match[2] === 'file') {
    const original = await page.evaluate(() => window.pdfPreviewFixture.original)
    await route.fulfill({ body: Buffer.from(fileMode === 'tamper' ? 'Altered original.' : original), headers: { 'Content-Type': 'application/pdf' } }); return
  }
  const id = match[1], number = Number(url.searchParams.get('page')), requestedMode = mode
  if (requestedMode === 'delay') { delayedResponseCompleted = false; await new Promise(resolve => { release = resolve }) }
  if (requestedMode === 'unavailable') { await route.fulfill({ status: 503, json: { detail: 'Synthetic PDF renderer temporarily unavailable.' } }); return }
  if (requestedMode === 'html') { await route.fulfill({ status: 502, body: '<html>Preview proxy unavailable</html>', headers: { 'Content-Type': 'text/html' } }); return }
  const image = await page.evaluate(({ number, id }) => window.pdfPreviewFixture.png(number, id), { number, id })
  const sha = await page.evaluate(() => window.pdfPreviewFixture.sha256)
  const value = { snapshot_id: id, sha256: sha, page: number, page_count: 3, ...image }
  if (requestedMode === 'wrong-source') value.snapshot_id = 'other-source'
  if (requestedMode === 'wrong-sha') value.sha256 = 'b'.repeat(64)
  if (requestedMode === 'wrong-page') value.page = number + 1
  if (requestedMode === 'wrong-count') value.page_count = number - 1
  if (requestedMode === 'huge-width') value.width = 1601
  if (requestedMode === 'huge-height') value.height = 8193
  if (requestedMode === 'huge-pixels') { value.width = 1600; value.height = 3000 }
  if (requestedMode === 'dimension-mismatch') value.width--
  if (requestedMode === 'oversized-base64') value.png_base64 = 'A'.repeat(11_184_816)
  if (requestedMode === 'bad-base64') value.png_base64 = '<svg onload=alert(1)>'
  if (requestedMode === 'bad-signature') value.png_base64 = Buffer.from('This is not a PNG image, despite the MIME type.').toString('base64')
  if (requestedMode === 'truncated-png') value.png_base64 = Buffer.from(value.png_base64, 'base64').subarray(0, 24).toString('base64')
  await route.fulfill({ json: value }).catch(() => {})
  if (requestedMode === 'delay') delayedResponseCompleted = true
})
const image = () => page.getByRole('img', { name: /^Original PDF page/ })
const count = () => requests.filter(request => request.path.endsWith('/pdf-preview')).length
async function shown(number, id = 'pdf-source-a') {
  await page.getByRole('img', { name: `Original PDF page ${number} of 3: ${id}.pdf`, exact: true }).waitFor()
  await page.waitForFunction(() => { const image = document.querySelector('.source-pdf-scroll img'); return image?.complete && image.naturalWidth > 0 })
  assert.equal(await image().evaluate(element => element.naturalWidth), 1280)
}
async function go(number) { await page.getByRole('textbox', { name: 'PDF page number', exact: true }).fill(String(number)); await page.getByRole('button', { name: 'Go to page', exact: true }).click() }
async function check(name, callback) { console.log(`CHECK ${name}`); await callback(); results.push(name); console.log(`PASS ${name}`) }
try {
  await page.goto(`${base}tests/pdf-preview-workflow.html`, { waitUntil: 'networkidle' })
  await check('the numeric source locator opens page2 as a decoded readable PNG without an iframe plug-in', async () => {
    await shown(2)
    assert.ok(requests.every(request => request.query === '?page=2'))
    assert.equal(await page.locator('iframe,embed,object').count(), 0)
    assert.match(await page.locator('.source-pdf-basis').innerText(), /Page 2 of 3.*hash-checked original/)
    assert.equal(await page.getByRole('textbox', { name: 'PDF page number', exact: true }).inputValue(), '2')
    await page.screenshot({ path: path.join(output, 'desktop-readable-source-page.png'), fullPage: true })
  })
  await check('previous, next and page jumps load the selected page and enforce document bounds', async () => {
    await page.getByRole('button', { name: 'Previous page', exact: true }).click(); await shown(1)
    assert.equal(await page.getByRole('button', { name: 'Previous page', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Next page', exact: true }).click(); await shown(2)
    await go(3); await shown(3)
    assert.equal(await page.getByRole('button', { name: 'Next page', exact: true }).isDisabled(), true)
    await go(1); await shown(1)
  })
  await check('invalid page entries explain valid bounds without a request or source change', async () => {
    const before = count()
    for (const value of ['0', '-1', '4', '1.5', 'abc', '9007199254740993']) {
      await go(value); await page.getByRole('alert').filter({ hasText: 'Enter a page from 1 to 3' }).waitFor()
      assert.equal(count(), before); await shown(1)
    }
    await go(2); await shown(2)
  })
  await check('zoom changes rendered page width locally without fetching another page', async () => {
    const before = count()
    for (const value of ['75', '100', '125', '150', '200', '300', '400']) {
      await page.getByRole('combobox', { name: 'PDF page zoom', exact: true }).selectOption(value)
      assert.equal(await image().evaluate(element => element.style.width), `${value}%`)
    }
    assert.equal(count(), before)
    await page.getByRole('combobox', { name: 'PDF page zoom', exact: true }).selectOption('100')
  })
  await check('wrong source/hash/page/count and unsafe dimensions are rejected with working retry', async () => {
    for (mode of ['wrong-source', 'wrong-sha', 'wrong-page', 'wrong-count', 'huge-width', 'huge-height', 'huge-pixels', 'dimension-mismatch', 'oversized-base64', 'bad-base64', 'bad-signature']) {
      await go(2)
      await page.getByRole('button', { name: 'Retry PDF preview', exact: true }).waitFor()
      assert.equal(await image().count(), 0)
      const failedMode = mode; mode = 'okay'
      await page.getByRole('button', { name: 'Retry PDF preview', exact: true }).click(); await shown(2)
      assert.ok(count() > 0, failedMode)
    }
  })
  await check('a PNG with a valid signature and IHDR but missing image data fails decoding visibly and can retry', async () => {
    mode = 'truncated-png'; await go(2)
    await page.getByRole('alert').filter({ hasText: 'could not be decoded' }).waitFor()
    assert.equal(await image().count(), 0)
    mode = 'okay'; await page.getByRole('button', { name: 'Retry PDF preview', exact: true }).click(); await shown(2)
  })
  await check('renderer and proxy errors preserve original download and recover through Retry or first page', async () => {
    for (mode of ['unavailable', 'html']) {
      await go(2); await page.getByRole('button', { name: 'Retry PDF preview', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Download original', exact: true }).isEnabled(), true)
      mode = 'okay'; await page.getByRole('button', { name: 'Go to first page', exact: true }).click(); await shown(1)
      await go(2); await shown(2)
    }
  })
  await check('original PDF download retains exact bytes and a changed file is blocked by the source hash', async () => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download original', exact: true }).click()
    const download = await pending, filename = path.join(output, download.suggestedFilename()); await download.saveAs(filename)
    const original = await page.evaluate(() => window.pdfPreviewFixture.original)
    assert.deepEqual(await fs.readFile(filename), Buffer.from(original))
    fileMode = 'tamper'; await page.getByRole('button', { name: 'Download original', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'does not match the version cited' }).waitFor()
    fileMode = 'okay'
    const retry = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download original', exact: true }).click()
    await retry
    assert.equal(await page.getByRole('alert').filter({ hasText: 'does not match the version cited' }).count(), 0)
  })
  await check('mobile navigation, zoom and original source text remain reachable without document overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await go(3); await shown(3)
    const before = count()
    await page.getByRole('combobox', { name: 'PDF page zoom', exact: true }).selectOption('400')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    assert.equal(await page.locator('.source-pdf-scroll').evaluate(element => element.scrollWidth > element.clientWidth), true)
    assert.ok(await image().evaluate(element => element.getBoundingClientRect().width / element.naturalWidth >= 0.95), '400% shows the source near native raster size for readable text')
    await page.locator('.source-pdf-scroll').evaluate(element => { element.scrollTop = 250; element.scrollLeft = 0 })
    await page.locator('.source-pdf-scroll').screenshot({ path: path.join(output, 'mobile-400-source-left.png') })
    const leftEdge = await image().evaluate(element => element.getBoundingClientRect().left)
    await page.locator('.source-pdf-scroll').evaluate(element => { element.scrollLeft = 340 })
    assert.ok(await page.locator('.source-pdf-scroll').evaluate(element => element.scrollLeft > 0))
    assert.ok(await image().evaluate(element => element.getBoundingClientRect().left) < leftEdge - 300, 'panning moves the image rather than the document')
    await page.locator('.source-pdf-scroll').screenshot({ path: path.join(output, 'mobile-400-source-right.png') })
    assert.equal(count(), before, 'zooming and panning do not send another PDF request')
    await page.getByRole('combobox', { name: 'PDF page zoom', exact: true }).selectOption('100')
    await page.screenshot({ path: path.join(output, 'mobile-readable-source-page.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1100 })
  })
  await check('a stalled renderer reaches its actual client deadline and Retry remains usable', async () => {
    await page.clock.install()
    mode = 'delay'; await go(2)
    waitingGate = 'stalled PDF renderer request'; await waitForFixtureGate(waitingGate, () => release); waitingGate = null
    await page.clock.fastForward(20_001)
    await page.getByRole('alert').filter({ hasText: 'PDF page took too long to render' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Retry PDF preview', exact: true }).isEnabled(), true)
    mode = 'okay'; release(); release = null
    waitingGate = 'timed-out PDF response cleanup'; await waitForFixtureGate(waitingGate, () => delayedResponseCompleted); waitingGate = null
    await page.clock.resume()
    await page.getByRole('button', { name: 'Retry PDF preview', exact: true }).click(); await shown(2)
  })
  await check('a new source and changed citation reset the page while a late old response stays aborted', async () => {
    await go(1); await shown(1)
    mode = 'delay'; await page.getByRole('button', { name: 'Next page', exact: true }).click()
    waitingGate = 'delayed old PDF source page'; await waitForFixtureGate(waitingGate, () => release); waitingGate = null
    mode = 'okay'; await page.evaluate(() => window.pdfPreviewFixture.showSource('pdf-source-b', 1)); await shown(1, 'pdf-source-b')
    const fresh = await image().getAttribute('src')
    release(); release = null
    waitingGate = 'aborted old PDF response handler completion'; await waitForFixtureGate(waitingGate, () => delayedResponseCompleted); waitingGate = null
    assert.equal(await image().getAttribute('src'), fresh)
    await page.evaluate(() => window.pdfPreviewFixture.showSource('pdf-source-b', 3)); await shown(3, 'pdf-source-b')
  })
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: results, simulation: 'Read-only intercepted PNG rendering and real synthetic original PDF bytes; no backend/model calls.', requests, errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  const state = await page.evaluate(() => ({ alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent), page: document.querySelector('[aria-label="PDF page number"]')?.value, images: [...document.querySelectorAll('.source-pdf-scroll img')].map(image => ({ alt: image.alt, complete: image.complete, width: image.naturalWidth })) })).catch(reason => ({ error: String(reason) }))
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ passed: results, message: String(error), mode, waiting_gate: waitingGate, state, requests, errors, unexpected }, null, 2)); throw error
} finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); if (release) release(); await context.close(); await browser.close(); await server.close() }
