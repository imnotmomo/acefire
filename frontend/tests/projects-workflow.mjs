import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'

// The real application, real browser interactions, and only local API fixtures.
const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 5301 } })
await server.listen()
const base = server.resolvedUrls.local[0]
let executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (!executablePath && await fs.access(candidate).then(() => true, () => false)) executablePath = candidate
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true })
const contexts = [], results = [], errors = [], unexpected = [], mutations = []
const output = path.resolve('test-results/projects-workflow'); await fs.mkdir(output, { recursive: true })
let unavailableList = false, failCreation = true, failSettings = true
const companies = [
  { deal_id: 'circle-2025-ipo', entity_key: 'circle', legal_name: 'Circle', domain: 'circle.com', country: 'USA', identifiers: { workspace_display_name: 'Circle', workspace_sector: 'Fintech', workspace_geography: 'United States' } },
  { deal_id: 'enfuce-2020', entity_key: 'enfuce', legal_name: 'Enfuce', domain: 'enfuce.com', country: 'Finland', identifiers: { workspace_display_name: 'Enfuce company', workspace_sector: 'Fintech', workspace_geography: 'Finland' } },
]
const jobs = dealId => [{ id: `job-${dealId}`, deal_id: dealId, snapshot_id: `source-${dealId}`, filename: dealId === 'circle-2025-ipo' ? 'circle-processing.pdf' : 'enfuce-failed.pdf', sha256: 'a'.repeat(64), created_at: '2026-10-26T12:00:00Z', status: dealId === 'circle-2025-ipo' ? 'processing' : 'failed', warnings: [], error: dealId === 'circle-2025-ipo' ? undefined : 'Fixture extraction failed.' }]
function report(dealId) {
  const company = companies.find(item => item.deal_id === dealId)
  return { report_id: `report-${dealId}`, report_version: '1', generated_at_utc: '2026-10-26T12:00:00Z', company: { ...company, primary_provider: 'akta', historical_cutoff: null },
    primary_profile: { available: false, provider: 'akta', records: [], field_lineage: { fields: [], sources: [], nodes: [], edges: [] } }, reported_metrics: [], calculations: [], comparisons: [], source_files: [], coverage: [], summary: {}, gaps: dealId === 'circle-2025-ipo' ? [{ message: 'Circle source period is missing.', code: 'fixture_gap' }] : [],
    data_period_coverage: [], source_graph: { nodes: [], edges: [] }, conflict_numbers: dealId === 'circle-2025-ipo', conflicts: [], flags: [], document_claims: [] }
}
async function workspace(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, ...options }); contexts.push(context)
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    if (url.pathname === '/api/deals' && method === 'GET') { await route.fulfill(unavailableList ? { status: 503, json: { detail: 'Fixture company service unavailable.' } } : { json: { companies: structuredClone(companies) } }); return }
    if (url.pathname === '/api/deals' && method === 'POST') {
      const body = request.postDataJSON(); mutations.push({ method, path: url.pathname, body })
      if (failCreation) { failCreation = false; await route.fulfill({ status: 503, json: { detail: 'Fixture creation service unavailable.' } }); return }
      const company = { deal_id: body.deal_id, entity_key: body.deal_id, legal_name: body.name, domain: '', country: body.geography, created_at: '2026-10-26T12:00:00Z', identifiers: { workspace_display_name: body.name, workspace_sector: body.sector, workspace_geography: body.geography } }
      companies.push(company); await route.fulfill({ status: 201, json: { company } }); return
    }
    const match = /^\/api\/deals\/([^/]+)(.*)$/.exec(url.pathname)
    if (match) {
      const dealId = decodeURIComponent(match[1]), suffix = match[2], company = companies.find(item => item.deal_id === dealId)
      if (!company) { await route.fulfill({ status: 404, json: { detail: 'Fixture company is not registered.' } }); return }
      if (method === 'PATCH' && suffix === '') {
        const body = request.postDataJSON(); mutations.push({ method, path: url.pathname, body })
        if (failSettings) { failSettings = false; await route.fulfill({ status: 502, json: { detail: 'Fixture workspace update failed.' } }); return }
        for (const [key, value] of Object.entries(body)) company.identifiers[`workspace_${key}`] = String(value)
        await route.fulfill({ json: { company } }); return
      }
      if (method === 'GET' && suffix === '/report') { await route.fulfill({ json: report(dealId) }); return }
      if (method === 'GET' && suffix === '/uploads') { await route.fulfill({ json: { uploads: ['circle-2025-ipo', 'enfuce-2020'].includes(dealId) ? jobs(dealId) : [] } }); return }
      if (method === 'GET' && suffix.startsWith('/uploads/')) { await route.fulfill({ json: jobs(dealId)[0] }); return }
      if (method === 'GET' && suffix === '/report-drafts') { await route.fulfill({ json: { drafts: [] } }); return }
    }
    if (method === 'GET' && url.pathname === '/api/calculation-runtime') { await route.fulfill({ json: { mode: 'llm_local', configured: false, model: 'UI-fixture', executor: 'local_python', generation_provider: 'fixture', missing: ['Offline fixture'], maximum_inputs: 100 } }); return }
    unexpected.push(`${method} ${url.pathname}`); await route.fulfill({ status: 501, json: { detail: 'No live API permitted in project regression fixtures.' } })
  })
  const page = await context.newPage(); page.setDefaultTimeout(10_000); page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.goto(`${base}#/projects`, { waitUntil: 'networkidle' })
  return page
}
const collection = (page, value) => page.getByRole('combobox', { name: 'Project collection', exact: true }).selectOption(value)
async function projects(page) { await page.evaluate(() => { location.hash = '/projects' }); await page.getByRole('combobox', { name: 'Project collection', exact: true }).waitFor() }
async function check(name, callback) { console.log(`CHECK ${name}`); await callback(); results.push(name); console.log(`PASS ${name}`) }
try {
  const page = await workspace()
  await check('Live Enfuce is discovered with its own company identity while the historical example stays separate', async () => {
    await page.getByRole('link', { name: 'Open Enfuce company dashboard', exact: true }).waitFor()
    assert.equal(await page.getByRole('link', { name: 'Open Enfuce company dashboard', exact: true }).getAttribute('href'), '#/project/enfuce-documents/dashboard')
    assert.equal(await page.locator('.project-card').count(), 2)
    await collection(page, 'examples'); assert.equal(await page.locator('.project-card').count(), 1)
    assert.equal(await page.getByRole('link', { name: 'Open Enfuce dashboard', exact: true }).getAttribute('href'), '#/project/enfuce/dashboard')
    assert.match(await page.locator('.project-card').innerText(), /Historical snapshot/); await collection(page, 'active')
  })
  await check('Search, sector filtering and list/grid switches operate on the current project collection', async () => {
    await page.getByRole('textbox', { name: 'Search projects', exact: true }).fill('Finland'); assert.equal(await page.locator('.project-card').count(), 1)
    assert.match(await page.locator('.project-card').innerText(), /Enfuce company/)
    await page.getByRole('textbox', { name: 'Search projects', exact: true }).fill('unmatched'); await page.getByText('No projects match', { exact: true }).waitFor()
    await page.getByRole('textbox', { name: 'Search projects', exact: true }).fill(''); await page.getByRole('combobox', { name: 'Filter projects by sector', exact: true }).selectOption('Fintech')
    assert.equal(await page.locator('.project-card').count(), 2)
    await page.getByRole('button', { name: 'Switch to list view', exact: true }).click(); assert.equal(await page.locator('.project-cards.list').count(), 1)
    await page.getByRole('button', { name: 'Switch to grid view', exact: true }).click(); assert.equal(await page.locator('.project-cards.list').count(), 0)
  })
  await check('Company discovery errors preserve the browser example and recover through Retry company list', async () => {
    unavailableList = true; const offline = await workspace(); await offline.getByRole('alert').filter({ hasText: 'Company list unavailable' }).waitFor()
    await collection(offline, 'examples'); await offline.getByRole('link', { name: 'Open Enfuce dashboard', exact: true }).waitFor()
    unavailableList = false; await offline.getByRole('button', { name: 'Retry company list', exact: true }).click(); await collection(offline, 'active')
    await offline.getByRole('link', { name: 'Open Enfuce company dashboard', exact: true }).waitFor()
  })
  let createdId
  await check('Company creation validates input, preserves a failed form, retries its stable ID and survives reload', async () => {
    await page.getByRole('button', { name: 'Create Project', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create a project', exact: true })
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click(); await dialog.getByRole('alert').filter({ hasText: 'Enter a project name' }).waitFor()
    assert.equal(mutations.length, 0)
    await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('New diligence company'); await dialog.getByRole('combobox', { name: 'Sector', exact: true }).selectOption('Healthcare')
    await dialog.getByRole('textbox', { name: 'Geography', exact: true }).fill('Canada')
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click(); await dialog.getByRole('alert').filter({ hasText: 'creation service unavailable' }).waitFor()
    assert.equal(await dialog.getByRole('textbox', { name: 'Project name', exact: true }).inputValue(), 'New diligence company')
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click(); await page.locator('.company-uploads').waitFor()
    assert.equal(mutations[0].body.deal_id, mutations[1].body.deal_id); createdId = mutations[1].body.deal_id
    assert.equal(new URL(page.url()).hash, `#/project/${createdId}/data-room`)
    await page.reload({ waitUntil: 'networkidle' }); await page.locator('.company-uploads').waitFor(); await projects(page)
    await page.getByRole('link', { name: 'Open New diligence company dashboard', exact: true }).waitFor()
  })
  await check('Shared workspace settings preserve failed edits, retry, and keep original company identity and evidence keys', async () => {
    await page.getByRole('button', { name: 'Manage New diligence company', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Workspace settings', exact: true })
    await dialog.getByRole('textbox', { name: 'Workspace name', exact: true }).fill('Reviewed company'); await dialog.getByRole('textbox', { name: 'Sector', exact: true }).fill('Climate'); await dialog.getByRole('textbox', { name: 'Geography', exact: true }).fill('Sweden')
    await dialog.getByRole('button', { name: 'Save settings', exact: true }).click(); await dialog.getByRole('alert').filter({ hasText: 'update failed' }).waitFor()
    assert.equal(await dialog.getByRole('textbox', { name: 'Workspace name', exact: true }).inputValue(), 'Reviewed company')
    await dialog.getByRole('button', { name: 'Save settings', exact: true }).click(); await dialog.waitFor({ state: 'detached' })
    const card = page.locator('.project-card').filter({ hasText: 'Reviewed company' }); assert.match(await card.innerText(), /Climate/); assert.match(await card.innerText(), /Sweden/)
    assert.equal(await card.getByRole('link', { name: 'Open Reviewed company dashboard', exact: true }).getAttribute('href'), `#/project/${createdId}/dashboard`)
    assert.equal(companies.find(item => item.deal_id === createdId).legal_name, 'New diligence company')
    const other = await workspace(); await other.getByRole('link', { name: 'Open Reviewed company dashboard', exact: true }).waitFor()
  })
  await check('Shared archive and restore persist across browsers without deleting the company', async () => {
    await page.getByRole('button', { name: 'Manage Reviewed company', exact: true }).click(); await page.getByRole('dialog', { name: 'Workspace settings', exact: true }).getByRole('button', { name: 'Archive workspace', exact: true }).click()
    await page.getByRole('dialog', { name: 'Workspace settings', exact: true }).waitFor({ state: 'detached' }); assert.equal(await page.getByRole('link', { name: 'Open Reviewed company dashboard', exact: true }).count(), 0)
    await collection(page, 'archived'); await page.getByRole('link', { name: 'Open Reviewed company dashboard', exact: true }).waitFor()
    const other = await workspace(); assert.equal(await other.getByRole('link', { name: 'Open Reviewed company dashboard', exact: true }).count(), 0); await collection(other, 'archived'); await other.getByRole('link', { name: 'Open Reviewed company dashboard', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Manage Reviewed company', exact: true }).click(); await page.getByRole('dialog', { name: 'Workspace settings', exact: true }).getByRole('button', { name: 'Restore workspace', exact: true }).click()
    await page.getByRole('dialog', { name: 'Workspace settings', exact: true }).waitFor({ state: 'detached' }); await collection(page, 'active'); await page.getByRole('link', { name: 'Open Reviewed company dashboard', exact: true }).waitFor()
    await other.reload({ waitUntil: 'networkidle' }); await other.getByRole('link', { name: 'Open Reviewed company dashboard', exact: true }).waitFor()
    assert.equal(companies.filter(item => item.deal_id === createdId).length, 1)
  })
  await check('Notifications show the selected company’s real fixture gaps, conflicts and upload jobs and navigate there', async () => {
    await page.getByRole('button', { name: 'Notifications', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Workspace notifications', exact: true })
    await dialog.getByRole('combobox', { name: 'Company', exact: true }).selectOption('circle'); await dialog.getByRole('button', { name: 'Inspect conflicts', exact: true }).waitFor()
    assert.match(await dialog.innerText(), /Circle source period is missing/); assert.match(await dialog.innerText(), /circle-processing.pdf/)
    await dialog.getByRole('combobox', { name: 'Company', exact: true }).selectOption('enfuce-documents'); await dialog.getByRole('button', { name: 'Review uploads', exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: 'Inspect conflicts', exact: true }).count(), 0); assert.equal((await dialog.innerText()).includes('Circle source period'), false)
    await dialog.getByRole('button', { name: 'Review uploads', exact: true }).click(); await page.locator('.company-uploads').waitFor(); assert.equal(new URL(page.url()).hash, '#/project/enfuce-documents/data-room')
    await page.getByRole('button', { name: 'Notifications', exact: true }).click(); assert.equal(await page.getByRole('dialog', { name: 'Workspace notifications', exact: true }).getByRole('combobox', { name: 'Company', exact: true }).inputValue(), 'enfuce-documents')
    await page.keyboard.press('Escape')
  })
  await check('Unsupported workspace routes show a useful recovery action rather than another functional page', async () => {
    for (const route of ['/project/circle/nonexistent', '/project/circle/report/nonexistent']) {
      await page.evaluate(route => { location.hash = route }, route); await page.getByText('Page not found', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Back to projects', exact: true }).click(); await page.getByRole('combobox', { name: 'Project collection', exact: true }).waitFor()
    }
  })
  await check('Mobile dialogs remain in the viewport, trap keyboard focus, and restore their opener', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); const opener = page.locator('.new-project-button'); await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Create a project', exact: true }); const first = dialog.getByRole('button', { name: 'Close Create a project', exact: true }), last = dialog.getByRole('button', { name: 'Create project', exact: true })
    await last.focus(); await page.keyboard.press('Tab'); assert.equal(await first.evaluate(element => element === document.activeElement), true)
    await first.focus(); await page.keyboard.press('Shift+Tab'); assert.equal(await last.evaluate(element => element === document.activeElement), true)
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); assert.equal(await opener.evaluate(element => element === document.activeElement), true)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click(); await page.getByRole('button', { name: 'Close navigation', exact: true }).waitFor(); await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name: 'Close navigation', exact: true }).count(), 0, 'Escape closes the mobile navigation.')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  })
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: results, real_browser: true, mocked_api: true, live_writes: 0, live_model_calls: 0, unexpected_api: unexpected, browser_errors: errors, mocked_mutations: mutations.length }, null, 2))
} catch (error) {
  for (const [index, context] of contexts.entries()) for (const page of context.pages()) await page.screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true }).catch(() => {})
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: results, error: String(error), unexpected_api: unexpected, browser_errors: errors }, null, 2)); throw error
} finally { await Promise.all(contexts.map(context => context.close())); await browser.close(); await server.close() }
