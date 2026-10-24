import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('source-linked sentences and numbers render as inline evidence buttons; unsupported text stays plain', async () => {
  const server=await createServer({ configFile:false, server:{middlewareMode:true,hmr:false,ws:false}, appType:'custom', plugins:[(await import('@vitejs/plugin-react')).default()] })
  try {
    const { default:ReportReview }=await server.ssrLoadModule('/src/ReportReview.tsx')
    const evidence=[{id:'source-one',title:'Source revenue',status:'Reported',value:'100.123400 USD',file:'finance.csv',locator:'Row 2',period:'Source period',unit:'USD',excerpt:'100.123400',rows:[],note:''}]
    const html=renderToStaticMarkup(React.createElement(ReportReview,{project:{id:'company',name:'Workspace name',sector:'Fintech',geography:'US'},companyName:'Company Legal Name',workspace:{sections:[{id:'financials',title:'Financials',content:'Revenue is 100.123400 USD. [source-one]\n\nUnsupported statement.',evidenceIds:['source-one']}],revisions:[]},evidence,backend:false,inspect(){},edit(){},history(){},onExport(){}}))
    assert.match(html,/report-claim source-linked/)
    assert.match(html,/>Revenue is 100\.123400 USD\.<\/button>/)
    assert.match(html,/class="report-uncited">Unsupported statement\.<\/span>/)
    assert.doesNotMatch(html,/paragraph-citations/)
    assert.match(html,/<h2>Company Legal Name<\/h2>/)
    assert.match(html,/Report reference panels/)
    assert.match(html,/Sources/);assert.match(html,/Activity/)
  } finally { await server.close() }
})
