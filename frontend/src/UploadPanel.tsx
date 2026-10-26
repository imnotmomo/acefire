import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Icon } from './ui'
import { fetchUploadJob, listUploadJobs, uploadCompanyFile, validateUploadFile, UPLOAD_ACCEPT, WorkspaceApiError } from './workspaceApi'
import type { UploadJob, UploadProvider } from './workspaceApi'
import { applyUploadReceipt, mergeUploadReceipts } from './uploadHistory'
import type { UploadHistoryEntry } from './uploadHistory'
import { readBlob, readLocal, safeUrl } from './domain'
import type { LocalDocument } from './domain'
import { downloadBlob } from './export'
import './uploads.css'

type LocalUpload = UploadHistoryEntry
const storageKey = (dealId: string) => `ingenium:uploads:v1:${encodeURIComponent(dealId)}`
const dismissedKey = (dealId: string) => `ingenium:uploads-dismissed:v1:${encodeURIComponent(dealId)}`
const active = (job: Pick<LocalUpload, 'status'>) => job.status === 'queued' || job.status === 'processing'
function dismissedHistory(dealId: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(dismissedKey(dealId)) || '[]')
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length <= 200).slice(-1000) : [])
  } catch { return new Set() }
}

function readHistory(dealId: string): LocalUpload[] {
  try {
    if (typeof window === 'undefined') return []
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(dealId)) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((job): job is LocalUpload => Boolean(job) && typeof job === 'object'
      && job.dealId === dealId && typeof job.clientId === 'string' && typeof job.name === 'string'
      && (typeof job.size === 'number' && Number.isFinite(job.size) && job.size >= 0 || job.remoteOnly === true && job.size === null)
      && typeof job.type === 'string' && typeof job.added === 'string'
      && ['uploaded', 'orbis', 'pitchbook'].includes(job.provider)
      && ['uploading', 'queued', 'processing', 'completed', 'failed'].includes(job.status)
      && Array.isArray(job.warnings) && job.warnings.every((item: unknown) => typeof item === 'string')
      && (!active(job) || typeof job.serverId === 'string'))
      .map(job => job.status === 'uploading' ? { ...job, status: 'failed', error: 'The upload was interrupted before its receipt was confirmed. Retry with the original file.' } : job)
  } catch { return [] }
}

let uploadDb: Promise<IDBDatabase> | null = null
function fileDb(): Promise<IDBDatabase> {
  if (!uploadDb) uploadDb = new Promise((resolve, reject) => {
    const request = indexedDB.open('ingenium-upload-retries', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { uploadDb = null; reject(request.error) }
    request.onblocked = () => { uploadDb = null; reject(new Error('Browser file storage is blocked.')) }
  })
  return uploadDb
}
async function cachedFile(key: string, operation: 'read' | 'write' | 'delete', file?: Blob): Promise<Blob | undefined> {
  const db = await fileDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', operation === 'read' ? 'readonly' : 'readwrite')
    const store = transaction.objectStore('files')
    const request = operation === 'read' ? store.get(key) : operation === 'write' ? store.put(file, key) : store.delete(key)
    let value: Blob | undefined
    request.onsuccess = () => { if (request.result instanceof Blob) value = request.result }
    transaction.oncomplete = () => resolve(value)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
const fileKey = (job: LocalUpload) => `${job.dealId}:${job.clientId}`
const labels: Record<LocalUpload['status'], string> = { uploading: 'Uploading original', queued: 'Queued for extraction', processing: 'Reading source', completed: 'Evidence saved', failed: 'Needs attention' }
function legacyFiles(projectId?: string): LocalDocument[] {
  if (!projectId) return []
  const records = readLocal<unknown>(`acefire:documents:v1:${projectId}`, [])
  return Array.isArray(records) ? records.filter((item): item is LocalDocument => item && item.projectId === projectId
    && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.type === 'string'
    && typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0) : []
}
function withServerJob(local: LocalUpload, result: UploadJob): LocalUpload {
  return applyUploadReceipt(local, result)
}

export default function UploadPanel({ dealId, onComplete, legacyProjectId }: { dealId: string; onComplete?: () => void; legacyProjectId?: string }) {
  const [history, setHistory] = useState(() => ({ dealId, jobs: readHistory(dealId) }))
  const jobs = history.dealId === dealId ? history.jobs : []
  const historyRef = useRef(history); historyRef.current = history
  const companyRef = useRef(dealId); companyRef.current = dealId
  const mounted = useRef(true)
  const onCompleteRef = useRef(onComplete); onCompleteRef.current = onComplete
  const files = useRef(new Map<string, File>())
  const dismissed = useRef(dismissedHistory(dealId))
  const uploadControllers = useRef(new Set<AbortController>())
  const input = useRef<HTMLInputElement>(null)
  const [provider, setProvider] = useState<UploadProvider>('uploaded')
  const [notice, setNotice] = useState('')
  const [storageNotice, setStorageNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [legacyBusy, setLegacyBusy] = useState<string | null>(null)
  const [pollAttempt, setPollAttempt] = useState(0)
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const legacy = useMemo(() => legacyFiles(legacyProjectId), [legacyProjectId])

  function save(jobs: LocalUpload[]) {
    if (!mounted.current || companyRef.current !== dealId) return
    const next = { dealId, jobs: mergeUploadReceipts(jobs, [], dealId) }
    historyRef.current = next; setHistory(next)
    try { localStorage.setItem(storageKey(dealId), JSON.stringify(next.jobs)) }
    catch { setStorageNotice('Browser progress storage is unavailable. Keep this page open until processing finishes.') }
  }
  function update(clientId: string, transform: (job: LocalUpload) => LocalUpload) {
    if (companyRef.current !== dealId || historyRef.current.dealId !== dealId) return
    save(historyRef.current.jobs.map(job => job.clientId === clientId ? transform(job) : job))
  }
  useEffect(() => {
    mounted.current = true; files.current.clear(); dismissed.current = dismissedHistory(dealId); setNotice(''); setStorageNotice(''); setRetrying(null)
    const next = { dealId, jobs: readHistory(dealId) }; historyRef.current = next; setHistory(next)
    return () => { mounted.current = false; uploadControllers.current.forEach(controller => controller.abort()); uploadControllers.current.clear() }
  }, [dealId])

  useEffect(() => {
    const controller = new AbortController()
    const baseline = historyRef.current.dealId === dealId ? historyRef.current.jobs : []
    setHistoryLoading(true); setHistoryError('')
    listUploadJobs(dealId, controller.signal).then(receipts => {
      if (controller.signal.aborted || !mounted.current || companyRef.current !== dealId) return
      const visible = receipts.filter(receipt => active(receipt) || !dismissed.current.has(receipt.id))
      const current = historyRef.current.dealId === dealId ? historyRef.current.jobs : []
      const completed = visible.some(receipt => receipt.status === 'completed' && !current.some(job => job.serverId === receipt.id && job.status === 'completed'))
      save(mergeUploadReceipts(current, visible, dealId, baseline))
      if (completed) onCompleteRef.current?.()
    }).catch(error => {
      if (!controller.signal.aborted && mounted.current && companyRef.current === dealId) setHistoryError(error instanceof Error ? error.message : 'Shared processing history could not be loaded. Local receipts are preserved.')
    }).finally(() => { if (!controller.signal.aborted && mounted.current && companyRef.current === dealId) setHistoryLoading(false) })
    return () => controller.abort()
  }, [dealId, historyAttempt])

  const pollingIds = jobs.filter(job => active(job) && job.serverId).map(job => `${job.clientId}:${job.serverId}`).join('|')
  useEffect(() => {
    if (!pollingIds) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      const pending = historyRef.current.dealId === dealId ? historyRef.current.jobs.filter(job => active(job) && job.serverId) : []
      let changed = false
      await Promise.all(pending.map(async job => {
        try {
          const result = await fetchUploadJob(dealId, job.serverId!, controller.signal)
          if (controller.signal.aborted || companyRef.current !== dealId) return
          update(job.clientId, current => withServerJob(current, result))
          if (result.status === 'completed') {
            files.current.delete(job.clientId); void cachedFile(fileKey(job), 'delete').catch(() => {})
            changed = true
          }
        } catch (error) {
          if (!controller.signal.aborted && companyRef.current === dealId) update(job.clientId, current => error instanceof WorkspaceApiError && error.status === 404
            ? { ...current, status: 'failed', pollError: undefined, error: 'This processing job is no longer available on the server. Retry the original file to start a new job.' }
            : { ...current, pollError: error instanceof Error ? error.message : 'Processing status could not be checked. Retrying automatically.' })
        }
      }))
      if (controller.signal.aborted || companyRef.current !== dealId) return
      if (changed) onCompleteRef.current?.()
      timer = setTimeout(poll, 2000)
    }
    void poll()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
    // Job receipts, rather than every status update, define this polling lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, pollingIds, pollAttempt])

  async function send(job: LocalUpload, file: File) {
    const controller = new AbortController(); uploadControllers.current.add(controller)
    files.current.set(job.clientId, file)
    update(job.clientId, current => ({ ...current, status: 'uploading', serverId: undefined, error: undefined, pollError: undefined }))
    try {
      try { await cachedFile(fileKey(job), 'write', file) }
      catch { if (mounted.current && companyRef.current === dealId) setStorageNotice('The original cannot be cached in this browser. If this upload fails after leaving the page, select the file again to retry.') }
      if (controller.signal.aborted) return
      const result = await uploadCompanyFile(dealId, file, job.provider, controller.signal)
      if (controller.signal.aborted || companyRef.current !== dealId) return
      update(job.clientId, current => withServerJob(current, result))
      if (result.status === 'completed') { files.current.delete(job.clientId); void cachedFile(fileKey(job), 'delete').catch(() => {}); onCompleteRef.current?.() }
    } catch (error) {
      if (!controller.signal.aborted && companyRef.current === dealId) update(job.clientId, current => ({ ...current, status: 'failed', error: error instanceof Error ? error.message : 'The upload could not be confirmed. Retry the original file.' }))
    } finally { uploadControllers.current.delete(controller) }
  }
  async function choose(selected: FileList | File[] | null, legacyId?: string) {
    if (!selected?.length) return
    // input.files is live: clearing the chooser first empties that FileList.
    const selectedFiles = Array.from(selected)
    setNotice('')
    const available = 8 - historyRef.current.jobs.filter(job => active(job) || job.status === 'uploading').length
    if (input.current) input.current.value = ''
    if (selectedFiles.length > available) { setNotice(`Up to eight files can be uploaded or processed at once. Choose ${Math.max(0, available)} or fewer, or wait for existing jobs.`); return }
    const accepted: { job: LocalUpload; file: File }[] = []
    const rejected: string[] = []
    for (const file of selectedFiles) {
      try {
        validateUploadFile(file)
        accepted.push({ file, job: { clientId: crypto.randomUUID(), dealId, name: file.name, size: file.size, type: file.type,
          provider, added: new Date().toISOString(), status: 'uploading', warnings: [], ...(legacyId ? { legacyId } : {}) } })
      } catch (error) { rejected.push(`${file.name}: ${error instanceof Error ? error.message : 'Unsupported file.'}`) }
    }
    if (rejected.length) setNotice(rejected.join('\n'))
    save([...accepted.map(item => item.job), ...historyRef.current.jobs])
    if (input.current) input.current.value = ''
    // Each request receives its own durable server job before the next file starts.
    for (const { job, file } of accepted) {
      if (!mounted.current || companyRef.current !== dealId) break
      await send(job, file)
    }
  }
  async function retry(job: LocalUpload) {
    if (retrying) return
    setRetrying(job.clientId)
    try {
      const blob = files.current.get(job.clientId) ?? await cachedFile(fileKey(job), 'read')
      if (!mounted.current || companyRef.current !== dealId) return
      if (!blob) { update(job.clientId, current => ({ ...current, error: 'The original file is no longer available in this browser. Use Upload files to select it again.' })); return }
      await send(job, new File([blob], job.name, { type: job.type }))
    } catch { if (mounted.current && companyRef.current === dealId) update(job.clientId, current => ({ ...current, error: 'The saved original could not be read. Use Upload files to select it again.' })) }
    finally { if (mounted.current && companyRef.current === dealId) setRetrying(null) }
  }
  async function openLegacy(document: LocalDocument, upload: boolean) {
    if (legacyBusy) return
    setLegacyBusy(document.id); setNotice('')
    try {
      const blob = await readBlob(document.id)
      if (!mounted.current || companyRef.current !== dealId) return
      if (!blob) { setNotice(`${document.name}: the saved file bytes are missing. Select the original using Upload files to restore it.`); return }
      if (upload) await choose([new File([blob], document.name, { type: document.type })], document.id)
      else downloadBlob(blob, document.name)
    } catch { if (mounted.current && companyRef.current === dealId) setNotice(`${document.name}: the browser could not read this saved file. Select the original using Upload files.`) }
    finally { if (mounted.current && companyRef.current === dealId) setLegacyBusy(null) }
  }
  const pending = jobs.filter(job => active(job) || job.status === 'uploading').length
  return <section className="company-uploads" aria-label="Upload company evidence">
    <div className={`company-upload-drop ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void choose(event.dataTransfer.files) }}>
      <span className="company-upload-icon"><Icon name="upload" size={25} /></span>
      <div><h3>Add evidence to this company</h3><p>PDFs, Word, PowerPoint, images, CSV/TSV, XLSX, text and JSON. Original files stay linked to extracted claims and numbers.</p><small>Up to 50 MiB per file. Extraction is automatic; source-supported results still need review.</small></div>
      <button className="button primary" disabled={pending >= 8} onClick={() => input.current?.click()}><Icon name="plus" size={15} />Upload files</button>
    </div>
    <input ref={input} className="sr-only" type="file" multiple accept={UPLOAD_ACCEPT} aria-label="Upload company source files" onChange={event => { void choose(event.target.files) }} />
    <div className="company-upload-options"><label>Source attribution<select aria-label="Upload source attribution" value={provider} onChange={event => setProvider(event.target.value as UploadProvider)}><option value="uploaded">Company / user document</option><option value="orbis">Orbis export</option><option value="pitchbook">PitchBook export</option></select></label><span>Attribution records the selected origin; it does not verify the source’s identity.</span></div>
    {notice && <p className="company-upload-notice" role="alert">{notice}</p>}
    {storageNotice && <p className="company-upload-notice" role="status">{storageNotice}</p>}
    <div className="company-upload-options"><span role="status">{historyLoading ? 'Loading shared processing history…' : 'Processing receipts are shared across browsers; original retry copies stay in the browser that selected them.'}</span>{dismissed.current.size > 0 && <button className="text-button" disabled={historyLoading} onClick={() => { dismissed.current.clear(); try { localStorage.removeItem(dismissedKey(dealId)) } catch { /* In-memory history can still be restored. */ }; setHistoryAttempt(value => value + 1) }}>Show dismissed receipts</button>}<button className="text-button" disabled={historyLoading} onClick={() => setHistoryAttempt(value => value + 1)}>Refresh processing history<Icon name="history" size={13} /></button></div>
    {historyError && <p className="company-upload-notice" role="alert">{historyError} Your existing upload receipts are preserved; refresh processing history to retry.</p>}
    {legacy.length > 0 && <section className="legacy-source-bridge" aria-label="Preserved browser sources"><h3>Previously saved in this browser</h3><p>These files and links were kept with your original project. Add a file to the company evidence explicitly; your browser copy remains available.</p>{legacy.map(document => {
      const submitted = jobs.find(job => job.legacyId === document.id)
      const link = document.url ? safeUrl(document.url) : null
      let supported = true
      try { validateUploadFile(document) } catch { supported = false }
      return <div className="legacy-source" key={document.id}><div><strong>{document.name}</strong><small>{document.url ? 'Saved link · content not retrieved' : submitted ? labels[submitted.status] : 'Browser-only original'}</small></div>{link ? <a className="button secondary" href={link} target="_blank" rel="noopener noreferrer">Open saved link<Icon name="outward" size={13} /></a> : !document.url && <><button className="button secondary" disabled={Boolean(legacyBusy)} onClick={() => { void openLegacy(document, false) }}>Download browser copy<Icon name="download" size={13} /></button>{!submitted && supported && <button className="button secondary" disabled={Boolean(legacyBusy) || pending >= 8} onClick={() => { void openLegacy(document, true) }}><Icon name={legacyBusy === document.id ? 'loading' : 'upload'} size={13} />Add to company evidence</button>}{submitted?.status === 'failed' && <span className="legacy-source-note">Use Retry file in processing history.</span>}{!supported && <span className="legacy-source-note">Download this original; its format or size requires a supported copy for extraction.</span>}</>}</div>
    })}</section>}
    {jobs.length > 0 && <div className="upload-jobs"><div className="upload-jobs-heading"><h3>Processing history{pending > 0 && <Badge>{pending} active</Badge>}</h3>{pending > 0 && <button className="text-button" onClick={() => setPollAttempt(value => value + 1)}>Check status<Icon name="history" size={13} /></button>}</div>{jobs.map(job => <article className={`upload-job ${job.status}`} key={job.clientId} aria-label={`${job.name} processing`}>
      <Icon name={active(job) || job.status === 'uploading' ? 'loading' : job.status === 'completed' ? 'fileCheck' : 'help'} size={18} />
      <div><strong>{job.name}</strong><span className="upload-job-status" role="status">{labels[job.status]} · {job.size === null ? 'Shared upload receipt' : `${(job.size / 1024).toFixed(1)} KiB`}</span>
        {job.status === 'completed' && <p>{job.claims !== undefined ? `${job.claims} source claims` : 'Source evidence'}{job.observations !== undefined ? ` · ${job.observations} numeric observations` : ''}. Available in this company’s dashboard, report and chat.</p>}
        {(job.error || job.status === 'failed') && <p className="upload-job-error" role="alert">{job.error || 'Processing failed. Review the warnings or retry the original file.'}{job.remoteOnly && ' This browser has no original retry copy. Select the original file to upload it again.'}</p>}{job.pollError && <p className="upload-job-error">{job.pollError} Status checks continue automatically.</p>}
        {job.warnings.length > 0 && <details><summary>Source warnings ({job.warnings.length})</summary><ul>{job.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      </div>
      {job.status === 'failed' && <button className="button secondary" disabled={Boolean(retrying) || pending >= 8} onClick={() => { if (job.remoteOnly) { setNotice(`${job.name}: select the original file using Upload files. The server receipt does not contain a browser retry copy.`); input.current?.click() } else void retry(job) }}><Icon name={retrying === job.clientId ? 'loading' : 'history'} size={14} />{job.remoteOnly ? 'Select original file' : 'Retry file'}</button>}
      {!active(job) && job.status !== 'uploading' && <button className="icon-button" aria-label={`Dismiss ${job.name} processing history`} title="Hide this receipt in this browser. Company evidence is preserved." onClick={() => { if (job.serverId) { dismissed.current.add(job.serverId); try { localStorage.setItem(dismissedKey(dealId), JSON.stringify([...dismissed.current].slice(-1000))) } catch { /* Current-page dismissal still works. */ } }; save(historyRef.current.jobs.filter(item => item.clientId !== job.clientId)); files.current.delete(job.clientId); void cachedFile(fileKey(job), 'delete').catch(() => {}) }}><Icon name="x" size={14} /></button>}
    </article>)}</div>}
  </section>
}
