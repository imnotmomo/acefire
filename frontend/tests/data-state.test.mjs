import test from 'node:test'
import assert from 'node:assert/strict'
import { dataState, dataStateLabel, stateDescription } from '../src/dataState.ts'

test('numeric conflict flags take priority over missing values and other statuses', () => {
  assert.equal(dataState({ conflictNumbers: true, hasEvidence: false, normalizationStatus: 'missing', status: 'insufficient_data', value: null }), 'conflict')
  assert.equal(dataStateLabel(dataState({ conflictNumbers: true, value: '100' })), 'Conflict')
})

test('missing evidence and unsuccessful calculations remain missing without filling zero', () => {
  const inputs = [
    {}, { value: null, rawValue: null }, { value: '', rawValue: '  ' },
    { hasEvidence: false, value: '100' },
    { normalizationStatus: 'missing', rawValue: 'n.a.', hasEvidence: true },
    { status: 'insufficient_data', value: null, hasEvidence: true },
    { status: 'not_applicable', value: null, rawValue: '$25B+', hasEvidence: true },
  ]
  for (const input of inputs) {
    const before = structuredClone(input)
    assert.equal(dataState(input), 'missing')
    assert.deepEqual(input, before)
  }
  assert.match(stateDescription('missing'), /No value is inferred/)
})

test('unresolved source ranges and original text remain evidence to verify', () => {
  assert.equal(dataState({ value: null, rawValue: '$25B+', normalizationStatus: 'unresolved' }), 'verify')
  assert.equal(dataState({ value: null, rawValue: 'The source reports fourteen customers.' }), 'verify')
  assert.equal(dataState({ hasEvidence: true }), 'verify')
  assert.equal(dataState({ value: null, rawValue: '0', normalizationStatus: 'unresolved' }), 'verify')
})

test('a recorded zero is present evidence and presentation does not convert decimal strings', () => {
  const input = { value: '0.0000', normalizationStatus: 'confirmed' }
  assert.equal(dataState(input), 'verify')
  assert.equal(input.value, '0.0000')
  assert.equal(dataState({ value: '-0' }), 'verify')
  assert.equal(dataState({ value: '9007199254740993.0123456789' }), 'verify')
})

test('all prior successful or reported labels map to Verify rather than verified truth', () => {
  for (const status of ['succeeded', 'Reproduced', 'Reported', 'Needs review', 'api_reported', 'model_generated_unverified', 'confirmed']) {
    assert.equal(dataStateLabel(dataState({ status, hasEvidence: true, value: '12' })), 'Verify')
  }
  assert.deepEqual(['missing', 'verify', 'conflict'].map(dataStateLabel), ['Missing', 'Verify', 'Conflict'])
  assert.match(stateDescription('verify'), /does not mean it has been verified/)
  assert.match(stateDescription('conflict'), /original values and their sources/)
})
