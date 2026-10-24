import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('source chat renders a side drawer with company switching and disables unlinked historical workspaces', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] })
  try {
    const { default: DocumentChat } = await server.ssrLoadModule('/src/DocumentChat.tsx')
    const project = { id: 'enfuce-documents', name: 'Enfuce', sector: 'Fintech', geography: 'Finland' }
    const html = renderToStaticMarkup(React.createElement(DocumentChat, { project, page: 'Data room', onClose() {}, onCompanyChat() {} }))
    assert.match(html, /company-chat-dialog document-chat-dialog/)
    assert.match(html, /aria-label="Search source files"/)
    assert.match(html, /Back to company chat/)
    assert.match(html, /aria-label="Search company source files"/)
    assert.match(html, /company-scoped search/)
    const isolated = renderToStaticMarkup(React.createElement(DocumentChat, { project: { ...project, id: 'enfuce' }, page: 'Report', onClose() {} }))
    assert.match(isolated, /no connected backend company/)
    assert.match(isolated, /aria-label="Send source question" disabled=""/)
  } finally { await server.close() }
})
