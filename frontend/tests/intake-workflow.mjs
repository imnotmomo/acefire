import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'

const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 5297 } })
await server.listen()
const base = server.resolvedUrls.local[0]
let executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
  if (!executablePath && await fs.access(candidate).then(() => true, () => false)) executablePath = candidate
}
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true })
const results = [], unexpected = [], errors = [], contexts = []
const nativeBytes = Buffer.from('Native original fixture bytes.')
const source = { snapshot_id: 'document', file_name: 'original.docx', sha256: '0c0e1bb3efa90187e66cb5403d9b87a6d85a859d6ff962a157ef15dd1c8076a3', provider: 'uploaded', ingestion_channel: 'user_upload', data_role: 'supplemental_evidence', visibility: 'deal_private', preview_url: '/sources/document/file', locator: { paragraph: 4 } }
const col = number => { let name = ''; while (number > 0) { number--; name = String.fromCharCode(65 + number % 26) + name; number = Math.floor(number / 26) } return name }
const columnNumber = name => [...name].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0)
function workbook(params) {
  const cell = params.get('cell') || 'A1', match = /^([A-Z]+)(\d+)$/.exec(cell)
  const column_start = Number(params.get('column_start') || Math.max(1, columnNumber(match[1]) - 8)), row_start = Number(params.get('row_start') || Math.max(1, Number(match[2]) - 12))
  const columns = Array.from({ length: Math.min(16, 40 - column_start + 1) }, (_, i) => col(column_start + i))
  return { snapshot_id: 'finance', sha256: 'a'.repeat(64), sheet: params.get('sheet') || 'Finance', sheets: ['Finance', 'Other'], focus_cell: cell, row_start, column_start, max_row: 120, max_column: 40, columns,
    rows: Array.from({ length: Math.min(50, 120 - row_start + 1) }, (_, i) => ({ number: row_start + i, cells: columns.map(column => ({ address: `${column}${row_start + i}`, value: `${column}${row_start + i}` === 'AF49' ? '12345678901234567890.123456' : '', formula: null, selected: `${column}${row_start + i}` === cell })) })) }
}
async function workspace(view, routeApi) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); contexts.push(context)
  await context.route('**/api/**', async route => {
    if (await routeApi(route, new URL(route.request().url()))) return
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    await route.fulfill({ status: 501, json: { detail: 'No live API permitted in this regression fixture.' } })
  })
  const page = await context.newPage();
  if (Number(process.env.INTAKE_TEST_CPU_RATE || 1) > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.INTAKE_TEST_CPU_RATE) })
  page.setDefaultTimeout(10_000); page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.goto(`${base}tests/intake-workflow.html?view=${view}`, { waitUntil: 'networkidle' })
  if (errors.length) throw new Error(`Fixture browser error: ${errors.join('; ')}`)
  return page
}
async function check(name, callback) { console.log(`CHECK ${name}`); await callback(); results.push(name); console.log(`PASS ${name}`) }
try {
  let posts = [], receipts = [], polls = 0, retryFailed = false
  const upload = await workspace('uploads', async (route, url) => {
    if (url.pathname === '/api/deals/fixture-company/uploads' && route.request().method() === 'GET') { await route.fulfill({ json: { uploads: receipts } }); return true }
    if (url.pathname === '/api/deals/fixture-company/uploads' && route.request().method() === 'POST') {
      posts.push(route.request().postDataBuffer().toString('utf8'))
      const filename = /filename="([^"]+)"/.exec(posts.at(-1))?.[1]
      if (filename === 'retry.csv' && !retryFailed) { retryFailed = true; await route.fulfill({ status: 503, json: { detail: 'The upload service is temporarily unavailable.' } }); return true }
      const job = { id: `job-${posts.length}`, deal_id: 'fixture-company', snapshot_id: `source-${posts.length}`, filename, sha256: 'b'.repeat(64), created_at: '2026-10-26T12:00:00Z', status: 'queued', warnings: [] }
      receipts.push({ ...job, status: 'completed', observations: 1, claims: 0 }); await route.fulfill({ status: 202, json: job }); return true
    }
    if (/\/uploads\/job-\d+$/.test(url.pathname)) { polls++; await route.fulfill({ json: receipts.find(job => url.pathname.endsWith(job.id)) }); return true }
  })
  await check('Actual file chooser sends the selected original, completes durable polling and permits same-file reselection', async () => {
    const file = { name: 'finance.csv', mimeType: 'text/csv', buffer: Buffer.from('metric,value\nrevenue,123.45\n') }
    await upload.getByRole('button', { name: 'Upload files', exact: true }).waitFor()
    const [chooser] = await Promise.all([upload.waitForEvent('filechooser'), upload.getByRole('button', { name: 'Upload files', exact: true }).click()]); await chooser.setFiles(file)
    await upload.getByText('Evidence saved', { exact: false }).waitFor()
    assert.equal(posts.length, 1); assert.match(posts[0], /filename="finance.csv"/); assert.match(posts[0], /revenue,123.45/)
    assert.ok(polls > 0); assert.equal(await upload.getByLabel('Completed upload refreshes').innerText(), '1')
    await upload.getByLabel('Upload company source files', { exact: true }).setInputFiles(file)
    await upload.waitForFunction(() => document.querySelectorAll('.upload-job.completed').length === 2)
    assert.equal(posts.length, 2)
  })
  await check('Unsupported chooser files show an actionable error without sending a request', async () => {
    await upload.getByLabel('Upload company source files', { exact: true }).setInputFiles({ name: 'script.js', mimeType: 'text/javascript', buffer: Buffer.from('alert(1)') })
    await upload.getByRole('alert').filter({ hasText: 'script.js' }).waitFor(); assert.equal(posts.length, 2)
  })
  await check('Dismissed shared receipts stay hidden across refresh and can be restored without deleting evidence', async () => {
    await upload.getByRole('button', { name: 'Dismiss finance.csv processing history', exact: true }).first().click()
    const refreshed = upload.waitForResponse(response => new URL(response.url()).pathname === '/api/deals/fixture-company/uploads' && response.request().method() === 'GET')
    await upload.getByRole('button', { name: 'Refresh processing history', exact: true }).click()
    await refreshed
    await upload.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === 'Refresh processing history'); return button && !button.disabled })
    assert.equal(await upload.locator('.upload-job').count(), 1)
    await upload.reload({ waitUntil: 'networkidle' }); assert.equal(await upload.locator('.upload-job').count(), 1)
    await upload.getByRole('button', { name: 'Show dismissed receipts', exact: true }).click()
    await upload.waitForFunction(() => document.querySelectorAll('.upload-job').length === 2)
    assert.equal(receipts.length, 2); assert.equal(posts.length, 2)
  })
  await check('Failed uploads retry the same cached original after reload and finish through a new durable receipt', async () => {
    await upload.getByLabel('Upload company source files', { exact: true }).setInputFiles({ name: 'retry.csv', mimeType: 'text/csv', buffer: Buffer.from('metric,value\nrevenue,987.65\n') })
    await upload.locator('.upload-job.failed').filter({ hasText: 'retry.csv' }).waitFor()
    await upload.reload({ waitUntil: 'networkidle' }); await upload.locator('.upload-job.failed').filter({ hasText: 'retry.csv' }).getByRole('button', { name: 'Retry file', exact: true }).click()
    await upload.locator('.upload-job.completed').filter({ hasText: 'retry.csv' }).waitFor()
    assert.equal(posts.length, 4); assert.match(posts.at(-1), /filename="retry.csv"/); assert.match(posts.at(-1), /revenue,987.65/)
  })
  await check('Drag and drop preserves selected source attribution and original bytes for multiple files', async () => {
    await upload.getByLabel('Upload source attribution', { exact: true }).selectOption('pitchbook')
    const transfer = await upload.evaluateHandle(() => {
      const data = new DataTransfer()
      data.items.add(new File(['metric,value\nrevenue,321.1250\n'], 'dropped-one.csv', { type: 'text/csv' }))
      data.items.add(new File(['Synthetic second dropped source.'], 'dropped-two.txt', { type: 'text/plain' }))
      return data
    })
    await upload.locator('.company-upload-drop').dispatchEvent('drop', { dataTransfer: transfer })
    await upload.locator('.upload-job.completed').filter({ hasText: 'dropped-one.csv' }).waitFor()
    await upload.locator('.upload-job.completed').filter({ hasText: 'dropped-two.txt' }).waitFor()
    assert.equal(posts.length, 6)
    assert.ok(posts.slice(-2).every(body => /name="provider"\r\n\r\npitchbook/.test(body)))
    assert.match(posts.at(-2), /321.1250/)
    assert.match(posts.at(-1), /Synthetic second dropped source/)
    await transfer.dispose()
  })
  let previewRequests = [], previewAttempts = 0
  const sheet = await workspace('workbook', async (route, url) => {
    if (url.pathname === '/api/sources/finance/preview') {
      previewRequests.push(url.searchParams.toString()); previewAttempts++
      await route.fulfill(previewAttempts <= 2 ? { json: { rows: [null], columns: [] } } : { json: workbook(url.searchParams) }); return true
    }
  })
  await check('Malformed workbook previews recover through Retry preview without crashing', async () => {
    await sheet.getByRole('button', { name: 'Retry preview', exact: true }).click(); await sheet.locator('[data-cell="A1"]').waitFor()
  })
  await check('Workbook columns, row pages, source-cell jump and worksheet changes are reachable', async () => {
    await sheet.getByRole('button', { name: 'Next columns', exact: true }).click(); await sheet.locator('[data-cell="Q1"]').waitFor()
    await sheet.getByRole('button', { name: 'Next rows', exact: true }).click(); await sheet.locator('[data-cell="Q51"]').waitFor()
    await sheet.getByLabel('Go to source cell', { exact: true }).fill('AF49'); await sheet.getByRole('button', { name: 'Go', exact: true }).click()
    await sheet.locator('[data-cell="AF49"].cited-cell').waitFor(); assert.equal(await sheet.locator('[data-cell="AF49"]').innerText(), '12345678901234567890.123456')
    const before = previewRequests.length; await sheet.getByLabel('Go to source cell', { exact: true }).fill('XFE1'); await sheet.getByRole('button', { name: 'Go', exact: true }).click()
    await sheet.getByRole('alert').filter({ hasText: 'Enter an Excel cell' }).waitFor(); assert.equal(previewRequests.length, before)
    await sheet.getByLabel('Source worksheet').selectOption('Other'); await sheet.locator('[data-cell="A1"]').waitFor()
    assert.match(previewRequests.at(-1), /sheet=Other/)
  })
  let downloads = 0
  const native = await workspace('native', async (route, url) => {
    if (url.pathname === '/api/sources/document/file') { downloads++; await route.fulfill({ body: nativeBytes, headers: { 'Content-Type': 'application/octet-stream' } }); return true }
  })
  await check('Native originals have a working download control without an unnecessary preview fetch', async () => {
    await native.getByRole('button', { name: 'Download original', exact: true }).waitFor()
    await native.getByText(/This file opens in its native application/).waitFor()
    assert.match(await native.locator('.source-preview').innerText(), /native application/)
    assert.equal(downloads, 0)
    const [download] = await Promise.all([native.waitForEvent('download'), native.getByRole('button', { name: 'Download original', exact: true }).click()])
    assert.equal(download.suggestedFilename(), 'original.docx'); assert.deepEqual(await fs.readFile(await download.path()), nativeBytes); assert.equal(downloads, 1)
  })
  const readingRequests = []
  const readingRoom = await workspace('reading-views', async (route, url) => {
    if (url.pathname === '/api/deals/fixture-company/uploads') { await route.fulfill({ json: { uploads: [] } }); return true }
    const preview = /^\/api\/sources\/([^/]+)\/pdf-preview$/.exec(url.pathname)
    if (preview) {
      readingRequests.push(preview[1])
      const rendered = await readingRoom.evaluate(id => { const source = window.readingFixture.report.source_files.find(item => item.snapshot_id === id); const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1; canvas.getContext('2d').fillRect(0, 0, 1, 1); return { snapshot_id: id, sha256: source.sha256, page: 1, page_count: 1, width: 1, height: 1, png_base64: canvas.toDataURL('image/png').split(',')[1] } }, preview[1])
      await route.fulfill({ json: rendered }); return true
    }
    const match = /^\/api\/sources\/([^/]+)\/file$/.exec(url.pathname)
    if (match) { const originals = await readingRoom.evaluate(() => window.readingFixture.originals); readingRequests.push(match[1]); await route.fulfill({ body: originals[match[1]], headers: { 'Content-Type': match[1].endsWith('-reading') ? 'application/pdf' : 'application/octet-stream' } }); return true }
  })
  await check('Native Office and OCR originals expose company-bound reading evidence and distinct reading-copy labels', async () => {
    for (const filename of ['overview.docx', 'overview.pptx', 'overview.png']) {
      const row = readingRoom.getByRole('row').filter({ has: readingRoom.getByText(filename, { exact: true }) })
      assert.match(await row.innerText(), /Reading view evidence/); assert.match(await row.innerText(), /Verify/)
      assert.equal(await row.getByRole('button', { name: `Open reading view of ${filename}`, exact: true }).count(), 1)
      assert.equal(await readingRoom.getByText(`Reading view of ${filename}`, { exact: true }).count(), 1)
    }
    assert.equal(await readingRoom.getByRole('button', { name: 'Open reading view of overview.docx', exact: true }).count(), 1, 'The changed-hash context must not create a second native reading link.')
    await readingRoom.getByLabel('Search sources', { exact: true }).fill('overview.pptx'); assert.equal(await readingRoom.locator('.backend-source-table tbody tr').count(), 2)
    await readingRoom.getByLabel('Search sources', { exact: true }).fill('')
    const output = path.resolve('test-results/intake-workflow'); await fs.mkdir(output, { recursive: true })
    await readingRoom.screenshot({ path: path.join(output, 'data-room-reading-views.png'), fullPage: true, animations: 'disabled' })
  })
  await check('Open reading view selects the registered PDF while original Open and Download preserve native bytes and hashes', async () => {
    const row = readingRoom.getByRole('row').filter({ has: readingRoom.getByText('overview.docx', { exact: true }) })
    await row.getByRole('button', { name: 'Open reading view of overview.docx', exact: true }).click()
    const view = readingRoom.getByRole('dialog', { name: 'Reading view', exact: true }); await view.getByRole('img', { name: /Original PDF page 1 of/ }).waitFor()
    await view.getByRole('img', { name: /Original PDF page 1 of/ }).evaluate(image => image.decode())
    assert.match(await view.innerText(), /Reading view of overview.docx/); assert.match(await view.innerText(), /untouched original/); assert.equal(readingRequests.at(-1), 'native-reading')
    await readingRoom.keyboard.press('Escape'); await row.getByRole('button', { name: 'Open file', exact: true }).click()
    const original = readingRoom.getByRole('dialog', { name: 'Original source file', exact: true }); await original.getByText(/This file opens in its native application/).waitFor(); assert.match(await original.innerText(), /native application/); assert.match(await original.innerText(), /overview.docx/)
    await readingRoom.keyboard.press('Escape')
    const [download] = await Promise.all([readingRoom.waitForEvent('download'), row.getByRole('button', { name: 'Download original', exact: true }).click()])
    assert.equal(download.suggestedFilename(), 'overview.docx'); assert.equal(await fs.readFile(await download.path(), 'utf8'), 'Native original fixture bytes.'); assert.equal(readingRequests.at(-1), 'native')
  })
  let sourceCalls = 0
  const chat = await workspace('chat', async (route, url) => {
    if (url.pathname === '/api/deals/fixture-company/evidence-chat') {
      sourceCalls++
      if (sourceCalls === 1) { await route.fulfill({ status: 503, json: { detail: 'Fixture provider is temporarily unavailable.' } }); return true }
      await route.fulfill({ json: { status: 'answered', answer: 'The document reports payment services. [1]', statements: [{ text: 'The document reports payment services.', source_ids: ['record'] }], sources: [{ id: 'record', label: 1, kind: 'raw', excerpt: 'We provide payment services.', source: { ...source, preview_url: 'https://storage.example.test/file?token=temporary-private' } }], gaps: [], coverage: { registered_sources: 2, indexed_chunks: 1, retrieved_chunks: 1, source_gaps: [] } } }); return true
    }
  })
  await check('Unsent questions survive switching both chat modes and closing the drawer', async () => {
    await chat.getByRole('button', { name: 'Open company chat', exact: true }).click(); await chat.getByRole('textbox', { name: 'Ask about this company', exact: true }).fill('Unsent company question')
    await chat.getByRole('button', { name: 'Search source files', exact: true }).click(); await chat.getByRole('textbox', { name: 'Search company source files', exact: true }).fill('Unsent source question')
    await chat.getByRole('button', { name: 'Back to company chat', exact: true }).click(); assert.equal(await chat.getByRole('textbox', { name: 'Ask about this company', exact: true }).inputValue(), 'Unsent company question')
    await chat.getByRole('button', { name: 'Close Company chat', exact: true }).click(); await chat.getByRole('button', { name: 'Open source search', exact: true }).click()
    assert.equal(await chat.getByRole('textbox', { name: 'Search company source files', exact: true }).inputValue(), 'Unsent source question')
  })
  await check('Unavailable source chat preserves its question across reopening and retries without duplicating user turns', async () => {
    await chat.getByRole('button', { name: 'Send source question', exact: true }).click(); await chat.getByRole('alert').filter({ hasText: 'model is unavailable' }).waitFor()
    assert.equal(await chat.locator('.company-chat-message.assistant').count(), 0)
    await chat.getByRole('button', { name: 'Close Search source files', exact: true }).click(); await chat.getByRole('button', { name: 'Open source search', exact: true }).click()
    await chat.getByRole('button', { name: 'Retry question', exact: true }).click(); await chat.locator('.company-chat-message.assistant').waitFor()
    assert.equal(await chat.locator('.company-chat-message.user').count(), 1); assert.equal(sourceCalls, 2)
  })
  await check('Validated source answers and citations survive StrictMode close/reopen and refresh without caching file grants', async () => {
    await chat.getByRole('button', { name: 'Close Search source files', exact: true }).click(); await chat.getByRole('button', { name: 'Open source search', exact: true }).click()
    assert.equal(await chat.locator('.company-chat-message.assistant').count(), 1); assert.equal(sourceCalls, 2)
    await chat.reload({ waitUntil: 'networkidle' }); await chat.getByRole('button', { name: 'Open source search', exact: true }).click()
    await chat.locator('.company-chat-message.assistant').waitFor(); await chat.locator('.document-chat-sources summary').click()
    assert.match(await chat.locator('.document-chat-sources').innerText(), /We provide payment services/)
    const stored = await chat.evaluate(() => Object.keys(sessionStorage).map(key => sessionStorage.getItem(key)).join(' '))
    assert.equal(stored.includes('temporary-private'), false); assert.equal(stored.includes('preview_url'), false)
    assert.equal(sourceCalls, 2)
  })
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, [])
  const output = path.resolve('test-results/intake-workflow'); await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: results, cpuRate: Number(process.env.INTAKE_TEST_CPU_RATE || 1), real_browser: true, mocked_api: true, live_model_calls: 0, unexpected_api: unexpected, browser_errors: errors }, null, 2))
} finally {
  await Promise.all(contexts.map(context => context.close())); await browser.close(); await server.close()
}
