import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5173'
const out = 'test-results/landing'
await fs.mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = [], failed = [], passed = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => { if (response.status() >= 400 && response.url().startsWith(base)) failed.push(`${response.status()} ${response.url()}`) })
async function check(name, test) { await test(); passed.push(name); console.log(`PASS ${name}`) }
async function imageReady() { await page.locator('.ig-product-preview img').evaluate(image => image.decode()) }
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await check('Root opens Ingenium with the exact approved slogan and metadata', async () => {
    assert.equal((await page.getByRole('heading', { level: 1 }).innerText()).replace(/\s+/g, ' '), 'Trusted diligence, powered by the world’s evidence.')
    assert.match(await page.title(), /Ingenium/)
    assert.equal(await page.locator('html').getAttribute('data-screen'), 'landing')
    const demoLinks = page.getByRole('link', { name: /Book a Demo|See the Platform/ })
    assert.ok(await demoLinks.count() >= 4)
    for (const link of await demoLinks.all()) assert.equal(await link.getAttribute('href'), '#/projects')
    await page.screenshot({ path: `${out}/hero-desktop.png` })
  })
  await check('Product navigation and all three real workspace previews load', async () => {
    await page.getByRole('navigation', { name: 'Website navigation' }).getByRole('link', { name: 'Product', exact: true }).click()
    for (const [index, label] of ['Understand the numbers', 'Build the bigger picture', 'Keep the evidence close'].entries()) {
      await page.getByRole('tab', { name: label, exact: true }).click()
      await imageReady()
      assert.equal(await page.locator('.ig-product-preview img').evaluate(image => image.naturalWidth), 1440)
      assert.equal(await page.getByRole('tab', { name: label, exact: true }).getAttribute('aria-selected'), 'true')
      await page.locator('.ig-product-preview').screenshot({ path: `${out}/product-${index}.png` })
    }
    await page.getByRole('tab', { name: 'Understand the numbers', exact: true }).click()
    await imageReady()
  })
  await check('Evidence tabs expose real calculation and precise source context with keyboard controls', async () => {
    await page.getByRole('tab', { name: 'The claim', exact: false }).click()
    await page.keyboard.press('ArrowRight')
    assert.match(await page.locator('#ig-evidence-panel').innerText(), /3,417,663.76 \+ €35,019.05/)
    await page.keyboard.press('ArrowRight')
    assert.match(await page.locator('#ig-evidence-panel').innerText(), /Five-year financial summary!F4 \(English worksheet label\)/)
    await page.keyboard.press('Home')
    assert.match(await page.locator('#ig-evidence-panel').innerText(), /3,452,682.81/)
  })
  await check('Persona tabs and FAQ show distinct content and accurate demo limitations', async () => {
    await page.getByRole('tab', { name: 'Senior Associates, VPs & Principals', exact: true }).click()
    assert.match(await page.locator('#ig-persona-panel').innerText(), /Know what stands up/)
    await page.getByRole('tab', { name: 'Partners & Investment Committees', exact: true }).click()
    assert.match(await page.locator('#ig-persona-panel').innerText(), /decision you can explain/)
    await page.getByRole('tab', { name: 'VC Analysts & Associates', exact: true }).click()
    const question = page.getByRole('button', { name: 'Can I upload my own documents?', exact: true })
    await question.click()
    assert.equal(await question.getAttribute('aria-expanded'), 'true')
    assert.match(await page.locator('#ig-faq-answer-3').innerText(), /still being connected/)
    await question.click()
    assert.equal(await question.getAttribute('aria-expanded'), 'false')
    await page.getByRole('button', { name: 'What can I try in the demo?', exact: true }).click()
  })
  await check('Four-step workflow, three subscription tiers and user-supplied contact email are present', async () => {
    assert.equal(await page.locator('.ig-workflow-grid article').count(), 4)
    assert.equal(await page.locator('.ig-plan-grid article').count(), 3)
    for (const link of await page.locator('.ig-plan-grid article > a').all()) assert.match(await link.getAttribute('href'), /^mailto:hello@ingenium\.ai/)
    assert.ok(await page.getByRole('link', { name: 'hello@ingenium.ai', exact: true }).count() > 0)
  })
  await check('Contact opens a real draft channel, without a fake submitted form', async () => {
    const href = await page.getByRole('link', { name: 'Contact the team', exact: false }).first().getAttribute('href')
    assert.ok(href.startsWith('https://github.com/imnotmomo/acefire/issues/new?') || href.startsWith('mailto:'))
    if (href.startsWith('https:')) assert.match(await page.locator('.ig-contact-note').innerText(), /Review it before submitting/)
  })
  await check('Demo reaches the real platform; brand returns home and stored projects survive', async () => {
    await page.getByRole('link', { name: 'Book a Demo', exact: true }).first().click()
    await page.locator('.project-card').first().waitFor()
    assert.equal(await page.locator('.project-card').count(), 4)
    const before = await page.evaluate(() => localStorage.getItem('acefire:projects:v1'))
    assert.equal(await page.locator('html').getAttribute('data-screen'), 'workspace')
    await page.getByRole('link', { name: 'Ingenium home', exact: true }).click()
    await page.getByRole('heading', { level: 1 }).waitFor()
    await page.locator('.ig-header-actions').getByRole('link', { name: 'See the Platform', exact: false }).click()
    await page.locator('.project-card').first().waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('acefire:projects:v1')), before)
    await page.goto(`${base}/#/project/enfuce/dashboard`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Data dashboard', exact: true }).waitFor()
    await page.getByRole('link', { name: 'Ingenium home', exact: true }).click()
  })
  await check('Responsive layouts at 1440, 1024, 768 and 390 pixels have no page overflow', async () => {
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.goto(`${base}/`, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { level: 1 }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Page overflows at ${width}px`)
      await page.locator('#product').scrollIntoViewIfNeeded()
      await imageReady()
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: `${out}/page-${width}.png`, fullPage: true })
    }
  })
  await check('Mobile navigation opens, closes on Escape and reaches the contact section', async () => {
    await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click()
    const navigation = page.getByRole('navigation', { name: 'Website navigation' })
    assert.equal(await navigation.isVisible(), true)
    await page.keyboard.press('Escape')
    assert.equal(await navigation.isVisible(), false)
    await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click()
    await navigation.getByRole('link', { name: 'Contact', exact: true }).click()
    assert.equal(await navigation.isVisible(), false)
    assert.equal(new URL(page.url()).hash, '#contact')
    await page.locator('.ig-contact-actions').scrollIntoViewIfNeeded()
    await page.locator('.ig-contact-actions').getByRole('link', { name: 'Book a Demo', exact: true }).click()
    await page.locator('.project-card').first().waitFor()
  })
  await check('Reduced-motion preference and deep links retain correct routes', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${base}/#teams`, { waitUntil: 'networkidle' })
    await page.locator('#teams').waitFor()
    await page.getByRole('tab', { name: 'Senior Associates, VPs & Principals', exact: true }).click()
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true)
    await page.goto(`${base}/#/project/enfuce/report/build`, { waitUntil: 'networkidle' })
    await page.locator('.builder-grid').waitFor()
    assert.equal(await page.locator('html').getAttribute('data-screen'), 'workspace')
  })
  assert.deepEqual(errors, [], 'Browser runtime errors')
  assert.deepEqual(failed, [], 'Missing local assets or HTTP errors')
  await fs.writeFile(`${out}/results.json`, JSON.stringify({ passed, errors, failed }, null, 2))
  console.log(`${passed.length} landing flows passed; no runtime or asset errors.`)
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true })
  throw error
} finally { await browser.close() }
