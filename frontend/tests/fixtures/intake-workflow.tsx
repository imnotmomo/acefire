import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import UploadPanel from '../../src/UploadPanel'
import SourceFilePreview from '../../src/SourceFilePreview'
import CompanyChat from '../../src/CompanyChat'
import DocumentChat from '../../src/DocumentChat'
import '../../src/styles.css'
import '../../src/motion.css'

const source = { snapshot_id: 'finance', file_name: 'finance.xlsx', sha256: 'a'.repeat(64), provider: 'uploaded', ingestion_channel: 'user_upload', data_role: 'supplemental_evidence', visibility: 'deal_private', preview_url: '/sources/finance/file', locator: { sheet: 'Finance', cell: 'A1' } }
const documentSource = { ...source, snapshot_id: 'document', file_name: 'original.docx', sha256: '0c0e1bb3efa90187e66cb5403d9b87a6d85a859d6ff962a157ef15dd1c8076a3', preview_url: '/sources/document/file', locator: { paragraph: 4 } }
const report: any = { report_id: 'test-report', company: { deal_id: 'fixture-company', entity_key: 'fixture-company' }, reported_metrics: [], calculations: [], document_claims: [], comparisons: [], source_files: [source, documentSource], conflicts: [], flags: [], source_graph: { nodes: [], edges: [] }, primary_profile: { available: false, records: [], field_lineage: { fields: [], sources: [], nodes: [], edges: [] } } }
const project: any = { id: 'fixture-company', name: 'Fixture Company', backendDealId: 'fixture-company' }

function Fixture() {
  const view = new URLSearchParams(location.search).get('view')
  const [completions, setCompletions] = useState(0)
  const [mode, setMode] = useState<'company' | 'sources' | null>(null)
  return <main style={{ padding: 24 }}>
    {view === 'uploads' ? <><UploadPanel dealId="fixture-company" onComplete={() => setCompletions(value => value + 1)} /><output aria-label="Completed upload refreshes">{completions}</output></>
      : view === 'workbook' ? <SourceFilePreview source={source} />
      : view === 'native' ? <SourceFilePreview source={documentSource} />
      : <><button onClick={() => setMode('company')}>Open company chat</button><button onClick={() => setMode('sources')}>Open source search</button>
        {mode === 'company' && <CompanyChat project={project} report={report} page="Data room" draftSections={[]} inspect={() => {}} navigate={() => {}} onClose={() => setMode(null)} onSearchSources={() => setMode('sources')} />}
        {mode === 'sources' && <DocumentChat project={project} report={report} page="Data room" onClose={() => setMode(null)} onCompanyChat={() => setMode('company')} />}
      </>}
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
