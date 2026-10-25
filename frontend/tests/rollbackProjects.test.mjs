import test from 'node:test'
import assert from 'node:assert/strict'
import { rollbackProjects } from '../src/rollbackProjects.ts'

const project = (id, name = id) => ({ id, name, sector: 'Other', geography: 'US', created: '2026-10-24' })
const initial = ['enfuce', 'circle', 'enfuce-documents', 'backerkit'].map(id => project(id))

test('temporary three-demo catalog rolls back to the old four and preserves custom data', () => {
  const input = [project('enfuce-documents', 'My Enfuce label'), project('healthtech-demo'), project('marketplace-demo'), { ...project('custom', 'My existing project'), draftPreference: 'Keep it' }]
  const before = structuredClone(input)
  const baseline = structuredClone(initial)
  const restored = rollbackProjects(input, initial)
  assert.deepEqual(restored.map(item => item.id), [...initial.map(item => item.id), 'custom'])
  assert.equal(restored[2].name, 'My Enfuce label')
  assert.equal(restored[4].draftPreference, 'Keep it')
  assert.deepEqual(input, before)
  assert.deepEqual(initial, baseline)
  assert.equal(rollbackProjects(restored, initial), restored, 'Rollback is idempotent')
})

test('reserved project IDs connected to a real backend remain intact', () => {
  const connected = { ...project('healthtech-demo', 'My real company'), backendDealId: 'deal-real-company' }
  const restored = rollbackProjects([connected, project('marketplace-demo')], initial)
  assert.equal(restored.find(item => item.id === connected.id), connected)
  assert.equal(restored.some(item => item.id === 'marketplace-demo'), false)
})

test('ordinary catalogs and cloud-only reserved IDs are left unchanged', () => {
  const input = [...initial, project('my-custom'), { ...project('marketplace-demo'), backendDealId: 'deal-marketplace' }]
  assert.equal(rollbackProjects(input, initial), input)
})
