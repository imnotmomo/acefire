import { useState } from 'react'
import type { CompanyReport } from './backend'
import { apiUrl } from './backend'
import { Badge, Empty, Icon } from './ui'
import { ReviewStateBadge } from './ReviewState'
import SourceFileButton from './SourceFileButton'

export default function ConnectedDataRoom({ report }: { report: CompanyReport }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All sources')
  const sources = report.source_files.filter(source => {
    const primary = source.category === 'primary_company_data'
    return `${source.file_name ?? ''} ${source.provider ?? ''}`.toLowerCase().includes(search.toLowerCase())
      && (category === 'All sources' || (category === 'Primary company data' ? primary : !primary))
  })
  return <>
    <div className="page-heading"><div><div className="heading-line"><h1>Data room</h1><Badge>{report.source_files.length} sources</Badge></div><p>The registered files behind this company report.</p></div><div className="heading-actions"><button className="button secondary" disabled title="Akta retrieval is being connected by the data team"><Icon name="globe" size={16} />Akta · pending</button><button className="button primary" disabled title="Upload processing is being connected by the data team"><Icon name="upload" size={16} />Uploads · pending</button></div></div>
    <div className="integration-pending" role="note"><Icon name="clock" size={22} /><div><strong>New data connections are on the way.</strong><p>Your data teammate is connecting uploads and Akta retrieval. Existing registered sources are available below.</p></div><Badge>Pending integration</Badge></div>
    <div className="sources-toolbar"><div className="source-tabs" aria-label="Source categories">{['All sources', 'Primary company data', 'Supplemental evidence'].map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="search-field compact"><Icon name="search" size={15} /><input aria-label="Search sources" placeholder="Search files or providers…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
    {sources.length === 0 ? <Empty title="No matching sources" text="Try a different name or source category." /> : <div className="sources-table-wrap"><div className="table-scroll"><table className="sources-table backend-source-table"><thead><tr><th>Source file</th><th>Provider / role</th><th>Stored evidence</th><th>SHA-256</th><th>Original file</th></tr></thead><tbody>{sources.map(source => <tr key={source.snapshot_id}><td><span className="backend-file-name"><Icon name="document" size={20} /><strong>{source.file_name || 'Unnamed source'}</strong></span></td><td><Badge tone={source.category === 'primary_company_data' ? 'blue' : 'neutral'}>{source.provider}</Badge><small className="backend-table-subtitle">{source.category === 'primary_company_data' ? 'Primary company data' : 'Private supplemental evidence'}</small></td><td><ReviewStateBadge state={source.has_reported_observations || source.has_profile_fields || report.document_claims?.some(claim => claim.snapshot_id === source.snapshot_id) ? 'verify' : 'missing'} /></td><td><code className="source-hash" title={source.sha256}>{source.sha256 || 'Unknown'}</code></td><td><SourceFileButton source={source} /></td></tr>)}</tbody></table></div></div>}
    <p className="data-room-footer"><Icon name="shield" size={14} />File hashes and evidence status come from the backend. Spreadsheet originals download for viewing in their native application.</p>
  </>
}
