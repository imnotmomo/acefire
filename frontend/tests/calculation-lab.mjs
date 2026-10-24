import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { formatLocator } from '../src/backend.ts'

// UI contract checks use existing source records and a clearly simulated model run.
// They never call a model provider or execute generated code.
const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5174'
const output = path.resolve('test-results/calculation-lab')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}), headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } })
const page = await context.newPage()
const errors = []
const requests = []
const passed = []
page.on('pageerror', error => errors.push(error.message))
context.on('request', request => { if (request.method() !== 'GET') requests.push({ method: request.method(), url: request.url() }) })
async function check(name, callback) { await callback(); passed.push(name); console.log(`PASS ${name}`) }
try {
  const originalResponse = await context.request.get(`${base}/api/deals/circle-2025-ipo/report`)
  assert.equal(originalResponse.status(), 200, 'Start the prepared Circle backend and frontend proxy before these tests.')
  const original = await originalResponse.json()
  const baseline = original.calculations.find(item => item.calculation.status === 'succeeded' && item.inputs.length === 2)
  assert.ok(baseline, 'The Circle demo needs its stored two-input calculation.')
  const sentenceField = original.primary_profile.field_lineage.fields.find(field => typeof field.value === 'string' && field.field_path === '/firmographic/company_description_short')
  assert.ok(sentenceField, 'The stored Circle profile needs its source-bound company description.')
  const premiseId = `field:${sentenceField.source.snapshot_id}:${sentenceField.field_path}`
  const calculation = structuredClone(baseline.calculation)
  const originalId = calculation.id
  const generatedId = 'a91698b5-0450-48b9-8b06-594f17ad90ab'
  calculation.id = generatedId
  calculation.metric_key = 'agent.assets_total'
  calculation.function_key = 'llm_local_python'
  calculation.function_version = 'a'.repeat(64)
  calculation.parameters = { agent_execution: { mode: 'llm_local', executor: 'local_python', model: 'openai/gpt-6.1-sol', generation_provider: 'nicrron', execution_id: 'ui-contract-test-execution', question: 'Explain the sum of these two source components.', code: 'from decimal import Decimal\n\ndef calculate(inputs, parameters):\n    # Simulated UI test only.\n    return {"status": "insufficient_data", "value": None}\n', code_sha256: 'a'.repeat(64), input_manifest_sha256: 'b'.repeat(64), executed_at: '2026-10-24T17:00:00Z', exit_code: 0, cleanup_succeeded: true, stdout: JSON.stringify({ value: calculation.value, unit: calculation.unit }), stderr: '', explanation: 'The selected source inputs and arithmetic are recorded for review.', assumptions: ['Source components retain the source accounting scope.'], limitations: ['This is a simulated execution record for UI testing.'] } }
  calculation.parameters.agent_execution.supplied_text_evidence = [{ id: premiseId, text: sentenceField.value, source: sentenceField.source }]
  calculation.parameters.agent_execution.premises = [{ evidence_id: premiseId, quote: sentenceField.value, role: 'definition_context', reason: 'The model uses this source description as context; it does not establish accounting equivalence.', source: sentenceField.source }]
  const added = { ...structuredClone(baseline), calculation }
  added.nodes = added.nodes.map(node => ({ ...node, id: node.id.replace(originalId, generatedId), data: node.data.kind === 'calculation' ? { ...node.data, label: calculation.metric_key, calculation } : node.data }))
  added.edges = added.edges.map(edge => ({ ...edge, id: edge.id.replaceAll(originalId, generatedId), source: edge.source.replaceAll(originalId, generatedId), target: edge.target.replaceAll(originalId, generatedId) }))
  const sentenceNodeId = `text:${premiseId}`
  const sentenceFileNodeId = `file:${sentenceField.source.snapshot_id}`
  added.nodes.push({ id: sentenceFileNodeId, type: 'default', position: { x: 0, y: 430 }, data: { kind: 'source_file', label: sentenceField.source.file_name, source: sentenceField.source } }, { id: sentenceNodeId, type: 'default', position: { x: 360, y: 430 }, data: { kind: 'text_evidence', label: 'Company description source text', text: sentenceField.value, quote: sentenceField.value, source: sentenceField.source } })
  added.edges.push({ id: 'sentence-source-edge', source: sentenceFileNodeId, target: sentenceNodeId }, { id: 'sentence-premise-edge', source: sentenceNodeId, target: `calculation:${generatedId}` })
  const updated = structuredClone(original)
  updated.report_id = 'ui-contract-test-report-after-generation'
  updated.calculations = [added, ...updated.calculations]
  let configured = false
  let runCount = 0
  let lastPayload
  await page.route('**/api/calculation-runtime', route => route.fulfill({ json: { mode: 'llm_local', configured, model: 'openai/gpt-6.1-sol', generation_provider: 'nicrron', executor: 'local_python', missing: configured ? [] : ['NICRRON_API_KEY'], maximum_inputs: 100 } }))
  await page.route('**/api/deals/circle-2025-ipo/report', route => route.fulfill({ json: runCount >= 2 ? updated : original }))
  await page.route('**/api/deals/circle-2025-ipo/calculate/agent', async route => {
    runCount++
    lastPayload = route.request().postDataJSON()
    if (runCount === 1) return route.fulfill({ status: 503, json: { detail: { message: 'Generation temporarily unavailable.' } } })
    return route.fulfill({ json: calculation })
  })
  await page.goto(`${base}/#/project/circle/dashboard`, { waitUntil: 'networkidle' })
  const lab = page.getByRole('region', { name: 'Calculation workspace', exact: true })
  await lab.waitFor()
  await check('Pending model configuration is explicit and generation stays disabled', async () => {
    await lab.getByText('Calculation service pending', { exact: true }).waitFor()
    assert.match(await lab.innerText(), /NICRRON_API_KEY/)
    assert.equal(await lab.getByRole('button', { name: 'Generate and run calculation', exact: true }).isDisabled(), true)
    assert.equal(await lab.locator('input[type=password]').count(), 0)
  })
  await check('Selected inputs retain exact period and source locations', async () => {
    await lab.getByLabel('Calculation question', { exact: true }).fill('Explain the sum of these two source components.')
    for (const input of baseline.inputs) {
      await lab.getByLabel('Search calculation inputs', { exact: true }).fill(input.observation.raw_label)
      const row = lab.locator('tbody tr').filter({ hasText: formatLocator(input.source.locator) })
      await row.getByRole('checkbox').check()
      assert.match(await row.innerText(), new RegExp(input.observation.period_end))
    }
    assert.equal(await lab.locator('.calculation-selected:not(.calculation-selected-premises)>button').count(), 2)
    configured = true
    await lab.getByRole('button', { name: 'Refresh configuration', exact: true }).click()
    await lab.getByText('Calculation service ready', { exact: true }).waitFor()
  })
  await check('Original sentence evidence can be selected with its exact field ID and source pointer', async () => {
    await lab.getByText('Optional source-text context for this calculation', { exact: true }).click()
    const premises = lab.getByRole('region', { name: 'Sentence evidence and premises', exact: true })
    await premises.getByLabel('Search sentence evidence', { exact: true }).fill(sentenceField.field_path)
    const card = premises.locator('.calculation-premise-card').filter({ hasText: formatLocator(sentenceField.source.locator) })
    assert.equal(await card.locator('blockquote').textContent(), sentenceField.value)
    await card.getByRole('checkbox').check()
    assert.equal(await premises.locator('.calculation-selected-premises>button').count(), 1)
  })
  await check('Invalid parameter JSON cannot submit and provider errors preserve the form', async () => {
    await lab.getByText('Optional calculation parameters', { exact: true }).click()
    await lab.getByLabel('Calculation parameters JSON', { exact: true }).fill('[')
    await lab.getByRole('button', { name: 'Generate and run calculation', exact: true }).click()
    await lab.getByRole('alert').waitFor()
    assert.equal(runCount, 0)
    await lab.getByLabel('Calculation parameters JSON', { exact: true }).fill('{"period_end":"2024-12-31"}')
    await lab.getByRole('button', { name: 'Generate and run calculation', exact: true }).click()
    await lab.getByText('Generation temporarily unavailable.', { exact: true }).waitFor()
    assert.equal(await lab.getByLabel('Calculation question', { exact: true }).inputValue(), 'Explain the sum of these two source components.')
    assert.equal(await lab.locator('.calculation-selected:not(.calculation-selected-premises)>button').count(), 2)
    assert.deepEqual([...lastPayload.input_ids].sort(), [...calculation.input_ids].sort())
    assert.deepEqual(lastPayload.parameters, { period_end: '2024-12-31' })
    assert.deepEqual(lastPayload.premise_ids, [premiseId])
  })
  await check('Successful generated calculation refreshes the report and opens code execution provenance', async () => {
    await lab.getByRole('button', { name: 'Generate and run calculation', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect Assets total', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Inspect Assets total', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Evidence inspector', exact: true })
    await dialog.getByRole('tab', { name: 'Execution', exact: true }).click()
    assert.match(await dialog.innerText(), /Local Python worker/)
    assert.match(await dialog.innerText(), /openai\/gpt-6.1-sol/)
    assert.match(await dialog.innerText(), new RegExp('a'.repeat(64)))
    assert.match(await dialog.innerText(), new RegExp('b'.repeat(64)))
    assert.match(await dialog.getByLabel('Generated calculation Python', { exact: true }).innerText(), /def calculate/)
    assert.match(await dialog.innerText(), /simulated execution record/)
    const cited = dialog.getByRole('region', { name: 'Cited source premises', exact: true })
    assert.equal(await cited.locator('.connected-quoted-premise blockquote').textContent(), sentenceField.value)
    assert.match(await cited.innerText(), new RegExp(sentenceField.source.sha256))
    assert.match(await cited.innerText(), /definition_context/)
    assert.equal(await cited.getByRole('link', { name: 'Open premise source', exact: true }).getAttribute('href'), `/api${sentenceField.source.preview_url}`)
    await page.screenshot({ path: path.join(output, 'generated-execution-inspector.png'), animations: 'disabled' })
    await dialog.getByRole('tab', { name: 'Evidence', exact: true }).click()
    assert.match(await dialog.innerText(), /I49/)
    assert.match(await dialog.innerText(), /I53/)
    assert.equal(await dialog.locator('.connected-quoted-premise blockquote').textContent(), sentenceField.value)
    assert.match(await dialog.locator('.connected-cited-premises').innerText(), new RegExp(formatLocator(sentenceField.source.locator).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await dialog.getByRole('tab', { name: 'Lineage', exact: true }).click()
    await dialog.locator('.connected-graph-node.text').click()
    assert.equal(await dialog.locator('.connected-node-quote').textContent(), sentenceField.value)
    await page.keyboard.press('Escape')
  })
  await check('Mobile calculation workspace remains usable without upload or Akta calls', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${base}/#/project/circle/dashboard`, { waitUntil: 'networkidle' })
    await page.getByRole('region', { name: 'Calculation workspace', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true)
    await page.screenshot({ path: path.join(output, 'calculation-mobile.png'), animations: 'disabled', fullPage: true })
    assert.equal(requests.length, 2)
    assert.equal(requests.every(request => request.method === 'POST' && request.url.endsWith('/calculate/agent')), true)
    assert.deepEqual(errors, [])
  })
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ passed, simulation: 'Mocked model execution; source inputs from existing Circle report', mutations: requests, page_errors: errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ passed, message: String(error), errors }, null, 2))
  throw error
} finally { await browser.close() }
