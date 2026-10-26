import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { waitForFixtureGate } from './workflowGuards.mjs'

const output = path.resolve('test-results/normalization-workflow')
await fs.mkdir(output, { recursive:true })
const server = await createServer({ configFile:false, plugins:[react()], server:{ host:'127.0.0.1', port:5299, strictPort:true } })
await server.listen()
const base = server.resolvedUrls.local[0]
let executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser']) {
  if (!executablePath && await fs.access(candidate).then(() => true, () => false)) executablePath = candidate
}
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless:true })
const context = await browser.newContext({ viewport:{ width:1440, height:1100 } })
const errors = [], unexpected = [], results = [], reviewRequests = [], calculationRequests = []
let reviewMode = 'failure', calculateMode = 'delay', releaseCalculation = null, releaseReview = null, reviewed, configured = true, waitingGate = null
async function requestGate(name, current) {
  waitingGate = name
  await waitForFixtureGate(name, current)
  waitingGate = null
}
const page = await context.newPage(); page.setDefaultTimeout(10000)
page.on('pageerror', error => errors.push(error.message))
await context.route('**/api/**', async route => {
  const endpoint = new URL(route.request().url()).pathname
  if (endpoint === '/api/calculation-runtime') return route.fulfill({ json:{ mode:'llm_local', configured, model:'fixture-model', generation_provider:'fixture', executor:'local_python', maximum_inputs:100, missing:configured ? [] : ['NICRRON_API_KEY'] } })
  if (endpoint === '/api/deals/fixture-company/observations/raw-revenue/normalize') {
    const body = route.request().postDataJSON(); reviewRequests.push(body)
    if (reviewMode === 'failure') return route.fulfill({ status:503, json:{ detail:'Fixture review service unavailable. Your entries are safe.' } })
    if (reviewMode === 'delay') await new Promise(resolve => { releaseReview = resolve })
    const report = await page.evaluate(() => window.normalizationFixture.report)
    reviewed = { ...structuredClone(report.reported_metrics[0].observation), ...body, id:'reviewed-revenue', reviewed_from_id:'raw-revenue', value:'100123.400000000000006000', normalization_status:'confirmed', verification_status:'needs_review' }
    if (reviewMode === 'invalid') reviewed.locator = { kind:'csv_row', row:90 }
    return route.fulfill({ json:{ observation:reviewed, reviewed_from_id:'raw-revenue', created:true } }).catch(() => {})
  }
  if (endpoint === '/api/deals/fixture-company/calculate/agent') {
    const body = route.request().postDataJSON(); calculationRequests.push(body)
    if (calculateMode === 'delay') await new Promise(resolve => { releaseCalculation = resolve })
    return route.fulfill({ json:{ id:'fixture-calculation', deal_id:'fixture-company', metric_key:'agent.revenue', function_key:'llm_local_python', function_version:'fixture', formula:'Original decimal × explicit scale', status:'succeeded', value:'100123.400000000000006000', unit:'USD', input_ids:['reviewed-revenue'], input_snapshots:['original-file'], reasons:[], parameters:{ agent_execution:{ explanation:'Synthetic UI response only. No model or code execution was used.' } } } }).catch(() => {})
  }
  unexpected.push(`${route.request().method()} ${endpoint}`)
  return route.fulfill({ status:501, json:{ detail:'Live API requests are blocked by the regression fixture.' } })
})
const lab = () => page.getByRole('region', { name:'Calculation workspace', exact:true })
const dialog = () => page.getByRole('dialog', { name:'Review numeric input', exact:true })
const raw = () => lab().locator('tbody tr').filter({ hasText:'Raw: 100.123400000000000006' })
async function check(name, callback) { await callback(); results.push(name); console.log(`PASS ${name}`) }
try {
  await page.goto(`${base}tests/normalization-workflow.html`, { waitUntil:'networkidle' })
  await page.getByRole('button', { name:'New calculation', exact:true }).click()
  await lab().getByText('Calculation service ready', { exact:true }).waitFor()
  await check('Generate is actionable while incomplete and guides focus to the precise missing step without a model call', async () => {
    const generate = lab().getByRole('button', { name:'Generate and run calculation', exact:true })
    assert.equal(await generate.isEnabled(), true)
    await generate.click()
    assert.match(await lab().getByRole('alert').innerText(), /Describe the calculation/)
    assert.equal(await page.evaluate(() => document.activeElement.id), 'calculation-question')
    await lab().getByLabel('Calculation question', { exact:true }).fill('Explain this source amount without inventing its context.')
    await generate.click()
    assert.match(await lab().getByRole('alert').innerText(), /Select at least one source observation/)
    assert.equal(await page.evaluate(() => document.activeElement.id), 'calculation-input-heading')
    await raw().getByRole('checkbox').check()
    await generate.click()
    assert.match(await lab().getByRole('alert').innerText(), /Review numeric context/)
    assert.match(await page.locator('#calculation-readiness').innerText(), /review numeric context/)
    assert.equal(calculationRequests.length, 0)
  })
  await check('An ordinary raw spreadsheet value offers explicit review with immutable source provenance', async () => {
    await raw().getByRole('checkbox').check()
    await raw().getByRole('button', { name:/Review numeric context/ }).click()
    assert.equal(await dialog().locator('.normalization-original>code').textContent(), '100.123400000000000006')
    assert.match(await dialog().locator('.normalization-original').innerText(), /Row 2/)
    assert.equal(await dialog().getByRole('textbox', { name:'Unit', exact:true }).inputValue(), '')
    assert.equal(await dialog().getByRole('textbox', { name:'Exact scale multiplier', exact:true }).inputValue(), '')
    assert.equal(await dialog().getByRole('button', { name:'Save reviewed input', exact:true }).isDisabled(), true)
    await dialog().getByText('Source fingerprint and location', { exact:true }).click()
    assert.match(await dialog().innerText(), new RegExp('a'.repeat(64)))
    assert.equal(await dialog().locator('.normalization-original input').count(), 0)
  })
  await check('A failed save preserves exact metadata and a retry sends no replacement raw/final number', async () => {
    await dialog().getByRole('textbox', { name:'Metric key', exact:true }).fill('recognized_revenue')
    await dialog().getByRole('textbox', { name:'Unit', exact:true }).fill('USD')
    await dialog().getByRole('textbox', { name:'Currency (if monetary)', exact:true }).fill('usd')
    await dialog().getByRole('textbox', { name:'Exact scale multiplier', exact:true }).fill('1000')
    await dialog().getByRole('textbox', { name:'Normalization basis', exact:true }).fill('Checked the source header: thousand USD.')
    await dialog().getByRole('combobox', { name:'Period type', exact:true }).selectOption('duration')
    await dialog().getByLabel('Period start', { exact:true }).fill('2024-01-01')
    await dialog().getByLabel('Period end', { exact:true }).fill('2024-02-29')
    await dialog().getByRole('combobox', { name:'Actual or forecast', exact:true }).selectOption('actual')
    await dialog().getByRole('button', { name:'Save reviewed input', exact:true }).click()
    await dialog().getByRole('alert').filter({ hasText:'Fixture review service unavailable' }).waitFor()
    assert.equal(await dialog().getByRole('textbox', { name:'Exact scale multiplier', exact:true }).inputValue(), '1000')
    assert.equal(reviewRequests[0].scale_multiplier, '1000')
    assert.equal(reviewRequests[0].currency, 'USD')
    assert.equal(reviewRequests[0].period_start, '2024-01-01'); assert.equal(reviewRequests[0].period_end, '2024-02-29')
    assert.equal('raw_value' in reviewRequests[0], false); assert.equal('value' in reviewRequests[0], false)
    reviewMode = 'success'
    await dialog().getByRole('button', { name:'Save reviewed input', exact:true }).click()
    await lab().getByRole('status').filter({ hasText:'Reviewed input saved' }).waitFor()
    assert.equal(await dialog().count(), 0)
  })
  await check('The reviewed input is selected alongside its original and survives delayed report refresh', async () => {
    assert.equal(await lab().locator('tbody tr').count(), 2)
    assert.equal(await lab().locator('tbody input[type=checkbox]:checked').count(), 2)
    assert.equal(await raw().getByRole('checkbox').isChecked(), true)
    assert.equal(await page.getByLabel('Review refreshes').innerText(), '1')
    assert.equal(await page.getByLabel('Completed calculations').innerText(), '0')
    assert.match(await lab().innerText(), /100,123.400000000000006000 USD/)
    const updated = await page.evaluate(() => window.normalizationFixture.report)
    updated.report_id = 'evidence-v2'; updated.reported_metrics.push({ observation:reviewed, source:structuredClone(updated.reported_metrics[0].source), context:{ review_required:true, review_reasons:['human_metadata'] } })
    await page.evaluate(report => window.normalizationFixture.setReport(report), updated)
    assert.equal(await lab().locator('tbody tr').count(), 2)
    assert.equal(await lab().locator('tbody input[type=checkbox]:checked').count(), 2)
    await page.screenshot({ path:path.join(output,'reviewed-inputs.png'), animations:'disabled', fullPage:true })
  })
  await check('Unavailable model configuration explains recovery while leaving the complete calculation form intact', async () => {
    configured = false
    await lab().getByRole('button', { name:'Refresh configuration', exact:true }).click()
    await lab().getByText('Calculation service pending', { exact:true }).waitFor()
    await lab().getByRole('button', { name:'Generate and run calculation', exact:true }).click()
    assert.match(await lab().getByRole('alert').innerText(), /NICRRON_API_KEY/)
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('calculation-runtime')), true)
    assert.equal(calculationRequests.length, 0)
    configured = true
    await lab().getByRole('button', { name:'Refresh configuration', exact:true }).click()
    await lab().getByText('Calculation service ready', { exact:true }).waitFor()
  })
  await check('Stopping calculation waiting preserves inputs and a late response cannot replace a newer run', async () => {
    await lab().getByLabel('Calculation question', { exact:true }).fill('Explain the selected raw and reviewed input without double counting.')
    await lab().getByRole('button', { name:'Generate and run calculation', exact:true }).click()
    await page.waitForFunction(() => document.querySelector('.calculation-submit-actions')?.textContent?.includes('Stop waiting'))
    await requestGate('calculation API request before cancellation', () => releaseCalculation)
    await lab().getByRole('button', { name:'Stop waiting', exact:true }).click()
    assert.match(await lab().getByRole('alert').innerText(), /server may still finish/)
    assert.equal(await lab().locator('tbody input[type=checkbox]:checked').count(), 2)
    assert.equal(await lab().getByLabel('Calculation question', { exact:true }).inputValue(), 'Explain the selected raw and reviewed input without double counting.')
    calculateMode = 'success'; releaseCalculation(); releaseCalculation = null
    await lab().getByRole('button', { name:'Generate and run calculation', exact:true }).click()
    await page.getByLabel('Completed calculations').filter({ hasText:'1' }).waitFor()
    assert.deepEqual([...calculationRequests.at(-1).input_ids].sort(), ['raw-revenue','reviewed-revenue'])
    assert.equal(await lab().locator('.calculation-result').count(), 1)
  })
  await check('A source mismatch is rejected and the mobile review dialog remains reachable', async () => {
    reviewMode = 'invalid'
    await raw().getByRole('button', { name:/Review numeric context/ }).click()
    await dialog().getByRole('textbox', { name:'Unit', exact:true }).fill('USD')
    await dialog().getByRole('textbox', { name:'Exact scale multiplier', exact:true }).fill('1')
    await dialog().getByRole('textbox', { name:'Normalization basis', exact:true }).fill('Explicit test review.')
    await dialog().getByRole('button', { name:'Save reviewed input', exact:true }).click()
    await dialog().getByRole('alert').filter({ hasText:'did not match the original source' }).waitFor()
    await page.setViewportSize({ width:390, height:844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), true)
    await dialog().getByRole('button', { name:'Cancel', exact:true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path:path.join(output,'mobile-review.png'), animations:'disabled' })
    await dialog().getByRole('button', { name:'Cancel', exact:true }).click()
    assert.equal(await lab().locator('tbody tr').count(), 2)
  })
  await check('Stopping a pending numeric review retains entered metadata in its open dialog', async () => {
    reviewMode = 'delay'
    await raw().getByRole('button', { name:/Review numeric context/ }).click()
    await dialog().getByRole('textbox', { name:'Unit', exact:true }).fill('USD')
    await dialog().getByRole('textbox', { name:'Exact scale multiplier', exact:true }).fill('1000')
    await dialog().getByRole('textbox', { name:'Normalization basis', exact:true }).fill('Keep this explicit review rationale while stopping the request.')
    await dialog().getByRole('button', { name:'Save reviewed input', exact:true }).click()
    await requestGate('numeric review API request before cancellation', () => releaseReview)
    await dialog().getByRole('button', { name:'Stop waiting', exact:true }).click()
    assert.match(await dialog().getByRole('alert').innerText(), /entered metadata is preserved/)
    assert.equal(await dialog().getByRole('textbox', { name:'Exact scale multiplier', exact:true }).inputValue(), '1000')
    assert.equal(await dialog().getByRole('textbox', { name:'Normalization basis', exact:true }).inputValue(), 'Keep this explicit review rationale while stopping the request.')
    reviewMode = 'success'; releaseReview(); releaseReview = null
    await dialog().getByRole('button', { name:'Cancel', exact:true }).click()
    assert.equal(await lab().locator('tbody tr').count(), 2)
  })
  await check('Company-scoped calculation work survives tab navigation and filters stale or foreign selections', async () => {
    const question = 'Retain this question and exact financial parameters while changing pages.'
    const parameterText = '{"amount":"9007199254740993.0123456789","period_end":"2024-02-29"}'
    await lab().getByLabel('Calculation question', { exact:true }).fill(question)
    await lab().getByText('Optional calculation parameters', { exact:true }).click()
    await lab().getByLabel('Calculation parameters JSON', { exact:true }).fill(parameterText)
    await page.getByRole('button', { name:'Leave calculation page', exact:true }).click()
    assert.equal(await lab().count(), 0)
    await page.evaluate(() => {
      const key = 'acefire:calculation-workspace:v1:fixture-company', value = JSON.parse(localStorage.getItem(key))
      value.selectedIds.push('foreign-company-input'); value.premiseIds.push('foreign-premise')
      localStorage.setItem(key, JSON.stringify(value))
    })
    await page.getByRole('button', { name:'Return to calculation page', exact:true }).click()
    await page.getByRole('button', { name:'New calculation', exact:true }).click()
    await lab().getByText('Calculation service ready', { exact:true }).waitFor()
    assert.equal(await lab().getByLabel('Calculation question', { exact:true }).inputValue(), question)
    await lab().getByText('Optional calculation parameters', { exact:true }).click()
    assert.equal(await lab().getByLabel('Calculation parameters JSON', { exact:true }).inputValue(), parameterText)
    assert.equal(await lab().locator('tbody input[type=checkbox]:checked').count(), 2)
    const report = await page.evaluate(() => window.normalizationFixture.report)
    const another = { ...structuredClone(report), report_id:'other-company-evidence', company:{ ...report.company, deal_id:'another-fixture-company' }, reported_metrics:[], source_files:[] }
    await page.evaluate(value => window.normalizationFixture.setReport(value), another)
    await page.waitForFunction(() => document.querySelector('#calculation-question')?.value === '')
    assert.equal(await lab().locator('tbody input[type=checkbox]:checked').count(), 0)
    await page.evaluate(value => window.normalizationFixture.setReport(value), report)
    await page.waitForFunction(expected => document.querySelector('#calculation-question')?.value === expected, question)
    assert.equal(await lab().getByLabel('Calculation parameters JSON', { exact:true }).inputValue(), parameterText)
    assert.equal(calculationRequests.length, 2)
  })
  await check('The dashboard links to working uploads without claiming upload integration is pending', async () => {
    await page.getByRole('button', { name:'Open data room', exact:true }).click()
    assert.equal(await page.getByLabel('Fixture route').innerText(), '/project/fixture-company/data-room')
    assert.doesNotMatch(await page.locator('body').innerText(), /New uploads and Akta retrieval are awaiting/)
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  })
  await fs.writeFile(path.join(output,'results.json'), JSON.stringify({ passed:results, simulation:'All API requests intercepted; no provider or existing server calls.', review_requests:reviewRequests, calculation_requests:calculationRequests, errors, unexpected },null,2))
} catch (error) {
  await page.screenshot({ path:path.join(output,'failure.png'), animations:'disabled' }).catch(() => {})
  const pageState = await page.evaluate(() => ({
    viewport_width:innerWidth, document_width:document.documentElement.scrollWidth,
    overflowing:[...document.querySelectorAll('body *')].map(element=>({element,rect:element.getBoundingClientRect()})).filter(({element,rect})=>rect.width>0&&rect.right>innerWidth+1&&getComputedStyle(element).position!=='fixed').slice(0,15).map(({element,rect})=>({tag:element.tagName,class:element.className,left:rect.left,right:rect.right,width:rect.width,text:element.textContent?.slice(0,120)})),
    alerts:[...document.querySelectorAll('[role="alert"]')].map(element => element.textContent?.slice(0,1500)),
    runtime:document.querySelector('.calculation-runtime')?.textContent?.slice(0,1500),
    selected_inputs:document.querySelectorAll('.calculation-lab tbody input[type="checkbox"]:checked').length,
    buttons:[...document.querySelectorAll('button')].filter(button => /Generate|Save reviewed|Stop waiting/.test(button.textContent)).map(button => ({ text:button.textContent, disabled:button.disabled }))
  })).catch(reason => ({ diagnostic_error:String(reason) }))
  await fs.writeFile(path.join(output,'failure.json'), JSON.stringify({ passed:results, message:String(error), review_mode:reviewMode, calculation_mode:calculateMode, configured, waiting_gate:waitingGate, review_requests:reviewRequests.length, calculation_requests:calculationRequests.length, page_state:pageState, errors, unexpected },null,2))
  throw error
} finally { await context.close(); await browser.close(); await server.close() }
