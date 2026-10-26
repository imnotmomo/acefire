import { useEffect, useState } from 'react'
import type { Project } from './domain'
import { backendProjectId, humanize, useCompanyReport } from './backend'
import { listUploadJobs } from './workspaceApi'
import type { SharedUploadJob } from './workspaceApi'
import { Badge, Dialog, Icon } from './ui'

export default function WorkspaceNotifications({ projects, initialId, onClose, navigate }: { projects: Project[]; initialId?: string; onClose: () => void; navigate: (path: string) => void }) {
  const linked = projects.filter(p => p.backendDealId ?? backendProjectId(p.id))
  const [id, setId] = useState(linked.find(p => p.id === initialId)?.id ?? linked[0]?.id ?? '')
  const project = linked.find(p => p.id === id)
  const dealId = project?.backendDealId ?? backendProjectId(project?.id ?? '')
  const { report, loading, error, refresh } = useCompanyReport(dealId)
  const [jobs, setJobs] = useState<SharedUploadJob[]>([]), [jobsError, setJobsError] = useState(''), [attempt, setAttempt] = useState(0)
  const [jobsLoading, setJobsLoading] = useState(false)
  useEffect(() => {
    const controller = new AbortController(); setJobs([]); setJobsError('')
    if (!dealId) return () => controller.abort()
    let timedOut = false
    setJobsLoading(true)
    const timer = setTimeout(() => { timedOut = true; controller.abort(); setJobsError('Processing history took too long. Retry when the connection is available.'); setJobsLoading(false) }, 30_000)
    listUploadJobs(dealId, controller.signal).then(result => { if (!controller.signal.aborted) setJobs(result) }).catch(reason => { if (!controller.signal.aborted) setJobsError(reason instanceof Error ? reason.message : 'Processing history unavailable.') }).finally(() => { clearTimeout(timer); if (!controller.signal.aborted || timedOut) setJobsLoading(false) })
    return () => { clearTimeout(timer); controller.abort() }
  }, [dealId, attempt])
  const open = (page: string) => { if (project) { onClose(); navigate(`/project/${project.id}/${page}`) } }
  const active = jobs.filter(job => job.status === 'queued' || job.status === 'processing'), failed = jobs.filter(job => job.status === 'failed')
  return <Dialog title="Workspace notifications" subtitle="Current evidence and processing alerts for a shared company." onClose={onClose}>
    <div className="dialog-body">
      {!linked.length ? <p>No shared company is connected yet. Create a project to start collecting evidence.</p> : <>
        <label>Company<select value={id} onChange={event => setId(event.target.value)}>{linked.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="dialog-actions"><button className="button secondary" disabled={loading || jobsLoading} onClick={() => { refresh(); setAttempt(value => value + 1) }}><Icon name={loading || jobsLoading ? 'loading' : 'history'} size={15} />{loading || jobsLoading ? 'Checking…' : 'Refresh alerts'}</button></div>
        {(error || jobsError) && <p className="form-error" role="alert">{error || jobsError}</p>}
        {active.length > 0 && <div className="notification"><Badge tone="blue">Processing</Badge><h3>{active.length} source {active.length === 1 ? 'file is' : 'files are'} processing</h3><p>{active.map(job => job.filename).join(', ')}</p><button className="text-button" onClick={() => open('data-room')}>Open processing history<Icon name="arrow" size={14} /></button></div>}
        {failed.length > 0 && <div className="notification"><Badge tone="amber">Upload needs attention</Badge><h3>{failed.length} failed {failed.length === 1 ? 'upload' : 'uploads'}</h3><p>Review the error and retry the source file in the data room.</p><button className="text-button" onClick={() => open('data-room')}>Review uploads<Icon name="arrow" size={14} /></button></div>}
        {report?.conflict_numbers && <div className="notification"><Badge tone="red">Conflict</Badge><h3>Conflicting source numbers</h3><p>Comparable stored values disagree. Original evidence is retained for review.</p><button className="text-button" onClick={() => open('dashboard')}>Inspect conflicts<Icon name="arrow" size={14} /></button></div>}
        {report && report.gaps.length > 0 && <div className="notification"><Badge tone="amber">Missing evidence</Badge><h3>{report.gaps.length} evidence {report.gaps.length === 1 ? 'gap' : 'gaps'}</h3><ul>{report.gaps.slice(0, 5).map((gap, index) => <li key={index}>{typeof gap.message === 'string' ? gap.message : humanize(String(gap.metric_key ?? gap.code ?? 'Supporting evidence missing'))}</li>)}</ul><button className="text-button" onClick={() => open('dashboard')}>Review evidence gaps<Icon name="arrow" size={14} /></button></div>}
        {!loading && !jobsLoading && report && !error && !jobsError && !active.length && !failed.length && !report.conflict_numbers && !report.gaps.length && <p className="preview-note">No current processing failures, numeric conflicts or recorded evidence gaps. Automatic checks do not replace human review.</p>}
      </>}
    </div>
  </Dialog>
}
