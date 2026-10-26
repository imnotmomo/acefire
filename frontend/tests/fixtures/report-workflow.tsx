import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Report from '../../src/Report'
import { defaultBackendConfig } from '../../src/domain'
import type { Workspace, Project } from '../../src/domain'
import type { CompanyReport } from '../../src/backend'
import '../../src/styles.css'
import '../../src/motion.css'
import '../../src/connection.css'

const source = { snapshot_id: 'fixture-source', file_name: 'company.json', sha256: 'a'.repeat(64), provider: 'akta', ingestion_channel: 'external_api', data_role: 'primary_context', visibility: 'deal_private', preview_url: '/sources/fixture-source/file', locator: { kind: 'json_pointer', pointer: '/legal_name' } }
const project: Project = { id: 'fixture-company', name: '财务公司', sector: 'Fintech', geography: 'US', created: '2026-10-26T10:00:00Z', backendDealId: 'fixture-company' }
const initialReport = { report_id: 'report-v1', report_version: '1', generated_at_utc: '2026-10-26T10:00:00Z', company: { deal_id: project.backendDealId, entity_key: 'fixture-company', legal_name: project.name },
  primary_profile: { available: true, provider: 'akta', records: [], field_lineage: { fields: [{ field_path: '/legal_name', value: 'Original source company description.', source }], sources: [source], nodes: [], edges: [] } },
  reported_metrics: [], calculations: [], document_claims: [], comparisons: [], source_files: [source], conflicts: [], flags: [], source_graph: { nodes: [], edges: [] }, gaps: [], coverage: [], summary: {}, data_period_coverage: [] } as unknown as CompanyReport
const initial: Workspace = { order: ['overview'], configs: { overview: defaultBackendConfig('overview') }, sections: [], revisions: [], generatedAt: null }
function Fixture() {
  const [workspace, setWorkspace] = useState(initial)
  const [report, setReport] = useState(initialReport)
  const [stage, setStage] = useState('build')
  const [message, setMessage] = useState('')
  const [inspected, setInspected] = useState('')
  useEffect(() => { Object.assign(window, { reportFixture: { workspace, report, clearEvidence: () => setReport({ ...initialReport, primary_profile: { ...initialReport.primary_profile, available: false, field_lineage: { fields: [], sources: [], nodes: [], edges: [] } }, source_files: [] }), refreshEvidence: () => setReport(previous => ({ ...previous, report_id: 'report-v2', report_version: '2' })) } }) }, [workspace, report])
  return <main style={{ padding: 24 }}><output aria-label="Notification">{message}</output><output aria-label="Inspected evidence">{inspected}</output><output aria-label="Fixture route">{stage}</output><Report project={project} workspace={workspace} setWorkspace={setWorkspace} backendReport={report} stage={stage} navigate={path => setStage(path.split('/').pop()!)} inspect={setInspected} notify={setMessage} onRefresh={() => setReport(previous => ({ ...previous, report_id: 'report-v2' }))} /></main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
