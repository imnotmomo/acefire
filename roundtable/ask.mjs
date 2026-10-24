import { randomUUID } from 'node:crypto'
import { settings } from './config.mjs'
import { runIfEnabled } from './gate.mjs'

await runIfEnabled(async () => {
  const { Roundtable } = await import('@roundtable/sdk')
  const config = settings()
  if (!config.allowUpload) throw new Error('Roundtable evidence upload is not enabled; see backend/ROUNDTABLE.md.')
  const [dealId, ...questionParts] = process.argv.slice(2)
  const question = questionParts.join(' ').trim()
  if (!config.allowedDeals.has(dealId) || !question || question.length > 4000) throw new Error('Usage: node ask.mjs <enabled-deal-id> "question"')
  const rt = new Roundtable({ key: config.identity('coordinator').key, url: config.url })
  const runId = randomUUID()
  async function dispatch(role, input) {
    const job = await rt.dispatch([{ bot: config.identity(role).id, goal: role === 'answer' ? 'Answer this question from registered evidence and cite all facts.' : 'Verify the exact answer version, citations and original source hashes.', input }], { project: config.project })
    const [outcome] = await job.gather({ timeoutMs: 300000 })
    if (outcome.status !== 'done') throw new Error(`${role} task blocked; inspect the Roundtable task.`)
    return outcome.result.data
  }
  const result = await dispatch('answer', { run_id: runId, deal_id: dealId, question })
  const review = await dispatch('reviewer', { run_id: runId, deal_id: dealId, answer: result.answer })
  if (review.status !== 'passed') throw new Error('Review failed; answer withheld.')
  const file = await rt.call('read_file', { bank: result.answer.bank, path: result.answer.path, version: result.answer.version })
  const packet = JSON.parse(file.content)
  console.log(JSON.stringify({ ...packet.reply, roundtable: { run_id: runId, answer: result.answer, review } }, null, 2))
})
