import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('loading icons consistently opt in to the motion class while preserving caller classes and decorative semantics', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] })
  try {
    const { Icon } = await server.ssrLoadModule('/src/ui.tsx')
    const loading = renderToStaticMarkup(React.createElement(Icon, { name: 'loading', className: 'request-icon' }))
    assert.match(loading, /class="[^"]*request-icon loading-icon[^"]*"/)
    assert.match(loading, /aria-hidden="true"/)
    const staticIcon = renderToStaticMarkup(React.createElement(Icon, { name: 'document', className: 'request-icon' }))
    assert.match(staticIcon, /request-icon/)
    assert.doesNotMatch(staticIcon, /loading-icon/)
  } finally { await server.close() }
})
