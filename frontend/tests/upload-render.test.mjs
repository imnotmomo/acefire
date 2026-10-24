import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('connected data room offers actual uploads and original-file opening with no pending upload dead end', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] })
  try {
    const { default: ConnectedDataRoom } = await server.ssrLoadModule('/src/ConnectedDataRoom.tsx')
    const report = { company: { deal_id: 'deal-a' }, source_files: [{ snapshot_id: 'source-one', file_name: 'financials.xlsx', sha256: 'a'.repeat(64), provider: 'uploaded', data_role: 'supplemental_evidence', preview_url: '/sources/source-one/file', preview_available: true }], document_claims: [] }
    const html = renderToStaticMarkup(React.createElement(ConnectedDataRoom, { report, onRefresh() {}, onAskSources() {} }))
    assert.match(html, /Upload company evidence/)
    assert.match(html, /Upload company source files/)
    assert.match(html, />Upload files<\/button>/)
    assert.doesNotMatch(html, /Uploads · pending|Pending integration/)
    assert.match(html, />Open file<\/button>/)
    assert.match(html, /Download original/)
    assert.match(html, /Akta retrieval unavailable/)
    assert.match(html, /Ask source files/)
    assert.match(html, /\.pdf,\.doc,\.docx/)
  } finally { await server.close() }
})

test('upload history resumes only its company and turns interrupted browser uploads into retryable failures', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] })
  const beforeWindow = globalThis.window; const beforeStorage = globalThis.localStorage
  try {
    const { default: UploadPanel } = await server.ssrLoadModule('/src/UploadPanel.tsx')
    const base = { size: 12, type: 'application/pdf', provider: 'uploaded', added: '2026-10-24T12:00:00Z', warnings: [] }
    globalThis.window = {}
    globalThis.localStorage = { getItem() { return JSON.stringify([
      { ...base, dealId: 'deal-a', clientId: 'current', serverId: 'server-job', name: 'queued.pdf', status: 'processing' },
      { ...base, dealId: 'deal-a', clientId: 'interrupted', name: 'interrupted.pdf', status: 'uploading' },
      { ...base, dealId: 'another-company', clientId: 'foreign', name: 'foreign-private.pdf', status: 'completed' },
    ]) } }
    const html = renderToStaticMarkup(React.createElement(UploadPanel, { dealId: 'deal-a' }))
    assert.match(html, /queued\.pdf/); assert.match(html, /Reading source/)
    assert.match(html, /interrupted before its receipt was confirmed/)
    assert.match(html, /Retry file/)
    assert.doesNotMatch(html, /foreign-private/)
  } finally {
    if (beforeWindow === undefined) delete globalThis.window; else globalThis.window = beforeWindow
    if (beforeStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = beforeStorage
    await server.close()
  }
})

test('connecting an older project retains a visible browser-file bridge without silently uploading or losing its copies', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] })
  const beforeStorage = globalThis.localStorage
  try {
    const { default: UploadPanel } = await server.ssrLoadModule('/src/UploadPanel.tsx')
    globalThis.localStorage = { getItem(key) { return key.includes('documents') ? JSON.stringify([
      { id: 'local-document', projectId: 'old-project', name: 'preserved.pdf', type: 'application/pdf', size: 200, category: 'Documents', added: '2026-10-24T12:00:00Z' },
      { id: 'private-other', projectId: 'other-project', name: 'other-private.pdf', type: 'application/pdf', size: 200 },
    ]) : '[]' } }
    const html = renderToStaticMarkup(React.createElement(UploadPanel, { dealId: 'deal-new', legacyProjectId: 'old-project' }))
    assert.match(html, /Previously saved in this browser/)
    assert.match(html, /preserved\.pdf/)
    assert.match(html, /Download browser copy/)
    assert.match(html, /Add to company evidence/)
    assert.doesNotMatch(html, /other-private/)
  } finally {
    if (beforeStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = beforeStorage
    await server.close()
  }
})
