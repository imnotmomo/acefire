import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import UploadPanel from '../../src/UploadPanel'
import SourceFilePreview from '../../src/SourceFilePreview'
import CompanyChat from '../../src/CompanyChat'
import DocumentChat from '../../src/DocumentChat'
import ConnectedDataRoom from '../../src/ConnectedDataRoom'
import '../../src/styles.css'
import '../../src/motion.css'
import '../../src/connected.css'
import '../../src/connection.css'

const source = { snapshot_id: 'finance', file_name: 'finance.xlsx', sha256: 'a'.repeat(64), provider: 'uploaded', ingestion_channel: 'user_upload', data_role: 'supplemental_evidence', visibility: 'deal_private', preview_url: '/sources/finance/file', locator: { sheet: 'Finance', cell: 'A1' } }
const documentSource = { ...source, snapshot_id: 'document', file_name: 'original.docx', sha256: '0c0e1bb3efa90187e66cb5403d9b87a6d85a859d6ff962a157ef15dd1c8076a3', preview_url: '/sources/document/file', locator: { paragraph: 4 } }
const report: any = { report_id: 'test-report', company: { deal_id: 'fixture-company', entity_key: 'fixture-company' }, reported_metrics: [], calculations: [], document_claims: [], comparisons: [], source_files: [source, documentSource], conflicts: [], flags: [], source_graph: { nodes: [], edges: [] }, primary_profile: { available: false, records: [], field_lineage: { fields: [], sources: [], nodes: [], edges: [] } } }
const project: any = { id: 'fixture-company', name: 'Fixture Company', backendDealId: 'fixture-company' }
const sha = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('')
const readingOriginals = { native: 'Native original fixture bytes.', slides: 'Unchanged native slides fixture.', image: 'Unchanged image fixture.', 'native-reading': '%PDF-1.4\n% Synthetic Word reading representation\n%%EOF', 'slides-reading': '%PDF-1.4\n% Synthetic slides reading representation\n%%EOF', 'image-reading': '%PDF-1.4\n% Synthetic OCR reading representation\n%%EOF', 'unbound-reading': '%PDF-1.4\n% Unbound fixture representation\n%%EOF' }
const nativeFiles = await Promise.all(['native', 'slides', 'image'].map(async (id, index) => ({ ...source, snapshot_id: id, file_name: ['overview.docx', 'overview.pptx', 'overview.png'][index], sha256: await sha(readingOriginals[id]), preview_url: `/sources/${id}/file`, locator: null })))
const readingFiles = await Promise.all(nativeFiles.map(async original => ({ ...source, snapshot_id: `${original.snapshot_id}-reading`, file_name: 'reading-view.pdf', sha256: await sha(readingOriginals[`${original.snapshot_id}-reading`]), preview_url: `/sources/${original.snapshot_id}-reading/file`, locator: null, ...(original.snapshot_id === 'image' ? { context: { original_snapshot_id: original.snapshot_id, original_sha256: original.sha256, representation_kind: 'ocr_pdf' } } : {}) })))
const unboundReading = { ...source, snapshot_id: 'unbound-reading', file_name: 'reading-view.pdf', sha256: await sha(readingOriginals['unbound-reading']), preview_url: '/sources/unbound-reading/file', locator: null, context: { original_snapshot_id: 'native', original_sha256: 'f'.repeat(64) } }
const readingReport: any = { ...report, source_files: [...nativeFiles, ...readingFiles, unboundReading], document_claims: readingFiles.map((reading, index) => ({ id: `claim-${index}`, deal_id: 'fixture-company', entity_key: 'fixture-company', snapshot_id: reading.snapshot_id, statement: 'Synthetic reading quotation.', evidence: [{ snapshot_id: reading.snapshot_id, ...(index < 2 ? { original_snapshot_id: nativeFiles[index].snapshot_id } : {}), quote: 'Synthetic reading quotation.', locator: { kind: 'pdf_page', page: 1 } }] })) }
Object.assign(window, { readingFixture: { originals: readingOriginals, report: readingReport } })

function Fixture() {
  const view = new URLSearchParams(location.search).get('view')
  const [completions, setCompletions] = useState(0)
  const [mode, setMode] = useState<'company' | 'sources' | null>(null)
  return <main style={{ padding: 24 }}>
    {view === 'uploads' ? <><UploadPanel dealId="fixture-company" onComplete={() => setCompletions(value => value + 1)} /><output aria-label="Completed upload refreshes">{completions}</output></>
      : view === 'workbook' ? <SourceFilePreview source={source} />
      : view === 'native' ? <SourceFilePreview source={documentSource} />
      : view === 'reading-views' ? <ConnectedDataRoom report={readingReport} />
      : <><button onClick={() => setMode('company')}>Open company chat</button><button onClick={() => setMode('sources')}>Open source search</button>
        {mode === 'company' && <CompanyChat project={project} report={report} page="Data room" draftSections={[]} inspect={() => {}} navigate={() => {}} onClose={() => setMode(null)} onSearchSources={() => setMode('sources')} />}
        {mode === 'sources' && <DocumentChat project={project} report={report} page="Data room" onClose={() => setMode(null)} onCompanyChat={() => setMode('company')} />}
      </>}
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
