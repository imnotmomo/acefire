import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runIfEnabled } from '../gate.mjs'

test('default/false/typo switches never execute the integration callback', async () => {
  for (const env of [{}, { ROUNDTABLE_ENABLED: 'false' }, { ROUNDTABLE_ENABLED: '1' }, { ROUNDTABLE_ALLOW_EVIDENCE_UPLOAD: '1' }]) {
    const result = await runIfEnabled(() => assert.fail('SDK/network path invoked'), { env, log: () => {} })
    assert.deepEqual(result, { status: 'disabled' })
  }
})

test('only explicit true enters the opt-in callback (no real SDK calls)', async () => {
  assert.equal(await runIfEnabled(() => 'local stub', { env: { ROUNDTABLE_ENABLED: 'true' } }), 'local stub')
})

for (const name of ['workers.mjs', 'ask.mjs']) {
  test(`${name}: disabled command succeeds without keys or SDK access`, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../${name}`, import.meta.url))], {
      env: { PATH: process.env.PATH, ROUNDTABLE_ENABLED: 'false', ACEFIRE_ROUNDTABLE_ENV: '/does-not-exist' },
      encoding: 'utf8', timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /integration is disabled/)
    assert.equal(result.stderr, '')
  })
}
