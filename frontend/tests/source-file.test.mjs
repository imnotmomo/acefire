import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSourceFile, sourceFileKind, sourcePage } from '../src/sourceFile.ts'
import { setApiAccessTokenProvider } from '../src/backend.ts'

async function digest(text) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('') }

test('source viewer only renders passive file formats and preserves numeric page locators', () => {
  assert.equal(sourceFileKind('company.pdf'),'pdf');assert.equal(sourceFileKind('finance.xlsx'),'workbook')
  assert.equal(sourceFileKind('original.json'),'text');assert.equal(sourceFileKind('source.png'),'image')
  for(const file of ['document.html','file.svg','macro.xlsm','script.js'])assert.equal(sourceFileKind(file),'download')
  assert.equal(sourcePage({locator:{page:4}}),4);assert.equal(sourcePage({locator:{page:'4'}}),null)
  assert.equal(sourcePage({locator:{page:-1}}),null)
})

test('original file loading checks SHA-256 and authenticates only relative API requests', async () => {
  const original=globalThis.fetch;const bytes='{"reported":"14"}';const sha256=await digest(bytes);const requests=[]
  globalThis.fetch=async (url,init)=>{requests.push({url,init});return new Response(bytes,{headers:{'Content-Type':'application/json'}})}
  setApiAccessTokenProvider(async()=> 'private-test-token')
  const source={preview_url:'/sources/file/file',file_name:'company.json',sha256}
  try {
    const blob=await loadSourceFile(source);assert.equal(await blob.text(),bytes);assert.match(blob.type,/text\/plain/)
    assert.equal(new Headers(requests[0].init.headers).get('Authorization'),'Bearer private-test-token')
    await loadSourceFile({...source,preview_url:'https://storage.example.test/file?grant=temporary'})
    assert.equal(requests[1].init.credentials,'omit');assert.equal(new Headers(requests[1].init.headers).get('Authorization'),null)
    await assert.rejects(loadSourceFile({...source,sha256:'0'.repeat(64)}),/does not match/)
  } finally {globalThis.fetch=original;setApiAccessTokenProvider(null)}
})
