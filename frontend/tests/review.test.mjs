import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewParagraphs, reviewAdvice } from '../src/review.ts'

test('selecting report text uses explicit paragraph citations, preserves decimals and does not leak references', () => {
  const paragraphs = reviewParagraphs('Income is €3,452,682.81. Confirm the scope. [income]\n\nNo source supports this claim.\n\nOther figures. [other] [missing]', new Set(['income', 'other']), ['missing'])
  assert.equal(paragraphs[0].sentences[0], 'Income is €3,452,682.81. ')
  assert.deepEqual(paragraphs[0].evidenceIds, ['income'])
  assert.deepEqual(paragraphs[1].evidenceIds, [])
  assert.deepEqual(paragraphs[2].evidenceIds, ['other'])
  assert.deepEqual(paragraphs[2].missingIds, ['missing'])
})

test('several source references stay available without choosing an authoritative value', () => {
  const [paragraph] = reviewParagraphs('Value A differs from value B. [a] [b] [a]', new Set(['a', 'b']))
  assert.deepEqual(paragraph.evidenceIds, ['a', 'b'])
  assert.equal(paragraph.text, 'Value A differs from value B.')
})

test('native financial brackets remain report text; missing UUID citations stay explicit', () => {
  const [paragraph] = reviewParagraphs('Revenue [USD] is 10. [6e328af7-a59b-4adb-8427-65dcc0320d07]', new Set())
  assert.equal(paragraph.text, 'Revenue [USD] is 10.')
  assert.deepEqual(paragraph.missingIds, ['6e328af7-a59b-4adb-8427-65dcc0320d07'])
})

test('agent advice uses backend conflict flags and cited review notes, never guesses conflicts from differing numbers', () => {
  const sections = [{ id: 'financials', title: 'Financials', content: 'A [a]\n\nB [b]', evidenceIds: ['a', 'b', 'unlinked'] }]
  const evidence = [{ id: 'a', value: '10', status: 'Reproduced', conflictNumbers: true }, { id: 'b', value: '20', status: 'Reported' }, { id: 'unlinked', status: 'Needs review' }]
  const advice = reviewAdvice(sections, evidence)
  assert.equal(advice.length, 1)
  assert.equal(advice[0].conflict, true)
  assert.equal(advice[0].id, 'a')
  assert.match(advice[0].message, /Keep both source records/)
  assert.equal(reviewAdvice([{ ...sections[0], content: 'No citations remain.' }], evidence).length, 0)
})

test('definition concerns remain review notes instead of being relabeled as numeric conflicts', () => {
  const evidence = [{ id: 'definition', status: 'Needs review', note: 'Confirm the revenue definition.' }]
  const [advice] = reviewAdvice([{ id: 'financials', content: 'Revenue [definition]' }], evidence)
  assert.equal(advice.conflict, false)
  assert.equal(advice.message, evidence[0].note)
})
