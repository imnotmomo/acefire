import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'

// Full application + intercepted API: provider fetch-once behavior is covered by isolated backend tests.
const server = await createServer({ configFile:false, plugins:[react()], server:{ host:'127.0.0.1', port:5314, strictPort:true } }); await server.listen()
const base = server.resolvedUrls.local[0]
let executablePath = process.env.PLAYWRIGHT_BROWSER_PATH
for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser']) if (!executablePath && await fs.access(candidate).then(() => true, () => false)) executablePath = candidate
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless:true })
const context = await browser.newContext({ viewport:{ width:1440,height:1050 } }), page = await context.newPage(); page.setDefaultTimeout(10_000)
const output = path.resolve('test-results/company-logo-workflow'); await fs.mkdir(output,{ recursive:true })
const results=[], requests=[], errors=[], unexpected=[], outside=[], creates=[], websiteWrites=[]
const companies=[{ deal_id:'circle-2025-ipo', entity_key:'circle', legal_name:'Circle', domain:'circle.com', country:'US', identifiers:{ workspace_sector:'Fintech' } }]
const logoStates=new Map(), resolved=new Set(), resolveOnCheck=new Set(), uploadHistory=new Map(); let png, sha256, imageMode='okay'
const awaiting = () => ({ status:'awaiting_website', domain:null, sha256:null, asset_path:null })
const pending = domain => ({ status:'fetching',domain,sha256:null,asset_path:null })
const ready = (id,domain) => ({ status:'ready',domain,sha256,asset_path:`/deals/${id}/logo/image/${sha256}` })
function publicCompany(company) { const logo=logoStates.get(company.deal_id); return { ...company,...(logo ? { company_logo:resolved.has(company.deal_id) ? ready(company.deal_id,logo.domain) : logo } : {}) } }
function report(company) { return { report_id:'report-'+company.deal_id,report_version:'1',generated_at_utc:'2026-10-26T12:00:00Z',company:{ ...company,primary_provider:'akta',historical_cutoff:null },primary_profile:{ available:false,provider:'akta',records:[],field_lineage:{ fields:[],sources:[],nodes:[],edges:[] } },reported_metrics:[],calculations:[],comparisons:[],source_files:[],coverage:[],summary:{},gaps:[],data_period_coverage:[],source_graph:{ nodes:[],edges:[] },conflict_numbers:false,conflicts:[],flags:[],document_claims:[] } }
page.on('pageerror',error=>errors.push(error.message))
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method()
  if(url.origin!==new URL(base).origin){outside.push(url.href);await route.abort();return}
  if(!url.pathname.startsWith('/api/')){await route.continue();return}
  requests.push({method,path:url.pathname,auth:request.headers().authorization??null})
  if(url.pathname==='/api/deals'&&method==='GET'){await route.fulfill({json:{companies:companies.map(publicCompany)}});return}
  if(url.pathname==='/api/deals'&&method==='POST'){
    const body=request.postDataJSON();creates.push(body)
    const company={deal_id:body.deal_id,entity_key:'entity-'+body.deal_id,legal_name:body.name,domain:body.website||'',country:body.geography,identifiers:{workspace_sector:body.sector,workspace_geography:body.geography}}
    companies.push(company);logoStates.set(company.deal_id,body.website?pending(body.website):awaiting())
    await route.fulfill({status:201,json:{company:publicCompany(company)}});return
  }
  const match=/^\/api\/deals\/([^/]+)(.*)$/.exec(url.pathname)
  if(match){
    const id=match[1],suffix=match[2],company=companies.find(row=>row.deal_id===id)
    if(!company){unexpected.push(url.pathname);await route.fulfill({status:404,json:{detail:'No fixture company'}});return}
    if(suffix==='/report'){await route.fulfill({json:report(company)});return}
    if(suffix==='/uploads'&&method==='GET'){await route.fulfill({json:{uploads:uploadHistory.get(id)??[]}});return}
    if(suffix==='/uploads'&&method==='POST'){
      assert.match(request.headers()['content-type'],/^multipart\/form-data;/)
      const receipt={id:'identity-job-'+id,status:'completed',deal_id:id,snapshot_id:'identity-source-'+id,filename:'identity.txt',sha256:'f'.repeat(64),created_at:'2026-10-26T13:00:00Z',warnings:[],observations:0,claims:0}
      uploadHistory.set(id,[receipt]);logoStates.set(id,pending('first-file.example.com'));resolved.add(id)
      await route.fulfill({status:202,json:receipt});return
    }
    if(suffix==='/logo'&&method==='GET'){
      // Hold the fixture result until the real cache-check button has entered its request state.
      // Automatic status polling is allowed, but cannot race away that action before a pointer hits it.
      if(resolveOnCheck.has(id)&&await page.getByRole('button',{name:'Checking saved icon…',exact:true}).count())resolved.add(id)
      await route.fulfill({json:{logo:publicCompany(company).company_logo??null}});return
    }
    if(suffix==='/logo/website'&&method==='POST'){
      websiteWrites.push(request.postDataJSON());const value=request.postDataJSON().website
      logoStates.set(id,pending(value));await route.fulfill({status:202,json:{logo:logoStates.get(id)}});return
    }
    if(suffix.startsWith('/logo/image/')){
      if(request.headers().authorization!=='Bearer fixture-logo-token'){await route.fulfill({status:401,json:{detail:'The cached asset requires API authorization.'}});return}
      await route.fulfill({body:imageMode==='tamper'?Buffer.from('Different image.'):png,headers:{'Content-Type':'image/png'}});return
    }
  }
  if(url.pathname==='/api/calculation-runtime'){await route.fulfill({json:{mode:'llm_local',configured:false,model:'fixture',executor:'local_python',generation_provider:'fixture',missing:['No provider in this fixture'],maximum_inputs:100}});return}
  unexpected.push(`${method} ${url.pathname}`);await route.fulfill({status:501,json:{detail:'No live API permitted'}})
})
async function projects(){await page.evaluate(()=>{location.hash='/projects'});await page.getByRole('combobox',{name:'Project collection',exact:true}).waitFor()}
async function create(name,website=''){
  await page.getByRole('button',{name:'Create Project',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Create a project',exact:true})
  await dialog.getByRole('textbox',{name:'Project name',exact:true}).fill(name)
  await dialog.getByRole('textbox',{name:'Company website',exact:true}).fill(website)
  await dialog.getByRole('button',{name:'Create project',exact:true}).click();await page.locator('.company-uploads').waitFor()
  return companies.find(company=>company.legal_name===name)
}
async function decoded(card,name){const image=card.getByRole('img',{name:`${name} website icon`,exact:true});await image.waitFor();await image.evaluate(element=>element.decode());assert.equal(await image.evaluate(element=>element.naturalWidth),96);assert.match(await image.getAttribute('src'),/^blob:/);return image}
async function check(name,callback){console.log('CHECK '+name);await callback();results.push(name);console.log('PASS '+name)}
try{
  await page.goto(base+'tests/company-logo-workflow.html#/projects',{waitUntil:'networkidle'})
  const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;const ctx=canvas.getContext('2d');ctx.fillStyle='#5c6ea8';ctx.fillRect(0,0,96,96);ctx.fillStyle='#fff';ctx.font='bold 58px sans-serif';ctx.fillText('F',27,70);return canvas.toDataURL('image/png').split(',')[1]})
  png=Buffer.from(data,'base64');sha256=createHash('sha256').update(png).digest('hex')
  await check('existing companies preserve approved covers and never request logo enrollment/status/provider lookups',async()=>{
    await page.getByRole('link',{name:'Open Circle dashboard',exact:true}).waitFor()
    assert.match(await page.locator('.project-card').filter({hasText:'Circle'}).locator('.project-cover-image').getAttribute('src'),/\/images\/projects\/claims.jpg$/)
    assert.equal(requests.some(request=>request.path.includes('/logo')),false)
    assert.equal(await page.getByRole('button',{name:'Set website for icon',exact:true}).count(),0)
  })
  const name='Synthetic Logo Company';let created
  await check('new-project Website supplies only public domain and the real card loads authenticated cached bytes',async()=>{
    created=await create(name,'https://Brand.Example.com/about?private-token=never-forwarded')
    assert.equal(creates.at(-1).website,'brand.example.com')
    await projects();const card=page.locator('.project-card').filter({hasText:name})
    const checkSaved=card.getByRole('button',{name:'Check saved icon',exact:true})
    resolveOnCheck.add(created.deal_id)
    await checkSaved.click();await decoded(card,name)
    assert.equal(websiteWrites.length,0)
    assert.ok(requests.filter(request=>request.path.includes('/logo/image/')).every(request=>request.auth==='Bearer fixture-logo-token'))
    await page.screenshot({path:path.join(output,'cached-logo-card.png'),fullPage:true})
  })
  await check('card views, filters and reload reuse fixed cached metadata instead of posting another lookup',async()=>{
    const createsBefore=creates.length,writesBefore=websiteWrites.length
    await page.getByRole('textbox',{name:'Search projects',exact:true}).fill(name);await page.getByRole('button',{name:'Switch to list view',exact:true}).click()
    await decoded(page.locator('.project-card').filter({hasText:name}),name)
    await page.reload({waitUntil:'networkidle'})
    await page.getByRole('textbox',{name:'Search projects',exact:true}).fill('not visible');await page.getByRole('textbox',{name:'Search projects',exact:true}).clear()
    await decoded(page.locator('.project-card').filter({hasText:name}),name)
    assert.equal(creates.length,createsBefore);assert.equal(websiteWrites.length,writesBefore)
  })
  await check('first-file completion while the card is unmounted adopts saved status without a manual website or another lookup request',async()=>{
    const writesBefore=websiteWrites.length
    const firstFile=await create('Synthetic First File')
    assert.equal(creates.at(-1).website,undefined)
    await page.getByLabel('Upload company source files',{exact:true}).setInputFiles({name:'identity.txt',mimeType:'text/plain',buffer:Buffer.from('Company: Synthetic First File\nWebsite: https://first-file.example.com\n')})
    await page.getByRole('article',{name:'identity.txt processing',exact:true}).getByText(/Evidence saved/).waitFor()
    await projects();const card=page.locator('.project-card').filter({hasText:'Synthetic First File'})
    await decoded(card,'Synthetic First File')
    assert.ok(requests.some(request=>request.path===`/api/deals/${firstFile.deal_id}/logo`&&request.method==='GET'))
    assert.equal(websiteWrites.length,writesBefore)
    await page.getByRole('textbox',{name:'Search projects',exact:true}).fill('Synthetic First File')
    await page.setViewportSize({width:390,height:844});await card.scrollIntoViewIfNeeded();await decoded(card,'Synthetic First File')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
    await page.screenshot({path:path.join(output,'cached-logo-mobile.png'),fullPage:true})
    await page.setViewportSize({width:1440,height:1050});await page.getByRole('textbox',{name:'Search projects',exact:true}).clear()
  })
  await check('name-only identity keeps a neutral cover; an explicit eligible website action is functional',async()=>{
    const second=await create('Synthetic Name Only')
    assert.equal(creates.at(-1).website,undefined)
    await projects();const card=page.locator('.project-card').filter({hasText:'Synthetic Name Only'})
    assert.equal(await card.locator('.company-logo-cover img').count(),0)
    await card.getByRole('button',{name:'Set website for icon',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'Company website',exact:true})
    await dialog.getByRole('textbox',{name:'Public company website',exact:true}).fill('127.0.0.1')
    await dialog.getByRole('button',{name:'Find company icon',exact:true}).click();await dialog.getByRole('alert').waitFor()
    assert.equal(websiteWrites.length,0)
    await dialog.getByRole('textbox',{name:'Public company website',exact:true}).fill('https://second.example.com/private-path')
    await dialog.getByRole('button',{name:'Find company icon',exact:true}).click();await dialog.waitFor({state:'detached'})
    assert.deepEqual(websiteWrites,[{website:'second.example.com'}])
    const checkSaved=card.getByRole('button',{name:'Check saved icon',exact:true})
    resolveOnCheck.add(second.deal_id);await checkSaved.click();await decoded(card,'Synthetic Name Only')
  })
  await check('a changed cached image never displays and the card remains usable with a neutral fallback',async()=>{
    imageMode='tamper'
    await page.getByRole('textbox',{name:'Search projects',exact:true}).fill('no cards')
    const imageResponse=page.waitForResponse(response=>response.url().includes('/logo/image/'))
    await page.getByRole('textbox',{name:'Search projects',exact:true}).fill(name)
    const card=page.locator('.project-card').filter({hasText:name})
    await card.locator('.company-logo-cover').waitFor()
    const response=await imageResponse
    assert.equal(response.status(),200)
    await response.finished();await page.evaluate(()=>new Promise(requestAnimationFrame))
    assert.equal(await card.locator('.company-logo-cover img').count(),0)
    await card.getByRole('link',{name:`Open ${name} dashboard`,exact:true}).click();await page.getByText('Stored company report connected',{exact:true}).waitFor()
    assert.equal(new URL(page.url()).hash,`#/project/${created.deal_id}/dashboard`)
  })
  assert.deepEqual(unexpected,[]);assert.deepEqual(outside,[]);assert.deepEqual(errors,[])
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({passed:results,external_requests:outside,requests,creation_requests:creates.length,explicit_website_requests:websiteWrites.length,live_provider_calls:0,simulation:'All APIs intercepted; real cached PNG bytes, no provider/model/production calls.'},null,2))
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({passed:results,error:String(error),requests,unexpected,outside,errors},null,2));throw error}
finally{await context.close();await browser.close();await server.close()}
