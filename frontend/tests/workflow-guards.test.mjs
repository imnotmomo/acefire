import test from 'node:test'
import assert from 'node:assert/strict'
import { waitForFixtureGate, runTestProcess } from './workflowGuards.mjs'

test('fixture gate returns the observed request and a missing request fails with its name', async () => {
  let gate = null
  const timer = setTimeout(() => { gate = () => 'released' }, 10)
  const ready = await waitForFixtureGate('expected report request', () => gate, 500)
  clearTimeout(timer)
  assert.equal(ready(), 'released')
  await assert.rejects(waitForFixtureGate('missing numeric-review request', () => null, 25), /missing numeric-review request/)
})

test('test subprocesses exit successfully or report their named exit code', async () => {
  await runTestProcess('successful fixture', ['--eval', 'process.exit(0)'], { timeoutMs: 1000, stdio: 'ignore' })
  await assert.rejects(runTestProcess('failed fixture', ['--eval', 'process.exit(3)'], { timeoutMs: 1000, stdio: 'ignore' }), /failed fixture failed \(3\)/)
})

test('a stuck test subprocess is bounded even when it ignores the first termination signal', async () => {
  const began = Date.now()
  await assert.rejects(runTestProcess('stuck fixture', ['--eval', "process.on('SIGTERM', () => {}); setInterval(() => {}, 10)"], { timeoutMs: 150, cleanupMs: 50, stdio: 'ignore' }), /stuck fixture exceeded its 150 ms deadline/)
  assert.ok(Date.now() - began < 1500, 'cleanup must not wait indefinitely for its own child')
})
