import { spawn } from 'node:child_process'

/** Wait for a deliberately delayed fixture request, never indefinitely. */
export async function waitForFixtureGate(name, current, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const value = current()
    if (value) return value
    if (Date.now() >= deadline) throw new Error(`Fixture gate timed out after ${timeoutMs} ms: ${name}. Inspect the saved page errors, validation alerts and request mode.`)
    await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(1, deadline - Date.now()))))
  }
}

/** Deadline and signals apply only to this spawned test process, never other sessions. */
export async function runTestProcess(name, args, { env = {}, timeoutMs = 180_000, cleanupMs = 2_000, stdio = 'inherit' } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio, env: { ...process.env, ...env } })
    let finished = false, timedOut = false, forceTimer
    const finish = error => {
      if (finished) return
      finished = true; clearTimeout(deadline); clearTimeout(forceTimer)
      if (error) reject(error); else resolve()
    }
    const timeoutError = () => new Error(`${name} exceeded its ${timeoutMs} ms deadline; its test process was stopped.`)
    const deadline = setTimeout(() => {
      timedOut = true
      console.error(`TIMEOUT ${name}: stopping test process ${child.pid ?? 'not started'}`)
      child.kill('SIGTERM')
      forceTimer = setTimeout(() => { child.kill('SIGKILL'); finish(timeoutError()) }, cleanupMs)
    }, timeoutMs)
    child.once('error', error => finish(new Error(`${name} could not start: ${error.message}`)))
    child.once('exit', (code, signal) => finish(timedOut ? timeoutError() : code === 0 ? null : new Error(`${name} failed (${signal ?? code}).`)))
  })
}
