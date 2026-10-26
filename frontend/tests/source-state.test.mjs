import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceStates } from '../src/sourceState.ts'

const original = { snapshot_id: 'native', file_name: 'overview.docx', sha256: 'a'.repeat(64), provider: 'uploaded', preview_url: '/sources/native/file' }
const reading = { snapshot_id: 'reading', file_name: 'reading-view.pdf', sha256: 'b'.repeat(64), provider: 'uploaded', preview_url: '/sources/reading/file' }
const claim = { id: 'claim', deal_id: 'company', entity_key: 'company', snapshot_id: 'reading', evidence: [{ snapshot_id: 'reading', original_snapshot_id: 'native', quote: 'Source-located reading quotation.', locator: { kind: 'pdf_page', page: 2 } }] }
const report = () => structuredClone({ company: { deal_id: 'company', entity_key: 'company' }, source_files: [original, reading], document_claims: [claim] })

test('Office reading evidence marks its exact registered original Verify and preserves both byte identities', () => {
  const value = report(), before = structuredClone(value), states = sourceStates(value)
  assert.equal(states.get('native').state, 'verify'); assert.equal(states.get('native').readingViewEvidence, true)
  assert.equal(states.get('native').readingViews[0], value.source_files[1]); assert.equal(states.get('reading').originals[0], value.source_files[0])
  assert.deepEqual(value, before); assert.equal(states.get('native').readingViews[0].sha256, 'b'.repeat(64)); assert.equal(states.get('reading').originals[0].sha256, 'a'.repeat(64))
})
test('OCR context links require the exact original hash and can expose its reading copy before extraction has evidence', () => {
  const value = report(); delete value.document_claims[0].evidence[0].original_snapshot_id
  value.source_files[1].context = { original_snapshot_id: 'native', original_sha256: original.sha256, representation_kind: 'ocr_pdf' }
  assert.equal(sourceStates(value).get('native').state, 'verify')
  value.document_claims = []; assert.equal(sourceStates(value).get('native').state, 'missing'); assert.equal(sourceStates(value).get('native').readingViews.length, 1)
  value.source_files[1].context.original_sha256 = 'c'.repeat(64); assert.equal(sourceStates(value).get('native').readingViews.length, 0)
})
test('foreign claims, unknown originals, duplicate IDs, changed hashes and filename guesses cannot establish a reading relationship', () => {
  for (const mutate of [
    value => { value.document_claims[0].deal_id = 'foreign-company' },
    value => { value.document_claims[0].entity_key = 'foreign-entity' },
    value => { value.document_claims[0].evidence[0].original_snapshot_id = 'foreign-original' },
    value => { value.source_files[0].deal_id = 'foreign-company' },
    value => { value.source_files.push({ ...value.source_files[0], sha256: 'c'.repeat(64) }) },
    value => { value.source_files[1].context = { original_snapshot_id: 'native', original_sha256: 'c'.repeat(64) } },
    value => { value.document_claims[0].evidence[0].original_snapshot_id = undefined; value.source_files[1].context = { original_filename: 'overview.docx' } },
    value => { value.source_files[1].sha256 = 'not-a-recorded-hash' },
  ]) { const value = report(); mutate(value); assert.equal(sourceStates(value).get('native').readingViews.length, 0) }
})
test('several equally named reading PDFs retain their own registered original labels without guessing from file names', () => {
  const value = report(), secondOriginal = { ...original, snapshot_id: 'slides', file_name: 'overview.pptx', sha256: 'c'.repeat(64) }, secondReading = { ...reading, snapshot_id: 'slide-reading', sha256: 'd'.repeat(64) }
  value.source_files.push(secondOriginal, secondReading); value.document_claims.push({ ...claim, id: 'second-claim', snapshot_id: secondReading.snapshot_id, evidence: [{ ...claim.evidence[0], snapshot_id: secondReading.snapshot_id, original_snapshot_id: secondOriginal.snapshot_id }] })
  const states = sourceStates(value)
  assert.deepEqual(states.get('reading').originals.map(source => source.file_name), ['overview.docx'])
  assert.deepEqual(states.get('slide-reading').originals.map(source => source.file_name), ['overview.pptx'])
})
