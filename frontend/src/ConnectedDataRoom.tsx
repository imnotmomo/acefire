import { useState } from 'react'
import type { BackendSource, CompanyReport } from './backend'
import { Badge, Dialog, Empty, Icon } from './ui'
import { ReviewStateBadge } from './ReviewState'
import SourceFileButton from './SourceFileButton'
import SourceFilePreview from './SourceFilePreview'
import UploadPanel from './UploadPanel'

export default function ConnectedDataRoom({ report, onRefresh, onAskSources, legacyProjectId }: { report: CompanyReport; onRefresh?: () => void; onAskSources?: () => void; legacyProjectId?: string }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All sources')
  const [opened, setOpened] = useState<BackendSource | null>(null)
  const sources = report.source_files.filter(source => {
    const primary = source.category === 'primary_company_data' || source.data_role === 'primary_company_data'
    return `${source.file_name ?? ''} ${source.provider ?? ''}`.toLowerCase().includes(search.toLowerCase())
      && (category === 'All sources' || (category === 'Primary company data' ? primary : !primary))
  })
  return <>
    <div className="page-heading"><div><div className="heading-line"><h1>Data room</h1><Badge>{report.source_files.length} sources</Badge></div><p>The original files and extracted evidence behind this company report.</p></div><div className="heading-actions">{onAskSources && <button className="button secondary" onClick={onAskSources}><Icon name="chat" size={16} />Ask source files</button>}<button className="button secondary" disabled title="Live Akta retrieval is unavailable. Saved Akta profiles remain visible below."><Icon name="globe" size={16} />Akta retrieval unavailable</button></div></div>
    <UploadPanel key={report.company.deal_id} dealId={report.company.deal_id} onComplete={onRefresh} legacyProjectId={legacyProjectId} />
    <div className="sources-toolbar"><div className="source-tabs" aria-label="Source categories">{['All sources', 'Primary company data', 'Supplemental evidence'].map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="search-field compact"><Icon name="search" size={15} /><input aria-label="Search sources" placeholder="Search files or providers…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
    {sources.length === 0 ? <Empty title={report.source_files.length ? 'No matching sources' : 'Add your first source'} text={report.source_files.length ? 'Try a different name or source category.' : 'Upload company documents or financial data above. Completed extraction makes the evidence available across this project.'} /> : <div className="sources-table-wrap"><div className="table-scroll"><table className="sources-table backend-source-table"><thead><tr><th>Source file</th><th>Provider / role</th><th>Stored evidence</th><th>SHA-256</th><th>Original file</th></tr></thead><tbody>{sources.map(source => {
      const primary = source.category === 'primary_company_data' || source.data_role === 'primary_company_data'
      return <tr key={source.snapshot_id}><td><span className="backend-file-name"><Icon name="document" size={20} /><strong>{source.file_name || 'Unnamed source'}</strong></span></td><td><Badge tone={primary ? 'blue' : 'neutral'}>{source.provider}</Badge><small className="backend-table-subtitle">{primary ? 'Primary company data' : 'Private supplemental evidence'}</small></td><td><ReviewStateBadge state={source.has_reported_observations || source.has_profile_fields || report.document_claims?.some(claim => claim.snapshot_id === source.snapshot_id) ? 'verify' : 'missing'} /></td><td><code className="source-hash" title={source.sha256}>{source.sha256 || 'Unknown'}</code></td><td><SourceFileButton source={source} onOpen={setOpened} /></td></tr>
    })}</tbody></table></div></div>}
    <p className="data-room-footer"><Icon name="shield" size={14} />Original files are checked against their recorded SHA-256 before opening or downloading. Extraction and source support still need review.</p>
    {opened && <Dialog title="Original source file" subtitle={opened.file_name} onClose={() => setOpened(null)} className="source-viewer data-room-source-preview"><div className="dialog-body"><SourceFileButton source={opened} /><SourceFilePreview key={`${opened.snapshot_id}:${JSON.stringify(opened.locator)}`} source={opened} /></div></Dialog>}
  </>
}
