// Run against the current frontend to refresh authentic, public historical-demo previews.
// Usage: node scripts/capture-landing-previews.mjs (start npm run dev first).
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  // The historical demo is public fixture content. Never capture live customer data.
  await page.route('**/api/**', route => route.fulfill({ json: { companies: [] } }))
  const previews = [
    ['dashboard', 'dashboard', '.dashboard-page'],
    ['report', 'report/build', '.builder-grid'],
    ['sources', 'data-room', '.sources-table'],
  ]
  for (const [name, route, selector] of previews) {
    await page.goto(`${base}/#/project/enfuce/${route}`, { waitUntil: 'networkidle' })
    await page.locator(selector).first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: fileURLToPath(new URL(`../public/images/workspace-${name}-current.jpg`, import.meta.url)), type: 'jpeg', quality: 92, animations: 'disabled' })
    console.log(`Captured current ${name} interface`)
  }
} finally { await browser.close() }
