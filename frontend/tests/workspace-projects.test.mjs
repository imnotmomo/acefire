import test from 'node:test'
import assert from 'node:assert/strict'
import { companyProject, connectLocalProject, mergeCompanyProjects, readProjects, recoverProjectConnections } from '../src/workspaceProjects.ts'

const local = (id, name = id) => ({ id, name, sector: 'Fintech', geography: 'Local scope', created: '' })
const server = (deal_id, legal_name = deal_id) => ({ deal_id, legal_name, entity_key: 'entity-' + deal_id, domain: '', country: 'US', identifiers: { workspace_sector: 'Software', workspace_geography: 'United States', workspace_created_at: '2026-10-24T12:34:00Z' } })

test('shared company discovery preserves historical Enfuce and known frontend aliases without duplicate company cards', () => {
  const historical = local('enfuce', 'Historical Enfuce')
  const circle = local('circle', 'Circle project')
  const documents = local('enfuce-documents', 'Imported document project')
  const original = [historical, circle, documents]
  const merged = mergeCompanyProjects(original, [server('circle-2025-ipo', 'Circle Legal Name'), server('enfuce-2020', 'Enfuce'), server('deal-acme', 'Acme')])
  assert.equal(merged.length, 4)
  assert.deepEqual(merged[0], historical)
  assert.equal(merged[0].backendDealId, undefined)
  assert.equal(merged[1].id, 'circle'); assert.equal(merged[1].name, 'Circle project'); assert.equal(merged[1].backendDealId, 'circle-2025-ipo')
  assert.equal(merged[2].id, 'enfuce-documents'); assert.equal(merged[2].backendDealId, 'enfuce-2020')
  assert.equal(merged[3].id, 'deal-acme'); assert.equal(merged[3].sector, 'Software')
  assert.equal(merged[3].created, '2026-10-24T12:34:00Z')
  assert.equal(original[1].backendDealId, undefined)
  assert.equal(mergeCompanyProjects(merged, [server('deal-acme', 'Acme')]).length, 4)
})

test('explicit local-project connection keeps its original browser storage identity and human metadata', () => {
  const starter = local('old-browser-uuid', 'Existing diligence draft')
  const connected = connectLocalProject(starter, server('deal-new', 'New company'))
  assert.deepEqual(connected, { ...starter, backendDealId: 'deal-new' })
  assert.equal(`acefire:workspace:v1:${connected.id}`, 'acefire:workspace:v1:old-browser-uuid')
  const merged = mergeCompanyProjects([connected], [server('deal-new')])
  assert.equal(merged.length, 1); assert.equal(merged[0].id, starter.id)
  assert.equal(merged[0].name, starter.name)
})

test('unknown company creation time remains unknown and malformed saved projects do not crash discovery', () => {
  const company = companyProject({ deal_id: 'deal-unknown', legal_name: 'Unknown metadata', entity_key: 'entity', country: '', domain: '' })
  assert.equal(company.created, ''); assert.equal(company.geography, 'Unknown')
  const defaults = [local('enfuce'), local('enfuce-documents')]
  const projects = readProjects([null, local('kept'), local('kept'), { id: 'invalid/path', name: 'Invalid' }, { id: 'metadata', name: 'Preserved', backendDealId: '../foreign' }], defaults)
  assert.deepEqual(projects.map(project => project.id), ['kept', 'metadata', 'enfuce-documents'])
  assert.equal(projects[1].backendDealId, undefined)
  assert.equal(projects[1].created, '')
})

test('an interrupted local-project connection recovers after reload only from matching confirmed company metadata', () => {
  const project = { ...local('browser-id', 'Acme'), sector: 'Software', geography: 'United States' }
  const request = { projectId: project.id, dealId: 'deal-acme', name: project.name, sector: project.sector, geography: project.geography }
  const confirmed = server('deal-acme', 'Acme')
  const restored = recoverProjectConnections([project], [confirmed], [request])
  assert.equal(restored[0].backendDealId, 'deal-acme')
  assert.equal(mergeCompanyProjects(restored, [confirmed]).length, 1)
  assert.equal(recoverProjectConnections([project], [], [request])[0].backendDealId, undefined)
  assert.equal(recoverProjectConnections([project], [{ ...confirmed, legal_name: 'Another company' }], [request])[0].backendDealId, undefined)
})
