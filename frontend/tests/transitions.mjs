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
const observationDelay = Math.max(0, Math.min(2000, Number(process.env.TRANSITION_TEST_OBSERVE_DELAY_MS) || 0))
const cpuRate = Math.max(1, Math.min(8, Number(process.env.TRANSITION_TEST_CPU_RATE) || 1))
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
    window.__dialogAnimations = []
    const sample = (element, animation) => {
      const style = getComputedStyle(element), transform = style.transform
      return { connected: element.isConnected, transform, translateY: transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42,
        opacity: Number(style.opacity), duration: Number(animation.effect.getTiming().duration), progress: animation.effect.getComputedTiming().progress,
        currentTime: Number(animation.currentTime), state: animation.playState, keyframes: animation.effect.getKeyframes() }
    }
    const animate = Element.prototype.animate
    Element.prototype.animate = function (...args) {
      const animation = Reflect.apply(animate, this, args)
      const phase = this.matches('.backend-loading') || this.querySelector('.backend-loading') ? 'loading' : this.querySelector('.connected-dashboard') ? 'company-ready' : 'content'
      const entry = { animation, element: this, phase, startedAt: performance.now(), sample: null, timer: null }
      if (this.matches('.page-transition')) {
        // Test-side clock control: observe the real effect at its midpoint even
        // when the runner cannot schedule another command inside its 320ms life.
        animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) / 4
        entry.sample = sample(this, animation)
        entry.timer = setTimeout(() => { if (animation.playState === 'paused') animation.play() }, 15_000)
      }
      window.__motionAnimations.push(entry)
      return animation
    }
    window.__releasePageMotion = () => {
      for (const entry of window.__motionAnimations) {
        clearTimeout(entry.timer)
        if (entry.animation.playState === 'paused') entry.animation.play()
      }
    }
    // CSS animations do not call Element.animate. Capture their actual rendered
    // midpoint in the commit microtask, then let each original effect continue.
    const captured = new WeakSet()
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        const elements = [...(node.matches('.dialog,.modal-backdrop,.sidebar-overlay') ? [node] : []), ...node.querySelectorAll('.dialog,.modal-backdrop,.sidebar-overlay')]
        for (const element of elements) for (const animation of element.getAnimations()) {
          if (!(animation instanceof CSSAnimation) || captured.has(animation)) continue
          captured.add(animation)
          animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) / 4
          window.__dialogAnimations.push({ element, name: animation.animationName, sample: sample(element, animation) })
          animation.play()
        }
      }
    }).observe(document, { childList: true, subtree: true })
  }, { workspace })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== new URL(base).origin) { await route.abort('blockedbyclient'); return }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return }
    if (request.method() !== 'GET') {
      mutations.push(`${request.method()} ${url.pathname}`)
      await route.fulfill({ status: 405, json: { detail: 'Motion tests never write to the backend.' } }); return
    }
    if (url.pathname === '/api/deals') { await route.fulfill({ json: { companies: [{ deal_id: 'circle-2025-ipo', entity_key: 'circle', legal_name: 'Circle', domain: 'circle.com', country: 'USA', identifiers: { workspace_sector: 'Fintech', workspace_geography: 'United States' } }] } }); return }
    if (url.pathname === '/api/deals/circle-2025-ipo/report') {
      await new Promise(resolve => setTimeout(resolve, 350))
      await route.fulfill({ json: report }).catch(() => {})
      return
    }
    if (url.pathname === '/api/deals/circle-2025-ipo/uploads') { await route.fulfill({ json: { uploads: [] } }); return }
    if (url.pathname === '/api/deals/circle-2025-ipo/report-drafts') { await route.fulfill({ json: { drafts: [] } }); return }
    if (url.pathname === '/api/calculation-runtime') {
      await route.fulfill({ json: { mode: 'llm_local', configured: false, model: 'motion-ui-fixture', executor: 'local_python', generation_provider: 'fixture', missing: ['UI-only fixture'], maximum_inputs: 100 } }); return
    }
    unexpectedApi.push(url.pathname)
    await route.fulfill({ status: 501, json: { detail: 'No live API is used by this motion fixture.' } })
  })
  const page = await context.newPage()
  if (cpuRate > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${base}/#/projects`, { waitUntil: 'networkidle' })
  await page.locator('.project-card').first().waitFor()
  return { page, context }
}
async function runningPageMotion(page) {
  if (observationDelay) await new Promise(resolve => setTimeout(resolve, observationDelay))
  await page.waitForFunction(id => Array.from(document.querySelectorAll('.page-transition')).some(region => region.getAnimations().some(animation => animation.id === id && ['running', 'paused'].includes(animation.playState))), pageAnimationId)
  const state = await page.locator('.page-transition').first().evaluate((region, id) => {
    const animation = region.getAnimations().find(item => item.id === id)
    const transform = getComputedStyle(region).transform
    return { connected: region.isConnected, transform, translateY: transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42, opacity: Number(getComputedStyle(region).opacity), duration: animation?.effect?.getTiming().duration,
      progress: animation?.effect?.getComputedTiming().progress, currentTime: Number(animation?.currentTime), state: animation?.playState, keyframes: animation?.effect?.getKeyframes() }
  }, pageAnimationId)
  assertPageMotionSample(state)
  assert.equal(await page.locator('#main-content').evaluate(main => getComputedStyle(main).transform), 'none', 'The fixed-overlay ancestor must never move.')
  assert.equal(await page.locator('.assistant-dock').evaluateAll(docks => docks.every(dock => !dock.closest('.page-transition'))), true, 'The fixed assistant dock must stay outside the moving content.')
  return state
}
function assertPageMotionSample(state) {
  assert.equal(state.connected, true, 'Motion must be sampled while its actual route element is connected.')
  assert.notEqual(state.transform, 'none', 'Visible route content should move during its entrance.')
  assert.ok(state.translateY > 0 && state.translateY <= 13, 'Route motion stays small and vertical.')
  assert.ok(state.opacity > 0 && state.opacity < 1, 'Visible content must remain readable during the actual entrance effect.')
  assert.ok(Number(state.duration) > 0 && Number(state.duration) <= 400, 'Page transition should be brief.')
  assert.ok(state.progress > 0 && state.progress < 1 && state.currentTime > 0 && state.currentTime < Number(state.duration), 'The observed effect must be between its original start and end.')
  assert.ok(Number(state.keyframes?.[0]?.opacity) < Number(state.keyframes?.at(-1)?.opacity), 'The original route keyframes must fade into view.')
  assert.notEqual(state.keyframes?.[0]?.transform, state.keyframes?.at(-1)?.transform, 'The original route keyframes must contain translation.')
}
async function settled(page) {
  await page.evaluate(() => window.__releasePageMotion())
  await page.waitForFunction(id => !Array.from(document.querySelectorAll('.page-transition')).some(region => region.getAnimations().some(animation => animation.id === id && ['running', 'paused'].includes(animation.playState))), pageAnimationId)
  assert.equal(await page.locator('.page-transition').first().evaluate(region => getComputedStyle(region).opacity), '1')
  assert.equal(await page.locator('.page-transition').first().evaluate(region => getComputedStyle(region).transform), 'none')
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
  assert.equal(await page.locator('.modal-backdrop').last().evaluate(element => element.parentElement === document.body && !element.closest('.page-transition')), true, 'Dialogs stay outside the animated route region.')
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
  const animations = await dialog.evaluate(element => window.__dialogAnimations.filter(entry => entry.element === element).map(entry => ({ name: entry.name, ...entry.sample })))
  assert.ok(animations.length > 0, 'Opening a dialog should start its own entrance motion.')
  assert.ok(animations.some(animation => Number(animation.duration) > 0 && Number(animation.duration) <= 350 && animation.connected
    && animation.progress > 0 && animation.progress < 1 && animation.opacity > 0 && animation.opacity < 1
    && animation.currentTime > 0 && animation.currentTime < Number(animation.duration)
    && ['ingenium-dialog-enter', 'ingenium-drawer-enter'].includes(animation.name)
    && Number(animation.keyframes[0].opacity) < Number(animation.keyframes.at(-1).opacity)
    && animation.transform !== 'none' && animation.keyframes[0].transform !== animation.keyframes.at(-1).transform), 'A real dialog/drawer effect must visibly move and fade before its original duration ends.')
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
  await check('Actual company-card and Dashboard, Report and Data room links animate visible company content', async () => {
    const before = await page.evaluate(() => window.__motionAnimations.length)
    await page.getByRole('link', { name: 'Open Circle dashboard', exact: true }).click()
    await runningPageMotion(page)
    await page.locator('.connected-dashboard').waitFor()
    await runningPageMotion(page)
    const phases = await page.evaluate(start => window.__motionAnimations.slice(start).filter(item => item.element.classList.contains('page-transition')).map(item => ({ phase: item.phase, startedAt: item.startedAt, sample: item.sample })), before)
    assert.ok(phases.some(item => item.phase === 'loading'), 'Company-card navigation must animate the loading region.')
    assert.ok(phases.some(item => item.phase === 'company-ready'), 'Loaded company content needs a fresh entrance after the delayed report arrives.')
    for (const phase of ['loading', 'company-ready']) for (const entry of phases.filter(item => item.phase === phase)) assertPageMotionSample(entry.sample)
    assert.ok(phases.find(item => item.phase === 'company-ready').startedAt - phases.find(item => item.phase === 'loading').startedAt >= 300, 'The fixture must exercise a real asynchronous company load.')
    await settled(page)
    const navigation = page.getByRole('navigation', { name: 'Project workspace', exact: true })
    for (const [label, selector] of [['Report', '.builder-grid'], ['Data room', '.company-uploads'], ['Dashboard', '.connected-dashboard']]) {
      await navigation.getByRole('link', { name: label, exact: true }).click()
      await runningPageMotion(page); await page.locator(selector).waitFor(); await settled(page)
    }
    await navigate(page, '/projects', '.project-card')
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
      return Array.from(document.querySelectorAll('.page-transition')).some(region => region.getAnimations().some(animation => animation.id === id && ['running', 'paused'].includes(animation.playState)
        && animation.effect.getComputedTiming().progress > 0 && animation.effect.getComputedTiming().progress < 1))
    }, pageAnimationId)
    assert.equal(stillEntering, true, 'The overlay check must run during the page transition.')
    await assertOverlayBounds(page); await assertOverlayOnTop(page)
    const state = await runningPageMotion(page)
    await page.getByRole('dialog', { name: '2019 gross profit', exact: true }).evaluate(element => Promise.all([...element.getAnimations(), ...element.parentElement.getAnimations()].map(animation => animation.finished.catch(() => {}))))
    await page.screenshot({ path: path.join(output, 'overlay-during-page-motion.png'), fullPage: false, animations: 'allow' })
    await fs.writeFile(path.join(output, 'overlay-during-page-motion.json'), JSON.stringify(state, null, 2))
    await page.keyboard.press('Escape'); await settled(page)
  })
  await check('Company and source drawers open independently without a live backend or model call', async () => {
    await navigate(page, '/project/circle/dashboard', '.connected-dashboard')
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
    await navigate(page, '/project/circle/dashboard', '.connected-dashboard')
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
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ base, passed: results, observationDelay, cpuRate, errors, mutations, unexpectedApi }, null, 2))
  console.log(`PASS ${results.length} transition checks; no API writes or model calls.`)
} catch (error) {
  for (const [index, context] of contexts.entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      await page.screenshot({ path: path.join(output, `failure-${index}-${pageIndex}.png`), fullPage: true, animations: 'allow' }).catch(() => {})
      const state = await page.evaluate(() => ({ hash: location.hash,
        regions: [...document.querySelectorAll('.page-transition')].map(element => ({ page: element.getAttribute('data-page'), opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform,
          animations: element.getAnimations().map(animation => ({ id: animation.id, state: animation.playState, currentTime: animation.currentTime, timing: animation.effect?.getComputedTiming() })) })),
        captured: window.__motionAnimations?.map(entry => ({ id: entry.animation.id, phase: entry.phase, startedAt: entry.startedAt, sample: entry.sample, state: entry.animation.playState })),
        dialogs: window.__dialogAnimations?.map(entry => ({ name: entry.name, sample: entry.sample })),
      })).catch(reason => ({ diagnosticError: String(reason) }))
      await fs.writeFile(path.join(output, `failure-${index}-${pageIndex}.json`), JSON.stringify(state, null, 2))
    }
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ base, passed: results, error: String(error), errors, mutations, unexpectedApi }, null, 2))
  throw error
} finally {
  for (const context of contexts) await context.close()
  await browser.close()
}
