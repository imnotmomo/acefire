/** Product integration stays code-only unless explicitly enabled by an operator. */
export async function runIfEnabled(run, { env = process.env, log = console.log } = {}) {
  if (env.ROUNDTABLE_ENABLED !== 'true') {
    log('Roundtable integration is disabled (code-only). No SDK, credentials or network calls are used.')
    return { status: 'disabled' }
  }
  return run()
}
