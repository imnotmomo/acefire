import test from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_PROJECTS, migrateDemoProjects, SCENARIOS, initialScenarioWorkspace, scenarioSections } from '../src/scenarios.ts'
import { backendProjectId } from '../src/backend.ts'
import { reportMarkdown } from '../src/domain.ts'

test('three pinned demos use the real Enfuce identity and two isolated illustrative scenarios', () => {
  assert.equal(DEMO_PROJECTS.length, 3)
  assert.equal(backendProjectId(DEMO_PROJECTS[0].id), 'enfuce-2020')
  assert.deepEqual(DEMO_PROJECTS.slice(1).map(p => backendProjectId(p.id)), [null, null])
  assert.equal(new Set(SCENARIOS.flatMap(s => s.evidence.map(e => e.id))).size, 8)
})
test('UI demos preserve every existing company identity, metadata and backend binding', () => {
  const custom = { id: 'custom', name: 'My company', sector: 'Other', geography: 'UK', created: '2026-10-01' }
  const connected = { id: 'enfuce-documents', name: 'Original legal name', backendDealId: 'original-binding', sector: 'Original sector', geography: 'Original country' }
  const saved = [{ id: 'enfuce', name: 'Historical Enfuce' }, { id: 'circle', name: 'Circle', backendDealId: 'circle-2025-ipo' }, { id: 'backerkit', name: 'BackerKit' }, connected, custom]
  const before = structuredClone(saved)
  const result = migrateDemoProjects(saved)
  assert.equal(result.length, 7)
  for (const original of saved) assert.strictEqual(result.find(p => p.id === original.id), original)
  assert.deepEqual(saved, before)
  assert.deepEqual(migrateDemoProjects(result), result)
  assert.equal(migrateDemoProjects(null).length, 3)
})
test('illustrative reports and exported evidence cannot silently masquerade as retrieved company data', () => {
  for (const scenario of SCENARIOS) {
    const workspace = initialScenarioWorkspace(scenario)
    assert(workspace.sections.every(section => section.content.includes('SIMULATED DEMO')))
    assert(scenario.evidence.every(e => !e.hash && e.file.startsWith('SIMULATED')))
    const markdown = reportMarkdown(DEMO_PROJECTS.find(p => p.id === scenario.id), workspace.sections, scenario.evidence, { kind: 'scenario' })
    assert.match(markdown, /Fictional company, claims, numeric examples and evidence excerpts/)
    assert.doesNotMatch(markdown, /Historical saved extracts/)
    assert(scenarioSections(scenario, { ...workspace, order: ['legal'] })[0].evidenceIds.length === 0)
    assert(workspace.sections.every(section => section.evidenceIds.every(id => scenario.evidence.some(e => e.id === id))))
  }
})
