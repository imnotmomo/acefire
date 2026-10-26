import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

// Browser-only UI fixtures: no backend mutations, model calls or production data.
const base = (process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '')
const output = path.resolve(process.env.TRANSITION_ARTIFACT_DIR || 'test-results/transitions')
await fs.mkdir(output, { recursive: true })
let executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
if (!executablePath) {
  const candidates = process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : process.platform === 'win32' ? ['C:/Program Files/Google/Chrome/Application/chrome.exe'] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  for (const candidate of candidates) {
    if (await fs.access(candidate).then(() => true, () => false)) { executablePath = candidate; break }
  }
}
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true })
const contexts = [], results = [], errors = [], mutations = [], unexpectedApi = []
const pageAnimationId = 'ingenium-page-enter'
const config = { topics: ['Company profile'], depth: 'Standard', geography: 'Global', horizon: 'Source period', scope: 'Internal only', focus: 'Preserve these review preferences.' }
const workspace = {
  order: ['overview', 'market'], configs: { overview: config, market: config }, revisions: [], generatedAt: '2026-10-24T12:00:00Z',
  sections: [{ id: 'overview', title: 'Company overview', content: 'The historical source records operating income. [income]', evidenceIds: ['income'], config }],
}
const report = {
  report_id: 'motion-fixture-report', report_version: '1', generated_at_utc: '2026-10-24T12:00:00Z',
  company: { deal_id: 'circle-2025-ipo', entity_key: 'circle', legal_name: 'Circle', domain: 'circle.com', country: 'USA', primary_provider: 'akta', historical_cutoff: null, identifiers: {} },
  primary_profile: { available: false, provider: 'akta', records: [], field_lineage: { fields: [], sources: [], nodes: [], edges: [] } },
  reported_metrics: [], calculations: [], comparisons: [], source_files: [], coverage: [], gaps: [], summary: {},
  data_period_coverage: [], source_graph: { nodes: [], edges: [] }, conflict_numbers: false, conflicts: [], flags: [], document_claims: [],
}

async function check(name, callback) {
  await callback(); results.push(name); console.log(`PASS ${name}`)
}
async function createPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, reducedMotion: 'no-preference', ...options })
  contexts.push(context)
  await context.addInitScript(({ workspace }) => {
    localStorage.setItem('acefire:workspace:v1:enfuce', JSON.stringify(workspace))
    window.__motionAnimations = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (...args) {
      const animation = Reflect.apply(animate, this, args)
      window.__motionAnimations.push({ animation, element: this })
      return animation
    }
  }, { workspace })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== new URL(base).origin) { await route.abort('blockedbyclient'); return }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return }
    if (request.method() !== 'GET') {
      mutations.push(`${request.method()} ${url.pathname}`)
      await route.fulfill({ status: 405, json: { detail: 'Motion tests never write to the backend.' } }); return
    }
    if (url.pathname === '/api/deals') { await route.fulfill({ json: { companies: [] } }); return }
    if (url.pathname === '/api/deals/circle-2025-ipo/report') { await route.fulfill({ json: report }); return }
    if (url.pathname === '/api/calculation-runtime') {
      await route.fulfill({ json: { mode: 'llm_local', configured: false, model: 'motion-ui-fixture', executor: 'local_python', generation_provider: 'fixture', missing: ['UI-only fixture'], maximum_inputs: 100 } }); return
    }
    unexpectedApi.push(url.pathname)
    await route.fulfill({ status: 501, json: { detail: 'No live API is used by this motion fixture.' } })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${base}/#/projects`, { waitUntil: 'networkidle' })
  await page.locator('.project-card').first().waitFor()
  return { page, context }
}
async function runningPageMotion(page) {
  await page.waitForFunction(id => document.getElementById('main-content')?.getAnimations().some(animation => animation.id === id && animation.playState === 'running'), pageAnimationId)
  const state = await page.locator('#main-content').evaluate((main, id) => {
    const animation = main.getAnimations().find(item => item.id === id)
    return { transform: getComputedStyle(main).transform, opacity: Number(getComputedStyle(main).opacity), duration: animation?.effect?.getTiming().duration }
  }, pageAnimationId)
  assert.equal(state.transform, 'none', 'Page motion must not create a containing block for fixed overlays.')
  assert.ok(state.opacity > 0 && state.opacity <= 1, 'Visible content must remain readable while entering.')
  assert.ok(Number(state.duration) > 0 && Number(state.duration) <= 350, 'Page transition should be brief.')
}
async function settled(page) {
  await page.waitForFunction(id => !document.getElementById('main-content')?.getAnimations().some(animation => animation.id === id && animation.playState === 'running'), pageAnimationId)
  assert.equal(await page.locator('#main-content').evaluate(main => getComputedStyle(main).opacity), '1')
  assert.equal(await page.locator('#main-content').evaluate(main => getComputedStyle(main).transform), 'none')
}
async function navigate(page, route, selector) {
  await page.evaluate(route => { location.hash = route }, route)
  await runningPageMotion(page)
  if (selector) await page.locator(selector).first().waitFor()
  await settled(page)
}
async function assertOverlayBounds(page) {
  const bounds = await page.locator('.modal-backdrop').last().evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight }
  })
  assert.ok(Math.abs(bounds.top) < 1 && Math.abs(bounds.left) < 1)
  assert.ok(Math.abs(bounds.width - bounds.viewportWidth) < 1 && Math.abs(bounds.height - bounds.viewportHeight) < 1)
}
async function assertOverlayOnTop(page) {
  const intercepted = await page.evaluate(() => {
    const points = ['.sidebar', '.topbar'].map(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect()
      return [rect.left + Math.min(30, rect.width / 2), rect.top + Math.min(50, rect.height / 2)]
    })
    points.push([innerWidth - 8, innerHeight - 8])
    return points.every(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.modal-backdrop')))
  })
  assert.equal(intercepted, true, 'Modal backdrop must cover navigation even while page opacity is animating.')
}
async function assertOpeningMotion(dialog) {
  const animations = await dialog.evaluate(element => element.getAnimations().map(animation => ({ duration: animation.effect?.getTiming().duration, state: animation.playState })))
  assert.ok(animations.length > 0, 'Opening a dialog should start its own entrance motion.')
  assert.ok(animations.some(animation => Number(animation.duration) > 0 && Number(animation.duration) <= 350))
}

try {
  const desktop = await createPage(), page = desktop.page
  await check('Page navigation enters and settles without transforming fixed-overlay ancestors', async () => {
    for (const [route, selector] of [
      ['/project/enfuce/dashboard', '.hero-number'], ['/project/enfuce/report/build', '.builder-grid'],
      ['/project/enfuce/report/review', '.report-paper'], ['/project/enfuce/report/export', '.export-layout'],
      ['/project/enfuce/data-room', '.sources-table'], ['/projects', '.project-card'],
    ]) await navigate(page, route, selector)
  })
  await check('Rapid navigation and browser history never leave dimmed or stale page content', async () => {
    await page.evaluate(async () => {
      for (const route of ['/project/enfuce/dashboard', '/project/enfuce/report/build', '/project/enfuce/data-room']) {
        location.hash = route
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    })
    await page.locator('.sources-table').waitFor(); await settled(page)
    await page.goBack(); await page.locator('.builder-grid').waitFor(); await settled(page)
    await page.goForward(); await page.locator('.sources-table').waitFor(); await settled(page)
    assert.equal(await page.locator('#main-content').count(), 1)
  })
  await check('Report stage motion preserves preferences, unsaved editor text and export selection', async () => {
    await navigate(page, '/project/enfuce/report/build', '.builder-grid')
    const focus = page.getByLabel('Additional focus', { exact: false })
    await focus.fill('Motion regression: keep the complete report preferences.')
    await navigate(page, '/project/enfuce/report/review', '.report-paper')
    await page.getByRole('button', { name: 'Edit Company overview', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Edit Company overview', exact: true })
    await editor.getByRole('textbox', { name: 'Section content', exact: true }).fill('Unsaved editor content must survive a report-stage transition.')
    await navigate(page, '/project/enfuce/report/export', '.export-layout')
    assert.equal(await editor.getByRole('textbox', { name: 'Section content', exact: true }).inputValue(), 'Unsaved editor content must survive a report-stage transition.')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Markdown.*Ready to reuse/ }).click()
    await navigate(page, '/project/enfuce/report/build', '.builder-grid')
    assert.equal(await focus.inputValue(), 'Motion regression: keep the complete report preferences.')
    await navigate(page, '/project/enfuce/report/export', '.export-layout')
    assert.equal(await page.getByRole('button', { name: /Markdown.*Ready to reuse/ }).getAttribute('aria-pressed'), 'true')
  })
  await check('Create dialog animates, traps focus, closes by Escape and retains the unsubmitted form', async () => {
    const opener = page.getByRole('button', { name: 'Create Project', exact: true })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Create a project', exact: true })
    await assertOpeningMotion(dialog)
    await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('Motion-only unsubmitted project')
    const first = dialog.getByRole('button', { name: 'Close Create a project', exact: true })
    const last = dialog.getByRole('button', { name: 'Create project', exact: true })
    await last.focus(); await page.keyboard.press('Tab'); assert.equal(await first.evaluate(element => element === document.activeElement), true)
    await first.focus(); await page.keyboard.press('Shift+Tab'); assert.equal(await last.evaluate(element => element === document.activeElement), true)
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' })
    assert.equal(await opener.evaluate(element => element === document.activeElement), true)
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden')
    await opener.click()
    assert.equal(await dialog.getByRole('textbox', { name: 'Project name', exact: true }).inputValue(), 'Motion-only unsubmitted project')
    await page.keyboard.press('Escape')
  })
  await check('Deep-scroll evidence and dialogs remain attached to the viewport', async () => {
    await navigate(page, '/project/enfuce/dashboard', '.hero-number')
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    assert.ok(await page.evaluate(() => scrollY > 100), 'The fixed-overlay check needs a scrolled page.')
    await page.evaluate(() => {
      const button = document.querySelector('.new-project-button')
      button.focus({ preventScroll: true }); button.click()
    })
    await page.getByRole('dialog', { name: 'Create a project', exact: true }).waitFor()
    await assertOverlayBounds(page); await page.keyboard.press('Escape')
    await page.locator('.metric-card').filter({ hasText: '2019 gross profit' }).click()
    await page.getByRole('dialog', { name: '2019 gross profit', exact: true }).waitFor()
    await assertOverlayBounds(page)
    await page.getByRole('button', { name: 'Open evidence inspector', exact: true }).click()
    await page.getByRole('dialog', { name: 'Evidence inspector', exact: true }).waitFor()
    await assertOverlayBounds(page); await page.keyboard.press('Escape')
  })
  await check('Opening a function during page motion keeps its backdrop above the page and navigation', async () => {
    await navigate(page, '/projects', '.project-card')
    await page.evaluate(() => { location.hash = '/project/enfuce/dashboard' })
    await runningPageMotion(page)
    const stillEntering = await page.locator('.metric-card').filter({ hasText: '2019 gross profit' }).evaluate(async (button, id) => {
      button.click()
      await new Promise(resolve => requestAnimationFrame(resolve))
      return document.getElementById('main-content').getAnimations().some(animation => animation.id === id && animation.playState === 'running')
    }, pageAnimationId)
    assert.equal(stillEntering, true, 'The overlay check must run during the page transition.')
    await assertOverlayBounds(page); await assertOverlayOnTop(page)
    await page.keyboard.press('Escape'); await settled(page)
  })
  await check('Company and source drawers open independently without a live backend or model call', async () => {
    await navigate(page, '/project/circle/dashboard', '.calculation-lab')
    await page.locator('.assistant-launcher').click()
    const company = page.getByRole('dialog', { name: 'Company chat', exact: true })
    await assertOpeningMotion(company); await assertOverlayBounds(page)
    assert.ok((await company.boundingBox()).x > 600, 'Desktop company chat should remain a right-side drawer.')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Search source files', exact: true }).click()
    const source = page.getByRole('dialog', { name: 'Search source files', exact: true })
    await assertOpeningMotion(source); await assertOverlayBounds(page)
    await page.keyboard.press('Escape')
    const before = await page.evaluate(id => window.__motionAnimations.filter(item => item.animation.id === id).length, pageAnimationId)
    await page.evaluate(() => { location.hash = '/project/circle/dashboard?chat=company' })
    await company.waitFor(); await assertOverlayBounds(page)
    assert.equal(await page.evaluate(id => window.__motionAnimations.filter(item => item.animation.id === id).length, pageAnimationId), before, 'Consuming a chat intent must not replay page motion or remount the workspace.')
    await page.keyboard.press('Escape')
  })
  await check('Reduced-motion changes cancel page motion and disable dialog entrance animation', async () => {
    await page.evaluate(() => { location.hash = '/projects' }); await runningPageMotion(page)
    await page.emulateMedia({ reducedMotion: 'reduce' }); await settled(page)
    await page.evaluate(() => { location.hash = '/project/enfuce/dashboard' })
    await page.locator('.hero-number').waitFor(); await settled(page)
    await page.getByRole('button', { name: 'Create Project', exact: true }).click()
    assert.equal(await page.getByRole('dialog', { name: 'Create a project', exact: true }).evaluate(element => getComputedStyle(element).animationName), 'none')
    assert.equal(await page.locator('.modal-backdrop').evaluate(element => getComputedStyle(element).animationName), 'none')
    await page.keyboard.press('Escape'); await page.emulateMedia({ reducedMotion: 'no-preference' })
    const reduced = await createPage({ reducedMotion: 'reduce' })
    await reduced.page.evaluate(() => { location.hash = '/project/enfuce/dashboard' })
    await reduced.page.locator('.hero-number').waitFor(); await settled(reduced.page)
    assert.equal(await reduced.page.evaluate(id => window.__motionAnimations.some(item => item.animation.id === id), pageAnimationId), false)
  })
  await check('Mobile page, navigation and drawer motion preserve viewport bounds and readable content', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await navigate(page, '/project/circle/dashboard', '.calculation-lab')
    await page.locator('.assistant-launcher').click()
    const drawer = page.getByRole('dialog', { name: 'Company chat', exact: true })
    await assertOverlayBounds(page)
    await drawer.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))))
    const bounds = await drawer.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click()
    assert.equal(await page.locator('.app-shell').evaluate(element => element.classList.contains('sidebar-open')), true)
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(output, 'mobile-dashboard.png'), fullPage: true })
  })
  assert.deepEqual(mutations, [], 'The motion suite must never write company records or call a model.')
  assert.deepEqual(unexpectedApi, [], 'Every API read is an explicit local fixture.')
  assert.deepEqual(errors, [], 'Navigation and motion must not introduce browser runtime errors.')
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ base, passed: results, errors, mutations, unexpectedApi }, null, 2))
  console.log(`PASS ${results.length} transition checks; no API writes or model calls.`)
} catch (error) {
  for (const [index, context] of contexts.entries()) {
    for (const page of context.pages()) await page.screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true }).catch(() => {})
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ base, passed: results, error: String(error), errors, mutations, unexpectedApi }, null, 2))
  throw error
} finally {
  for (const context of contexts) await context.close()
  await browser.close()
}
