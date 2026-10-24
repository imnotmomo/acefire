import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { parseWorkspaceRoute, withoutCompanyChatIntent, companyChatPath } from '../src/workspaceRoute.ts'

test('company-chat route intent preserves the report stage and recognizes only the company mode', () => {
  const route = parseWorkspaceRoute('/project/enfuce-documents/report/review?chat=company')
  assert.equal(route.pathname, '/project/enfuce-documents/report/review')
  assert.deepEqual(route.parts, ['project', 'enfuce-documents', 'report', 'review'])
  assert.equal(route.companyChat, true)
  assert.equal(parseWorkspaceRoute('/project/circle/dashboard').companyChat, false)
  assert.equal(parseWorkspaceRoute('/project/circle/dashboard?chat=source').companyChat, false)
  assert.equal(parseWorkspaceRoute('/project/circle/dashboard?chat=Company').companyChat, false)
  assert.equal(parseWorkspaceRoute('/project/circle/dashboard?other=company').companyChat, false)
  assert.equal(parseWorkspaceRoute('/project/circle/dashboard?chat=company&chat=company').companyChat, false)
})

test('company-chat links keep the selected workspace page and consuming the intent preserves other parameters', () => {
  assert.equal(companyChatPath('enfuce-documents', 'Dashboard'), '/project/enfuce-documents/dashboard?chat=company')
  assert.equal(companyChatPath('enfuce-documents', 'Report', 'review'), '/project/enfuce-documents/report/review?chat=company')
  assert.equal(companyChatPath('enfuce-documents', 'Report'), '/project/enfuce-documents/report/build?chat=company')
  assert.equal(companyChatPath('enfuce-documents', 'Data room'), '/project/enfuce-documents/data-room?chat=company')
  assert.equal(withoutCompanyChatIntent('/project/enfuce-documents/report/review?chat=company'), '/project/enfuce-documents/report/review')
  const preserved = withoutCompanyChatIntent('/project/circle/dashboard?view=details&chat=company')
  const route = parseWorkspaceRoute(preserved)
  assert.equal(route.pathname, '/project/circle/dashboard')
  assert.equal(route.companyChat, false)
  assert.equal(new URL(preserved, 'https://route.invalid').searchParams.get('view'), 'details')
})

test('historical chat gate offers the distinct live Enfuce workspace without canned answers or question input', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] })
  try {
    const { default: Chat } = await server.ssrLoadModule('/src/Chat.tsx')
    const html = renderToStaticMarkup(React.createElement(Chat, {
      project: { id: 'enfuce', name: 'Enfuce', sector: 'Fintech', geography: 'Finland' },
      page: 'Report', stage: 'review', navigate() {}, onClose() {}, async onConnect() {}, connecting: false,
    }))
    assert.match(html, /Open Enfuce company chat/)
    assert.match(html, /href="#\/project\/enfuce-documents\/report\/review\?chat=company"/)
    assert.match(html, /historical/i)
    assert.match(html, /(?:separate|distinct|different|2020|document)/i)
    assert.doesNotMatch(html, /Answers from saved extracts|No live model connected|Send question|<input|<textarea|5,095\.50635|366,559\.95|3,417,663\.76/)
    assert.doesNotMatch(html, />Connect company workspace</)
  } finally { await server.close() }
})

test('unconnected starter chat gate offers company connection and prevents duplicate connection while pending', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] })
  try {
    const { default: Chat } = await server.ssrLoadModule('/src/Chat.tsx')
    const props = {
      project: { id: 'backerkit', name: 'BackerKit', sector: 'Crowdfunding', geography: 'United States' },
      page: 'Dashboard', navigate() {}, onClose() {}, async onConnect() {}, connecting: false,
    }
    const html = renderToStaticMarkup(React.createElement(Chat, props))
    assert.match(html, /Connect company workspace/)
    assert.doesNotMatch(html, /Open Enfuce company chat|Answers from saved extracts|No live model connected|<input|<textarea/)
    const pending = renderToStaticMarkup(React.createElement(Chat, { ...props, connecting: true }))
    assert.match(pending, /<button[^>]*disabled=""[^>]*>[\s\S]*?Connecting/)
    assert.doesNotMatch(pending, /Send question|<input|<textarea/)
    const failed = renderToStaticMarkup(React.createElement(Chat, { ...props, connectionError: 'Company service unavailable.' }))
    assert.match(failed, /role="alert"[^>]*>Company service unavailable/)
    assert.match(failed, /retry the connection/)
    assert.match(failed, /Connect company workspace/)
  } finally { await server.close() }
})
