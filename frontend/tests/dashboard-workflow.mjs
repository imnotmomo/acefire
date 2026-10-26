import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { formatDecimal, parseCompanyReport } from '../src/backend.ts'

// Actual App, dashboard, calculation form, inspector and source preview. All data is synthetic.
const server = await createServer({ configFile:false, plugins:[react()], server:{ host:'127.0.0.1', port:5315, strictPort:true } })
await server.listen()
const base = server.resolvedUrls.local[0], output = path.resolve('test-results/dashboard-workflow')
await fs.mkdir(output,{ recursive:true })
let executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser']) if (!executablePath && await fs.access(candidate).then(() => true,() => false)) executablePath = candidate
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless:true })
const contexts=[], results=[], errors=[], unexpected=[], external=[]
const company={ deal_id:'dashboard-fixture', entity_key:'dashboard-entity', legal_name:'Synthetic Financial Company', domain:'', country:'US', primary_provider:'akta', historical_cutoff:'2024-01-31', identifiers:{} }
const definitions=[
  { id:'cash', label:'Cash balance', key:'cash', value:'9007199254740993.125000', period_kind:'instant', period_start:null, period_end:'2024-02-29', period_label:'February closing balance', scenario:'actual' },
  { id:'revenue', label:'Revenue', key:'revenue', value:'123456.780000', period_kind:'duration', period_start:'2024-01-01', period_end:'2024-02-29', period_label:'Two months only', scenario:'actual' },
  { id:'expenses', label:'Operating expenses', key:'operating_expenses', value:'2345.6000', period_kind:'duration', period_start:'2024-01-01', period_end:'2024-02-29', period_label:'Two months only', scenario:'forecast' },
  { id:'zero', label:'Reported zero', key:'net_income', value:'0.0000', period_kind:'duration', period_start:'2024-01-01', period_end:'2024-02-29', period_label:'Two months only', scenario:'actual' },
  { id:'raw', label:'Unresolved source range', key:'uploaded.amount', value:null, raw_value:'$25B+', period_kind:'unknown', period_start:null, period_end:null, period_label:null, scenario:'unknown' },
  { id:'missing', label:'Missing source amount', key:'uploaded.unavailable', value:null, raw_value:'N.a.', period_kind:'unknown', period_start:null, period_end:null, period_label:null, scenario:'unknown' },
]
const original='Synthetic financial source; these are fixture values, not company facts.\n'+definitions.map(item=>`${item.label}: ${item.raw_value??item.value}`).join('\n')+'\n'
const sha256=createHash('sha256').update(original).digest('hex')
const source={ snapshot_id:'dashboard-original', file_name:'financial-snapshot.txt', sha256, provider:'uploaded', ingestion_channel:'user_upload', data_role:'supplemental_evidence', visibility:'deal_private', preview_url:'/sources/dashboard-original/file', locator:{kind:'text_lines',line_start:1,line_end:7} }
const metrics=definitions.map((item,index)=>{
  const locator={kind:'text_lines',line_start:index+2,line_end:index+2}
  return { observation:{ id:item.id, deal_id:company.deal_id, entity_key:company.entity_key, snapshot_id:source.snapshot_id, provider:source.provider, metric_key:item.key, raw_label:item.label, raw_value:item.raw_value??item.value, value:item.value, unit:item.value===null?null:'USD', currency:item.value===null?null:'USD', scale_multiplier:item.value===null?null:'1', normalization_status:item.value===null?(item.id==='missing'?'missing':'unresolved'):'confirmed', normalization_basis:item.value===null?null:'Explicit synthetic source unit', definition_key:null, scope:'Consolidated fixture', accounting_basis:null, period_kind:item.period_kind, period_start:item.period_start, period_end:item.period_end, period_label:item.period_label, scenario:item.scenario, verification_status:'source_located', locator, quarantined:false, notes:[] }, source:{...source,locator}, context:{review_required:true,review_reasons:['synthetic_fixture_needs_review']} }
})
function report(mode='normalized') {
  const included=mode==='empty'?[]:mode==='raw'?metrics.slice(4):metrics
  const normalized=included.filter(row=>row.observation.value!==null)
  return parseCompanyReport({report_id:'dashboard-'+mode,report_version:'1',generated_at_utc:'2026-10-26T12:00:00Z',company,primary_profile:{available:false,provider:'akta',records:[],field_lineage:{fields:[],sources:[],nodes:[],edges:[]}},reported_metrics:included,calculations:[],comparisons:[],source_files:included.length?[source]:[],coverage:[],summary:{},gaps:mode==='empty'?[{code:'missing_sources',message:'No source evidence has been supplied.'}]:[],data_period_coverage:normalized.map(row=>({deal_id:company.deal_id,metric_key:row.observation.metric_key,provider:source.provider,scope:row.observation.scope,unit:row.observation.unit,available_start:row.observation.period_start,available_end:row.observation.period_end,known_periods:row.observation.period_kind==='duration'?[{observation_id:row.observation.id,period_label:row.observation.period_label,period_start:row.observation.period_start,period_end:row.observation.period_end,grain:'custom'}]:[],instant_periods:row.observation.period_kind==='instant'?[{observation_id:row.observation.id,period_label:row.observation.period_label,period_end:row.observation.period_end}]:[],unresolved_periods:[],gaps:[],overlaps:[],observation_ids:[row.observation.id]})),source_graph:{nodes:[],edges:[]},conflict_numbers:mode==='normalized',conflicts:mode==='normalized'?[{id:'fixture-expense-conflict',kind:'value_conflict',observation_ids:['expenses'],alternatives:[]}]:[],flags:[],document_claims:[]},company.deal_id)
}
async function workspace(mode='normalized',viewport={width:1440,height:1050}) {
  const context=await browser.newContext({viewport});contexts.push(context)
  const requests=[],calculations=[];let current=report(mode)
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method()
    if(url.origin!==new URL(base).origin){external.push(url.href);await route.abort();return}
    if(!url.pathname.startsWith('/api/')){await route.continue();return}
    requests.push({method,path:url.pathname})
    if(method==='GET'&&url.pathname==='/api/deals'){await route.fulfill({json:{companies:[company]}});return}
    if(method==='GET'&&url.pathname===`/api/deals/${company.deal_id}/report`){await route.fulfill({json:current});return}
    if(method==='GET'&&url.pathname===`/api/deals/${company.deal_id}/uploads`){await route.fulfill({json:{uploads:[]}});return}
    if(method==='GET'&&url.pathname==='/api/calculation-runtime'){await route.fulfill({json:{mode:'llm_local',configured:true,model:'synthetic-echo-fixture',executor:'local_python',generation_provider:'fixture',missing:[],maximum_inputs:100}});return}
    if(method==='GET'&&url.pathname==='/api/sources/dashboard-original/file'){await route.fulfill({body:original,headers:{'Content-Type':'text/plain'}});return}
    if(method==='POST'&&url.pathname===`/api/deals/${company.deal_id}/calculate/agent`){
      const body=request.postDataJSON();calculations.push(body)
      const selected=current.reported_metrics.filter(row=>body.input_ids.includes(row.observation.id))
      const calculation={id:'fixture-echo-result',deal_id:company.deal_id,metric_key:'agent.selected_cash',function_key:'llm_local_python',function_version:'fixture-only',formula:'Echo the selected stored decimal without arithmetic',status:'succeeded',value:selected[0]?.observation.value??null,unit:'USD',input_ids:selected.map(row=>row.observation.id),input_snapshots:[source.snapshot_id],reasons:[],parameters:{agent_execution:{explanation:'Synthetic UI response only. No provider or code execution occurred.'}}}
      current={...current,report_id:'dashboard-after-explicit-calculation',calculations:[{calculation,inputs:selected.map((row,index)=>({...row,input_order:index+1,input_role:'explicit_selected_source'})),sources:[source],nodes:[],edges:[],reasons:[],explanation_steps:[],conflict_numbers:false,conflicts:[]}]}
      await route.fulfill({json:calculation});return
    }
    unexpected.push(`${method} ${url.pathname}`);await route.fulfill({status:501,json:{detail:'No live API permitted by the dashboard regression fixture.'}})
  })
  const page=await context.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`${base}tests/dashboard-workflow.html#/project/${company.deal_id}/dashboard`,{waitUntil:'networkidle'})
  await page.getByRole('region',{name:'Stored financial figures',exact:true}).waitFor()
  return {page,requests,calculations}
}
const snapshot=page=>page.getByRole('region',{name:'Stored financial figures',exact:true})
const lab=page=>page.getByRole('region',{name:'Calculation workspace',exact:true})
async function check(name,callback){console.log('CHECK '+name);await callback();results.push(name);console.log('PASS '+name)}
try {
  const {page,requests,calculations}=await workspace()
  await check('Default dashboard shows four actual source decimals and review states before any calculation setup or model request',async()=>{
    const region=snapshot(page),buttons=region.getByRole('button',{name:/^Inspect reported /})
    assert.equal(await buttons.count(),4)
    for(const row of metrics.slice(0,4)){
      await region.getByRole('button',{name:`Inspect reported ${row.observation.raw_label}`,exact:true}).waitFor()
      assert.ok((await region.innerText()).includes(formatDecimal(row.observation.value)))
    }
    const content=await region.innerText()
    assert.match(content,/Consolidated fixture/);assert.match(content,/Forecast/i);assert.match(content,/Actual/i)
    assert.match(content,/2024-01-01/);assert.match(content,/2024-02-29/);assert.match(content,/financial-snapshot\.txt/)
    assert.match(content,/Conflict/);assert.match(content,/Verify/);assert.equal(await region.locator('.connected-figure-unit').filter({hasText:'USD'}).count(),4)
    assert.match(content,/Period or source timing after 2024-01-31/)
    const first=await buttons.first().boundingBox()
    assert.ok(first&&first.y>=0&&first.y+first.height<=1050,'stored source numbers must be visible in the initial desktop viewport')
    assert.equal(await lab(page).count(),0)
    assert.equal(requests.filter(row=>row.path==='/api/calculation-runtime').length,0)
    assert.equal(calculations.length,0)
    await page.screenshot({path:path.join(output,'stored-source-figures.png'),animations:'disabled',fullPage:true})
  })
  await check('A stored number opens the actual evidence inspector and its exact original file, hash and source line',async()=>{
    await snapshot(page).getByRole('button',{name:'Inspect reported Cash balance',exact:true}).click()
    const inspector=page.getByRole('dialog',{name:'Evidence inspector',exact:true})
    await inspector.waitFor();assert.match(await inspector.innerText(),/9,007,199,254,740,993\.125000 USD/)
    await inspector.getByRole('tab',{name:'Source details',exact:true}).click()
    assert.match(await inspector.innerText(),new RegExp(sha256));assert.match(await inspector.innerText(),/Lines 2–2/)
    await inspector.locator('.inspector-file-toolbar').getByRole('button',{name:/Open file/}).click()
    await inspector.locator('.source-preview-text').waitFor()
    assert.equal(await inspector.locator('.source-preview-text').textContent(),original)
    assert.equal(calculations.length,0)
    await page.keyboard.press('Escape');await inspector.waitFor({state:'detached'})
  })
  await check('Browse all source values moves focus to the actual source table before coverage and longer text',async()=>{
    await page.getByLabel('Search reported values',{exact:true}).fill('no matching source')
    await page.getByLabel('Filter reported values by source',{exact:true}).selectOption('uploaded')
    await page.getByLabel('Filter reported values by state',{exact:true}).selectOption('conflict')
    assert.equal(await page.locator('.connected-observations tbody tr').count(),0)
    await page.getByRole('button',{name:'Browse all source values',exact:true}).click()
    await page.waitForFunction(()=>document.activeElement?.id==='reported-source-values')
    assert.equal(await page.getByLabel('Search reported values',{exact:true}).inputValue(),'')
    assert.equal(await page.getByLabel('Filter reported values by source',{exact:true}).inputValue(),'all')
    assert.equal(await page.getByLabel('Filter reported values by state',{exact:true}).inputValue(),'all')
    assert.equal(await page.locator('.connected-observations tbody tr').count(),6)
    const order=await page.evaluate(()=>{const values=document.querySelector('.connected-observations'),coverage=document.querySelector('.connected-period-section');return Boolean(values.compareDocumentPosition(coverage)&Node.DOCUMENT_POSITION_FOLLOWING)})
    assert.equal(order,true)
    assert.equal(calculations.length,0)
  })
  await check('New calculation opens the real form and hiding it retains exact draft, selected inputs and mounted state',async()=>{
    const open=page.getByRole('button',{name:'New calculation',exact:true})
    await open.click();await lab(page).getByText('Calculation service ready',{exact:true}).waitFor()
    await lab(page).getByLabel('Calculation question',{exact:true}).fill('Echo this selected source amount without adding or annualizing it.')
    await lab(page).getByLabel('Search calculation inputs',{exact:true}).fill('Cash balance')
    await lab(page).locator('tbody tr').getByRole('checkbox').check()
    await lab(page).getByText('Optional calculation parameters',{exact:true}).click()
    const parameters='{"amount":"9007199254740993.125000","period_end":"2024-02-29"}'
    await lab(page).getByLabel('Calculation parameters JSON',{exact:true}).fill(parameters)
    const mounted=await lab(page).elementHandle(),runtimeReads=requests.filter(row=>row.path==='/api/calculation-runtime').length
    await page.getByRole('button',{name:'Hide calculation setup',exact:true}).click()
    assert.equal(await page.locator('#dashboard-calculation-setup').isHidden(),true)
    assert.equal(await open.evaluate(element=>element===document.activeElement),true)
    await open.click();await lab(page).waitFor()
    assert.equal(await mounted.evaluate(element=>element===document.querySelector('.calculation-lab')),true)
    assert.equal(await lab(page).getByLabel('Calculation question',{exact:true}).inputValue(),'Echo this selected source amount without adding or annualizing it.')
    assert.equal(await lab(page).getByLabel('Calculation parameters JSON',{exact:true}).inputValue(),parameters)
    assert.equal(await lab(page).locator('tbody input[type=checkbox]:checked').count(),1)
    assert.equal(requests.filter(row=>row.path==='/api/calculation-runtime').length,runtimeReads)
    assert.equal(calculations.length,0)
  })
  await check('Only explicit Generate submits selected source IDs and the mocked recorded result appears without changing source decimals',async()=>{
    await lab(page).getByRole('button',{name:'Generate and run calculation',exact:true}).click()
    await lab(page).locator('.calculation-result').waitFor()
    assert.equal(calculations.length,1);assert.deepEqual(calculations[0].input_ids,['cash'])
    assert.equal(calculations[0].parameters.amount,'9007199254740993.125000')
    await page.locator('.connected-calculation-hero').waitFor()
    assert.match(await page.locator('.connected-calculation-hero').innerText(),/9,007,199,254,740,993\.125000 USD/)
    await page.getByRole('button',{name:'Hide calculation setup',exact:true}).click()
    assert.match(await snapshot(page).innerText(),/9,007,199,254,740,993\.125000/)
  })
  await check('Mobile keeps stored figures and reported rows first without horizontal overflow or an unsolicited form',async()=>{
    const mobile=await workspace('normalized',{width:390,height:844})
    assert.equal(await lab(mobile.page).count(),0)
    assert.equal(await snapshot(mobile.page).getByRole('button',{name:/^Inspect reported /}).count(),4)
    const first=await snapshot(mobile.page).getByRole('button',{name:/^Inspect reported /}).first().boundingBox()
    assert.ok(first&&first.y>=0&&first.y<844,'a source figure must be visible in the initial mobile viewport')
    assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    await mobile.page.getByRole('button',{name:'Browse all source values',exact:true}).click()
    await mobile.page.waitForFunction(()=>document.activeElement?.id==='reported-source-values')
    assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    assert.equal(mobile.calculations.length,0)
    await mobile.page.screenshot({path:path.join(output,'mobile-stored-source-figures.png'),animations:'disabled',fullPage:true})
  })
  await check('Unnormalized ranges and missing values remain raw and unavailable rather than becoming invented financial zeroes',async()=>{
    const raw=await workspace('raw'),region=snapshot(raw.page),table=raw.page.locator('.connected-observations')
    assert.equal(await region.getByRole('button',{name:/^Inspect reported /}).count(),1)
    assert.equal(await region.getByRole('button',{name:'Inspect reported Missing source amount',exact:true}).count(),0)
    assert.match(await region.innerText(),/\$25B\+/);assert.match(await region.innerText(),/Raw source value · context unconfirmed/)
    assert.match(await region.innerText(),/Scenario: Unknown/);assert.match(await region.innerText(),/Definition not reviewed/)
    assert.doesNotMatch(await region.innerText(),/0(?:\.0+)? USD/)
    assert.match(await table.innerText(),/\$25B\+/);assert.match(await table.innerText(),/N\.a\./)
    assert.match(await table.innerText(),/Unavailable/);assert.match(await table.innerText(),/Missing/)
    assert.equal(await lab(raw.page).count(),0);assert.equal(raw.calculations.length,0)
  })
  await check('No source data shows an honest empty state with a working data-room path and no calculation or made-up cards',async()=>{
    const empty=await workspace('empty')
    assert.equal(await snapshot(empty.page).getByRole('button',{name:/^Inspect reported /}).count(),0)
    assert.doesNotMatch(await snapshot(empty.page).innerText(),/0(?:\.0+)? USD/)
    assert.equal(await empty.page.locator('.connected-observations tbody tr').count(),0)
    await empty.page.getByRole('button',{name:'Open data room',exact:true}).click()
    await empty.page.getByRole('region',{name:'Upload company evidence',exact:true}).waitFor()
    assert.equal(new URL(empty.page.url()).hash,`#/project/${company.deal_id}/data-room`)
    assert.equal(empty.calculations.length,0)
  })
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(external,[])
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({passed:results,page_errors:errors,unexpected_requests:unexpected,external_requests:external,simulation:'All APIs intercepted; actual source bytes and UI, no provider or production writes.'},null,2))
} catch(error) {
  for(const [index,context] of contexts.entries())for(const page of context.pages())await page.screenshot({path:path.join(output,`failure-${index}.png`),fullPage:true,animations:'disabled'}).catch(()=>{})
  await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({passed:results,error:String(error),errors,unexpected,external},null,2));throw error
} finally {await Promise.allSettled(contexts.map(context=>context.close()));await browser.close();await server.close()}
