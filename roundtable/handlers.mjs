import { createHash } from 'node:crypto'

function allowed(config, dealId) {
  if (!config.allowUpload) throw new Error('Evidence uploads are disabled. Authorize the Roundtable destination before enabling ROUNDTABLE_ALLOW_EVIDENCE_UPLOAD=1.')
  if (!config.allowedDeals.has(dealId)) throw new Error('Deal is not enabled for this Roundtable worker.')
}
function pathFor(runId, filename) {
  if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId)) throw new Error('Invalid run ID.')
  return `acefire/chat/${runId}/${filename}`
}
async function json(response) {
  if (!response.ok) throw new Error(`Local evidence API failed (${response.status}).`)
  return response.json()
}

export function handlers(config, request = fetch) {
  return {
    async answer(task, ctx) {
      const { deal_id: dealId, question, run_id: runId } = task.input || {}
      allowed(config, dealId)
      if (typeof question !== 'string' || !question.trim() || question.length > 4000) throw new Error('Invalid question.')
      const path = pathFor(runId, 'answer.json')
      await ctx.progress('Retrieving evidence, generating answer and checking source support through the local API.')
      const reply = await json(await request(`${config.backend}/deals/${encodeURIComponent(dealId)}/evidence-chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }),
        signal: AbortSignal.timeout(150000),
      }))
      validateReply(reply)
      const saved = await ctx.save(path, JSON.stringify({ run_id: runId, deal_id: dealId, question, reply }), 'Source-bound answer and evidence excerpts from Acefire')
      return { summary: `Answer ${reply.status}; ${reply.sources.length} source citations.`, sources: [saved], data: { run_id: runId, deal_id: dealId, answer: saved } }
    },
    async reviewer(task, ctx) {
      const { deal_id: dealId, run_id: runId, answer: source } = task.input || {}
      allowed(config, dealId)
      const expected = pathFor(runId, 'answer.json')
      if (!source || source.bank !== config.project || source.path !== expected || typeof source.version !== 'string' || !/^[a-f0-9]{12}$/.test(source.version)) throw new Error('Expected a version-pinned answer in this project/run.')
      const reading = await ctx.read(source.path, { version: source.version })
      if (JSON.stringify(reading.source) !== JSON.stringify(source)) {
        if (!reading.source || ['bank','path','version'].some(k => reading.source[k] !== source[k])) throw new Error('Answer file version changed.')
      }
      const packet = JSON.parse(reading.content)
      if (packet.run_id !== runId || packet.deal_id !== dealId) throw new Error('Answer crosses a run/deal boundary.')
      validateReply(packet.reply)
      const registered = await json(await request(`${config.backend}/deals/${encodeURIComponent(dealId)}/sources`, { signal: AbortSignal.timeout(15000) }))
      const snapshots = new Map(registered.map(s => [s.id, s]))
      const checked = new Set()
      for (const citation of packet.reply.sources) {
        const source = citation.source
        const snapshot = snapshots.get(source.snapshot_id)
        if (!snapshot || snapshot.deal_id !== dealId || snapshot.sha256 !== source.sha256) throw new Error('Citation is not a registered source version for this deal.')
        const expectedUrl = `/sources/${encodeURIComponent(source.snapshot_id)}/file`
        if (source.preview_url !== expectedUrl || !source.locator || !Object.keys(source.locator).length) throw new Error('Citation file URL/locator is invalid.')
        if (checked.has(source.snapshot_id)) continue
        const response = await request(config.backend + expectedUrl, { signal: AbortSignal.timeout(30000) })
        if (!response.ok) throw new Error('Original source is unavailable or changed.')
        const hash = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')
        if (hash !== source.sha256) throw new Error('Original SHA-256 verification failed.')
        checked.add(source.snapshot_id)
      }
      const review = {
        run_id: runId, deal_id: dealId, status: 'passed', answer: source,
        checks: { citation_membership: true, deal_isolation: true, pinned_answer_version: true, original_sha256: true, originals_checked: checked.size },
        verification: 'File/citation integrity only. Semantic support was checked by the local Nicrron workflow; company assertions are not independently verified.',
      }
      const saved = await ctx.save(pathFor(runId, 'review.json'), JSON.stringify(review), 'Version-pinned citation and original-file integrity review')
      return { summary: 'Citation and original-file integrity checks passed.', sources: [source, saved], data: review }
    },
  }
}

export function validateReply(reply) {
  if (!reply || !['answered','insufficient_evidence'].includes(reply.status) || !Array.isArray(reply.sources) || !Array.isArray(reply.statements)) throw new Error('Invalid evidence answer.')
  if (typeof reply.answer !== 'string') throw new Error('Answer text missing.')
  const sources = new Set(reply.sources.map(s => s.id))
  if (sources.size !== reply.sources.length) throw new Error('Duplicate citations.')
  if (reply.status === 'answered' && (!reply.statements.length || !sources.size)) throw new Error('Factual answer has no citations.')
  if (reply.status === 'insufficient_evidence' && (reply.statements.length || sources.size)) throw new Error('Insufficient-evidence answer contains unvalidated claims.')
  for (const statement of reply.statements) {
    if (typeof statement.text !== 'string' || !statement.text.trim() || !Array.isArray(statement.source_ids) || !statement.source_ids.length || statement.source_ids.some(id => !sources.has(id))) throw new Error('Statement references unknown or missing citations.')
  }
}
