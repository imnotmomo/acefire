import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('failed shared receipts require the original file instead of pretending another browser has retry bytes', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] })
  const previousWindow = globalThis.window, previousStorage = globalThis.localStorage
  try {
    const { default: UploadPanel } = await server.ssrLoadModule('/src/UploadPanel.tsx')
    globalThis.window = {}
    globalThis.localStorage = { getItem() { return JSON.stringify([{ clientId: 'server:receipt', serverId: 'receipt', dealId: 'company', name: 'shared-source.pdf',
      size: null, remoteOnly: true, type: 'application/octet-stream', provider: 'uploaded', added: '2026-10-24T12:00:00Z', status: 'failed', warnings: [], error: 'Extraction interrupted.' }]) } }
    const html = renderToStaticMarkup(React.createElement(UploadPanel, { dealId: 'company' }))
    assert.match(html, /Shared upload receipt/)
    assert.match(html, /no original retry copy/)
    assert.match(html, />Select original file<\/button>/)
    assert.match(html, /Refresh processing history/)
    assert.doesNotMatch(html, /0\.0 KiB|>Retry file<\/button>/)
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage
    await server.close()
  }
})
