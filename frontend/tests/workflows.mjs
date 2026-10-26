import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// Every API request in these suites is intercepted; CI never receives runtime credentials.
async function run(script, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`tests/${script}.mjs`], { stdio: 'inherit', env: { ...process.env, ...env } })
    child.on('error', reject)
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} failed (${signal ?? code}).`)))
  })
}
const requested = process.argv.slice(2)
const selected = name => !requested.length || requested.includes(name)
for (const suite of ['intake-workflow', 'report-workflow', 'normalization-workflow', 'projects-workflow'].filter(selected)) await run(suite)
const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 5305, strictPort: true } })
try {
  await server.listen()
  const env = { FRONTEND_BASE_URL: server.resolvedUrls.local[0].replace(/\/$/, '') }
  for (const suite of ['transitions', 'landing-chat-sample'].filter(selected)) await run(suite, env)
} finally { await server.close() }
