import { settings } from './config.mjs'
import { handlers } from './handlers.mjs'
import { runIfEnabled } from './gate.mjs'

await runIfEnabled(async () => {
  const { Roundtable } = await import('@roundtable/sdk')
  const config = settings()
  if (!config.allowUpload) throw new Error('Roundtable evidence upload is not enabled; see backend/ROUNDTABLE.md.')
  const stop = new AbortController()
  process.once('SIGINT', () => stop.abort())
  process.once('SIGTERM', () => stop.abort())
  const handle = handlers(config)
  await Promise.all(['answer','reviewer'].map(role => {
    const identity = config.identity(role)
    return new Roundtable({ key: identity.key, url: config.url })
      .bot({ name: identity.name, project: config.project, skills: [role === 'answer' ? 'Answer VC questions using source-bound Acefire evidence' : 'Validate pinned citations and original source hashes'] })
      .onTask(handle[role]).run({ signal: stop.signal, pollMs: 1000, maxIdleMs: 2000 })
  }))
})
