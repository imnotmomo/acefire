import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseCompanyReport, reportEvidence } from '../src/backend.ts'

const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5173'
const artifacts = path.resolve('test-results/company-chat')
await fs.mkdir(artifacts, { recursive: true })
const dealId = 'circle-2025-ipo'
const file = { snapshot_id: 'finance-source', file_name: 'company.xlsx', sha256: 'a'.repeat(64), provider: 'orbis', ingestion_channel: 'user_upload', data_role: 'supplemental_evidence', visibility: 'deal_private', preview_url: '/sources/finance-source/file', locator: { kind: 'xlsx_cell', sheet: 'Finance', cell: 'A1' } }
const document = { ...file, snapshot_id: 'document-source', file_name: 'company.pdf', provider: 'uploaded', sha256: 'b'.repeat(64), preview_url: 'https://storage.example.test/company.pdf?token=temporary-review-grant', locator: { kind: 'pdf_page', page: 2 } }
const metrics = Array.from({ length: 25 }, (_, index) => {
  const observation = { id: `observation-${index + 1}`, deal_id: dealId, entity_key: 'circle', snapshot_id: file.snapshot_id, provider: 'orbis', metric_key: `orbis.metric_${index + 1}`, raw_label: `Metric ${index + 1}`, raw_value: String(index + 1), value: String(index + 1), unit: 'USD', currency: 'USD', scale_multiplier: '1', normalization_status: 'confirmed', normalization_basis: 'source unit', definition_key: null, scope: 'Consolidated', accounting_basis: 'US GAAP', period_kind: 'instant', period_label: 'FY2024', period_start: null, period_end: '2024-12-31', scenario: 'actual', verification_status: 'source_located', locator: { kind: 'xlsx_cell', sheet: 'Finance', cell: `A${index + 1}` }, quarantined: false, notes: [] }
  return { observation, source: { ...file, locator: observation.locator }, context: { review_required: true, review_reasons: ['definition_not_reviewed'] } }
})
const numeric = metrics[0]
const calculation = { id: 'calculation-1', deal_id: dealId, metric_key: 'recorded_metric', function_key: 'stored_fixture', function_version: '1', formula: 'recorded input', status: 'succeeded', value: '1', unit: 'USD', input_ids: [numeric.observation.id], input_snapshots: [file.snapshot_id], parameters: {}, reasons: [] }
let report = parseCompanyReport({
  report_id: 'chat-report-1', report_version: '1', generated_at_utc: '2026-10-24T12:00:00Z', company: { deal_id: dealId, legal_name: 'Circle', entity_key: 'circle', domain: 'circle.com', country: 'USA', primary_provider: 'akta', historical_cutoff: null, identifiers: {} },
  primary_profile: { available: false, provider: 'akta', records: [], field_lineage: { fields: [], sources: [], nodes: [], edges: [] } },
  reported_metrics: metrics, calculations: [{ calculation, inputs: [{ input_order: 1, input_role: 'source input', ...numeric }], sources: [numeric.source], nodes: [], edges: [], reasons: [], explanation_steps: [], conflict_numbers: false, conflicts: [] }],
  comparisons: [], source_files: [file, document], coverage: [], gaps: [], summary: {}, data_period_coverage: [], source_graph: { nodes: [], edges: [] }, conflict_numbers: false, conflicts: [], flags: [],
  document_claims: [{ id: 'claim-1', deal_id: dealId, entity_key: 'circle', snapshot_id: document.snapshot_id, statement: 'Company business description', claim_type: 'company_description', extractor_version: 'fixture-1', evidence: [{ snapshot_id: document.snapshot_id, quote: 'Circle builds payment infrastructure.', locator: document.locator, quote_match_rule: 'normalized_whitespace' }], limitations: [] }],
})
const evidence = reportEvidence(report)
const sentence = evidence.find(item => item.kind === 'statement')
const offscreen = evidence.find(item => item.id === 'observation-25')
const citation = { evidence_id: sentence.id, quote: sentence.citationText || sentence.excerpt, source: document, quote_match_rule: 'normalized_whitespace' }
const config = { topics: ['Company profile'], depth: 'Standard', geography: 'Global', horizon: 'Source period', scope: 'Internal only', focus: '' }
const working = { id: 'overview', title: 'Company overview', content: 'Reviewer working draft: confirm company scope.', evidenceIds: [sentence.id], config, humanEdited: true,
  sourceClaims: [{ id: 'draft-claim', text: 'Circle builds payment infrastructure.', kind: 'reported_summary', citations: [{ ...citation, kind: 'statement', quote_basis: 'source_text' }] }] }

const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}), headless: true })
const results = []
async function check(name, callback) { await callback(); results.push(name); console.log(`PASS ${name}`) }
const contexts = []
async function workspace() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } }); contexts.push(context)
  const page = await context.newPage()
  const requests = [], external = [], errors = []
  const attempts = new Map()
  page.on('pageerror', error => errors.push(error.message))
  await context.addInitScript(({ working, config }) => localStorage.setItem('acefire:workspace:v1:circle', JSON.stringify({ order: ['overview'], configs: { overview: config }, sections: [working], revisions: [], generatedAt: '2026-10-24T12:00:00Z', backendReportId: 'chat-report-1' })), { working, config })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(base).origin) { external.push(url.href); await route.abort(); return }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return }
    if (url.pathname === `/api/deals/${dealId}/report`) { await route.fulfill({ json: report }); return }
    if (url.pathname !== `/api/deals/${dealId}/chat`) { await route.fulfill({ status: 501, json: { detail: 'Mock service unavailable' } }); return }
    const body = route.request().postDataJSON(); requests.push({ body, headers: route.request().headers() })
    const count = (attempts.get(body.question) || 0) + 1; attempts.set(body.question, count)
    const reply = { deal_id: dealId, report_id: report.report_id, state: 'verify', answer: 'Circle builds payment infrastructure.', citations: [citation] }
    if (body.question === 'Pending service question' && count === 1) { await route.fulfill({ status: 503, json: { detail: 'Do not expose provider exception or keys' } }); return }
    if (body.question === 'Pending service question' || body.question === 'What is missing?') Object.assign(reply, { state: 'missing', answer: 'A recurring revenue definition has not been supplied.', citations: [] })
    if (body.question === 'Explain Metric 25.') Object.assign(reply, { answer: 'Metric 25 is recorded as 25 USD.', citations: [{ evidence_id: offscreen.id, quote: offscreen.citationText || offscreen.excerpt }] })
    if (body.question === 'Show conflicts.') Object.assign(reply, { state: 'conflict', answer: 'The reported records need comparison before choosing a value.', citations: [{ evidence_id: offscreen.id, quote: offscreen.citationText || offscreen.excerpt }] })
    if (body.question === 'Wrong company response') Object.assign(reply, { deal_id: 'another-company', answer: 'FOREIGN_ANSWER_DO_NOT_DISPLAY' })
    if (body.question === 'Wrong report response') Object.assign(reply, { report_id: 'old-report', answer: 'STALE_ANSWER_DO_NOT_DISPLAY' })
    if (body.question === 'Invalid quotation response') Object.assign(reply, { answer: 'UNSUPPORTED_QUOTE_ANSWER', citations: [{ evidence_id: sentence.id, quote: 'An invented quote that is not in the document.' }] })
    if (body.question === 'Uncited response') Object.assign(reply, { answer: 'UNSUPPORTED_UNCITED_ANSWER', citations: [] })
    if (body.question === 'Unknown state response') Object.assign(reply, { state: 'verified', answer: 'UNSUPPORTED_STATE_ANSWER' })
    if (body.question === 'Plain text response') Object.assign(reply, { answer: 'Circle builds payment infrastructure.\n<img src="https://untrusted.example.test/never-load" onerror="window.chatInjected=true">' })
    await route.fulfill({ json: reply })
  })
  await page.goto(`${base}/#/project/circle/dashboard`, { waitUntil: 'networkidle' })
  await page.getByText('Stored company report connected', { exact: true }).waitFor()
  await page.locator('.assistant-launcher').click()
  await page.getByRole('dialog', { name: 'Company chat', exact: true }).waitFor()
  return { page, context, requests, external, errors }
}
async function ask(page, question) {
  const input = page.getByRole('textbox', { name: 'Ask about this company', exact: true })
  await input.fill(question); await input.press('Enter')
}
try {
  const happy = await workspace()
  await check('Chat requests the entire company context and labels working drafts as unverified', async () => {
    assert.match(await happy.page.locator('.company-chat-context').innerText(), /2 files · 1 document claim · 25 observations · 1 calculation/)
    await ask(happy.page, 'Summarize Circle with sources.')
    await happy.page.locator('.company-chat-message.assistant').waitFor()
    const { body } = happy.requests[0]
    assert.equal(body.context_scope, 'entire_company'); assert.equal(body.report_id, 'chat-report-1')
    assert.equal(body.page, 'Dashboard'); assert.deepEqual(body.history, [])
    assert.equal(body.working_draft.verification, 'unverified_human_draft')
    assert.match(body.working_draft.sections[0].content, /Reviewer working draft/)
    assert.equal(JSON.stringify(body).includes('temporary-review-grant'), false)
    assert.equal('report' in body, false); assert.equal('api_key' in body, false)
    assert.match(await happy.page.locator('.company-chat-guidance').innerText(), /Needs review/)
    assert.equal(await happy.page.locator('.company-chat-message.assistant .badge').innerText(), 'Verify')
  })
  await check('Exact quoted evidence opens canonical inspection and history never stores signed URLs', async () => {
    await happy.page.locator('.company-chat-citations summary').click()
    assert.equal(await happy.page.locator('.company-chat-citations blockquote').innerText(), citation.quote)
    const cached = await happy.page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('acefire:company-chat:')))
    assert.equal(JSON.stringify(cached).includes('temporary-review-grant'), false)
    assert.equal(JSON.stringify(cached).includes('preview_url'), false)
    await happy.page.getByRole('button', { name: `Inspect ${sentence.title} evidence`, exact: true }).click()
    await happy.page.getByRole('dialog', { name: 'Evidence inspector', exact: true }).waitFor()
    await happy.page.keyboard.press('Escape'); await happy.page.locator('.assistant-launcher').click()
    assert.equal(await happy.page.locator('.company-chat-message.assistant').count(), 1)
  })
  await check('Company chat can cite evidence beyond the currently displayed dashboard rows', async () => {
    assert.equal(await happy.page.locator('.connected-observations tbody tr').count(), 20)
    await ask(happy.page, 'Explain Metric 25.')
    await happy.page.locator('.company-chat-message.assistant').nth(1).waitFor()
    assert.equal(happy.requests[1].body.history.length, 2)
    assert.equal(happy.requests[1].body.history[0].role, 'user'); assert.equal(happy.requests[1].body.history[1].role, 'assistant')
    await happy.page.getByRole('button', { name: 'Inspect Metric 25 evidence', exact: true }).click()
    await happy.page.getByRole('dialog', { name: 'Evidence inspector', exact: true }).waitFor()
    assert.match(await happy.page.getByRole('dialog', { name: 'Evidence inspector' }).innerText(), /25 USD/)
    await happy.page.keyboard.press('Escape'); await happy.page.locator('.assistant-launcher').click()
  })
  await check('Missing and Conflict are explicit states with no approval workflow', async () => {
    await ask(happy.page, 'What is missing?'); await happy.page.locator('.company-chat-message.assistant').nth(2).waitFor()
    assert.equal(await happy.page.locator('.company-chat-message.assistant').nth(2).locator('.badge').innerText(), 'Missing')
    await ask(happy.page, 'Show conflicts.'); await happy.page.locator('.company-chat-message.assistant').nth(3).waitFor()
    assert.equal(await happy.page.locator('.company-chat-message.assistant').nth(3).locator('.badge').innerText(), 'Conflict')
    assert.equal(await happy.page.getByRole('button', { name: /approve|resolve|authoritative/i }).count(), 0)
  })
  await check('Unavailable chat keeps the question and retries without duplicating its user turn', async () => {
    const pending = await workspace()
    await ask(pending.page, 'Pending service question')
    await pending.page.getByRole('alert').waitFor()
    assert.match(await pending.page.getByRole('alert').innerText(), /waiting for the team service/)
    assert.equal(await pending.page.locator('.company-chat-message.assistant').count(), 0)
    await pending.page.getByRole('button', { name: 'Retry question', exact: true }).click()
    await pending.page.locator('.company-chat-message.assistant').waitFor()
    assert.equal(await pending.page.locator('.company-chat-message.user').count(), 1)
    assert.equal(pending.requests.length, 2); assert.deepEqual(pending.requests[0].body, pending.requests[1].body)
  })
  await check('Answers remain plain text and never execute returned HTML or external requests', async () => {
    const plain = await workspace(); await ask(plain.page, 'Plain text response')
    const answer = plain.page.locator('.company-chat-message.assistant')
    await answer.waitFor()
    assert.match(await answer.locator('.company-chat-answer').innerText(), /\n<img/)
    assert.equal(await answer.locator('img').count(), 0)
    assert.equal(await plain.page.evaluate(() => window.chatInjected), undefined)
    assert.deepEqual(plain.external, [])
  })
  for (const [question, sentinel] of [['Wrong company response', 'FOREIGN_ANSWER_DO_NOT_DISPLAY'], ['Wrong report response', 'STALE_ANSWER_DO_NOT_DISPLAY'], ['Invalid quotation response', 'UNSUPPORTED_QUOTE_ANSWER'], ['Uncited response', 'UNSUPPORTED_UNCITED_ANSWER'], ['Unknown state response', 'UNSUPPORTED_STATE_ANSWER']]) {
    await check(`Unsupported answer fails closed: ${question}`, async () => {
      const invalid = await workspace(); await ask(invalid.page, question); await invalid.page.getByRole('alert').waitFor()
      assert.equal(await invalid.page.locator('.company-chat-message.assistant').count(), 0)
      assert.equal((await invalid.page.getByRole('dialog', { name: 'Company chat' }).innerText()).includes(sentinel), false)
      assert.equal(await invalid.page.locator('.company-chat-message.user').count(), 1)
    })
  }
  await check('Report refresh scopes old history away, with responsive keyboard-accessible chat', async () => {
    await happy.page.keyboard.press('Escape')
    report = { ...report, report_id: 'chat-report-2' }
    await happy.page.reload({ waitUntil: 'networkidle' }); await happy.page.getByText('Stored company report connected', { exact: true }).waitFor()
    await happy.page.setViewportSize({ width: 390, height: 844 })
    await happy.page.getByRole('button', { name: 'Toggle navigation', exact: true }).click()
    await happy.page.keyboard.press('Escape')
    // Close mobile navigation by its overlay if Escape is not a navigation shortcut.
    const overlay = happy.page.getByRole('button', { name: 'Close navigation', exact: true })
    if (await overlay.count()) await overlay.click()
    await happy.page.locator('.assistant-launcher').click()
    assert.equal(await happy.page.locator('.company-chat-message').count(), 0)
    assert.equal(await happy.page.getByRole('textbox', { name: 'Ask about this company', exact: true }).evaluate(element => document.activeElement === element), true)
    assert.equal(await happy.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    const dialog = happy.page.getByRole('dialog', { name: 'Company chat', exact: true })
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
    await happy.page.screenshot({ path: path.join(artifacts, 'company-chat-mobile.png'), fullPage: false, animations: 'disabled' })
    await happy.page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0)
    assert.deepEqual(happy.external, []); assert.deepEqual(happy.errors, [])
  })
  await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ passed: results, mocked_company_data: true, live_model_calls: 0 }, null, 2))
} catch (error) {
  await fs.writeFile(path.join(artifacts, 'failure.json'), JSON.stringify({ passed: results, error: String(error) }, null, 2))
  throw error
} finally { await Promise.all(contexts.map(context => context.close())); await browser.close() }
