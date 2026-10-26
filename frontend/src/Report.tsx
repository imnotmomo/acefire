import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { MODULES, evidenceForModule, EVIDENCE } from './data'
import type { ModuleId } from './data'
import { defaultConfig, defaultBackendConfig, generateSections, generatedDraftToSections, reorder, citedEvidenceIds, backendDraftEvidenceStatus, readLocal, saveLocal } from './domain'
import { apiFetch, reportEvidence } from './backend'
import type { CompanyReport } from './backend'
import type { ModuleConfig, Workspace, Project, Section, Revision } from './domain'
import { Badge, Dialog, Empty, Icon } from './ui'
import { exportReport } from './export'
import ReportReview from './ReportReview'
import { refreshReportSourceReferences } from './reportReferences'
import { assertReportOperationCurrent } from './reportOperations'
import { checkedSharedReport, checkedSharedReportList, checkedSharedWorkspace, sharedReportError, workspaceForDraftPreferences } from './sharedReports'
import type { SharedReportSummary } from './sharedReports'

const REPORT_WAIT_MS = 180_000
async function reportResponse(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`The report API returned an unreadable response (HTTP ${response.status}). Check the backend connection and retry; your local draft is preserved.`)
  return response.json()
}

type Props = { project: Project; workspace: Workspace; setWorkspace: Dispatch<SetStateAction<Workspace>>; stage: string; navigate: (path: string) => void; inspect: (id: string) => void; notify: (message: string) => void; backendReport?: CompanyReport; onRefresh?: () => void }

export default function Report(props: Props) {
  const { project, workspace, setWorkspace, stage, navigate, inspect, notify, backendReport } = props
  const moduleDefaults = (id: ModuleId) => backendReport ? defaultBackendConfig(id) : defaultConfig(id)
  const evidenceCatalog = useMemo(() => backendReport ? reportEvidence(backendReport) : EVIDENCE, [backendReport])
  const checkedReferences = workspace.backendEvidenceCheckedReportId === workspace.backendEvidenceReferenceCheck?.checkedReportId && workspace.backendEvidenceCheckedAt === workspace.backendEvidenceReferenceCheck?.checkedAt ? workspace.backendEvidenceReferenceCheck : undefined
  const exportContext = backendReport ? { kind: 'backend' as const, reportId: workspace.backendReportId, loadedReportId: backendReport.report_id, reportVersion: workspace.backendReportVersion, draftId: workspace.backendDraftId, model: workspace.backendDraftModel,
    evidenceCheckedReportId: workspace.backendEvidenceCheckedReportId, evidenceCheckedAt: workspace.backendEvidenceCheckedAt, referenceCheck: checkedReferences } : { kind: 'snapshot' as const }
  const [active, setActive] = useState<ModuleId>(workspace.order[0] ?? 'market')
  const [moduleSearch, setModuleSearch] = useState('')
  const [dragged, setDragged] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [draftingProblem, setDraftingProblem] = useState<'modules' | 'sources' | null>(null)
  const generationErrorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (generationError && draftingProblem !== 'modules') generationErrorRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  }, [generationError, draftingProblem])
  const [referenceError, setReferenceError] = useState('')
  const [staleEvidence, setStaleEvidence] = useState(false)
  const latestReportId = useRef(backendReport?.report_id)
  latestReportId.current = backendReport?.report_id
  const generationController = useRef<AbortController | null>(null)
  const generationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestWorkspace = useRef(workspace)
  latestWorkspace.current = workspace
  useEffect(() => () => { generationController.current?.abort(); if (generationTimer.current) clearTimeout(generationTimer.current) }, [project.id])
  const [history, setHistory] = useState(false)
  const [editing, setEditing] = useState<Section | null>(null)
  const [editText, setEditText] = useState('')
  const [format, setFormat] = useState<'PDF' | 'DOCX' | 'Markdown'>('PDF')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [sharedDrafts, setSharedDrafts] = useState<SharedReportSummary[]>([])
  const [sharedListError, setSharedListError] = useState('')
  const [sharedLoading, setSharedLoading] = useState(false)
  const [sharedRefresh, setSharedRefresh] = useState(0)
  const [saveConflict, setSaveConflict] = useState(false)
  const recoveryKey = `acefire:report-recovery:v1:${project.id}`
  const [recovery, setRecovery] = useState<Workspace | null>(() => {
    try { const value = readLocal<unknown>(recoveryKey, null); return value ? checkedSharedWorkspace(value, backendReport?.company.deal_id ?? '', 4_000_000) : null } catch { return null }
  })
  const dealId = backendReport?.company.deal_id
  useEffect(() => {
    if (!dealId) return
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(() => controller.abort(), 20_000)
    setSharedLoading(true); setSharedListError('')
    void (async () => {
      try {
        const response = await apiFetch(`/deals/${encodeURIComponent(dealId)}/report-drafts`, { signal: controller.signal, headers: { Accept: 'application/json' } })
        const payload: unknown = await reportResponse(response)
        if (!response.ok) throw new Error(sharedReportError(payload, response.status).message)
        const drafts = checkedSharedReportList(payload)
        if (!controller.signal.aborted) setSharedDrafts(drafts)
      } catch (error) {
        if (active && !controller.signal.aborted) setSharedListError(error instanceof Error ? error.message : 'Shared reports could not be loaded.')
        else if (active) setSharedListError('Shared report listing timed out. Retry to check saved reports.')
      } finally { clearTimeout(timer); if (active) setSharedLoading(false) }
    })()
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [dealId, sharedRefresh])

  const visibleModules = MODULES.filter(module => `${module.name} ${module.description}`.toLowerCase().includes(moduleSearch.toLowerCase()))
  const selected = MODULES.find(module => module.id === active)!
  const configurableTopics = backendReport && active === 'financials' ? [...selected.topics, 'Other financial records'] : selected.topics
  const config = workspace.configs[active] ?? moduleDefaults(active)
  const base = `/project/${project.id}/report/`
  const selectedCount = workspace.order.length
  const sourceCount = backendReport ? evidenceCatalog.length : project.id === 'enfuce' ? new Set(workspace.order.flatMap(evidenceForModule)).size : 0
  const hasDraftingEvidence = !backendReport || sourceCount > 0
  const draftEvidenceStatus = backendReport ? backendDraftEvidenceStatus(workspace.sections, workspace.backendReportId, backendReport.report_id, evidenceCatalog, checkedReferences, backendReport.company.deal_id) : null
  const exportBlocked = Boolean(draftEvidenceStatus?.blocked)
  const configChanged = workspace.sections.length > 0 && (JSON.stringify(workspace.sections.map(s => s.id)) !== JSON.stringify(workspace.order) || workspace.sections.some(section => JSON.stringify(section.config) !== JSON.stringify(workspace.configs[section.id] ?? moduleDefaults(section.id))))

  useEffect(() => {
    if (stage !== 'build') return
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || target?.closest('input,textarea,select,[contenteditable="true"]') || document.querySelector('[role="dialog"]')) return
      const search = document.querySelector<HTMLInputElement>('[aria-label="Search modules"]')
      if (search) { event.preventDefault(); search.focus() }
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [stage])
  function updateConfig(patch: Partial<ModuleConfig>) {
    setWorkspace(previous => ({ ...previous, configs: { ...previous.configs, [active]: { ...(previous.configs[active] ?? moduleDefaults(active)), ...patch } } }))
  }
  function addModule(id: ModuleId) {
    setActive(id)
    if (!workspace.order.includes(id)) setWorkspace(previous => ({ ...previous, order: [...previous.order, id] }))
  }
  function move(from: number, to: number) { setWorkspace(previous => ({ ...previous, order: reorder(previous.order, from, to) })) }
  function stopWaiting(message = 'Stopped waiting for the report request. Your current draft and settings are preserved. The server may still finish processing the request.') {
    generationController.current?.abort()
    generationController.current = null
    if (generationTimer.current) clearTimeout(generationTimer.current)
    generationTimer.current = null
    setGenerating(false); setGenerationError(message)
  }
  function startReportRequest() {
    setDraftingProblem(null)
    const controller = new AbortController()
    generationController.current = controller
    generationTimer.current = setTimeout(() => {
      if (generationController.current === controller) stopWaiting('The report request took too long. Your current draft and settings are preserved. Retry, or load a saved report if the server finished processing it.')
    }, REPORT_WAIT_MS)
    return controller
  }
  function finishReportRequest(controller: AbortController) {
    if (generationController.current !== controller) return
    generationController.current = null
    if (generationTimer.current) clearTimeout(generationTimer.current)
    generationTimer.current = null
    setGenerating(false)
  }
  function focusModuleLibrary() {
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search modules"]')
    search?.focus()
    search?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  }
  async function generate() {
    if (generationController.current) return
    if (!workspace.order.length) {
      setDraftingProblem('modules'); setStaleEvidence(false)
      setGenerationError('Choose at least one report module from the module library, then generate the report.')
      focusModuleLibrary()
      return
    }
    if (!hasDraftingEvidence) {
      setDraftingProblem('sources'); setStaleEvidence(false)
      setGenerationError('No extracted company evidence is available yet. Add and process source files in the Data room, then refresh company evidence before generating a report.')
      notify('The report needs source evidence. Open the Data room to add files.')
      return
    }
    setDraftingProblem(null)
    const controller = startReportRequest()
    const requestedWorkspace = structuredClone(workspace)
    setGenerating(true); setGenerationError(''); setReferenceError(''); setStaleEvidence(false)
    try {
      let nextSections: Section[]
      let persistedVersion: number | undefined
      if (backendReport) {
        const sections = requestedWorkspace.order.map(id => { const module = MODULES.find(item => item.id === id)!; return { id, title: module.name, ...(requestedWorkspace.configs[id] ?? defaultBackendConfig(id)) } })
        const response = await apiFetch(`/deals/${encodeURIComponent(backendReport.company.deal_id)}/report/draft`, { method: 'POST', signal: controller.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ based_on_report_id: backendReport.report_id, sections }) })
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The report API did not return JSON. Check the backend connection.')
        const payload: unknown = await reportResponse(response)
        if (!response.ok) {
          if (response.status === 409) setStaleEvidence(true)
          const detail = payload && typeof payload === 'object' && 'detail' in payload ? (payload as { detail: unknown }).detail : undefined
          const message = typeof detail === 'string' ? detail : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string' ? detail.message : `The report service could not generate this draft (HTTP ${response.status}).`
          throw new Error(message.slice(0, 500))
        }
        nextSections = generatedDraftToSections(project, requestedWorkspace, backendReport, reportEvidence(backendReport), payload)
        if (payload && typeof payload === 'object' && 'persisted_version' in payload && Number.isSafeInteger(payload.persisted_version) && Number(payload.persisted_version) > 0) persistedVersion = Number(payload.persisted_version)
      } else nextSections = generateSections(project, requestedWorkspace)
      if (controller.signal.aborted) return
      assertReportOperationCurrent(requestedWorkspace, latestWorkspace.current, backendReport?.report_id, latestReportId.current)
      rememberLocalCopy(requestedWorkspace)
      const now = new Date().toISOString()
      const metadata = nextSections[0]?.generation
      setWorkspace(previous => ({ ...previous, sections: nextSections, generatedAt: now, backendReportId: backendReport?.report_id, backendReportVersion: backendReport?.report_version, backendDraftId: metadata?.draftId, backendDraftModel: metadata?.model, backendDraftGeneratedAt: metadata?.generatedAt, backendEvidenceCheckedReportId: undefined, backendEvidenceCheckedAt: undefined, backendEvidenceReferenceCheck: undefined, sharedDraftId: persistedVersion ? metadata?.draftId : undefined, sharedDraftVersion: persistedVersion, sharedSavedAt: persistedVersion ? now : undefined, revisions: [...previous.revisions, ...previous.sections.filter(old => nextSections.some(next => next.id === old.id && next.content !== old.content)).map(old => ({ id: crypto.randomUUID(), at: now, section: old.id, title: old.title, before: old.content, after: nextSections.find(next => next.id === old.id)!.content, author: backendReport ? 'Model narrative regeneration' : 'Snapshot regeneration' }))] }))
      setSharedRefresh(value => value + 1)
      navigate(`${base}review`)
      notify(backendReport ? 'Model draft generated with source quotations. Review summaries and inferences against the original text.' : 'Evidence preview generated. Review source links and unresolved questions.')
    } catch (reason) {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : 'Report generation failed.'
        setGenerationError(`${message} Your current draft and edits have been kept.`)
        notify('Report generation failed. Your draft and edits are preserved.')
      }
    } finally {
      finishReportRequest(controller)
    }
  }
  async function loadStored(id: string) {
    if (!backendReport || generationController.current) return
    const controller = startReportRequest()
    const previous = structuredClone(workspace)
    setGenerating(true); setGenerationError(''); setReferenceError('')
    try {
      const response = await apiFetch(`/deals/${encodeURIComponent(backendReport.company.deal_id)}/stored-reports/${encodeURIComponent(id)}/draft`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`The saved report could not be loaded (HTTP ${response.status}).`)
      const payload = await reportResponse(response) as Record<string, unknown>
      if (controller.signal.aborted) return
      const requested = workspaceForDraftPreferences(previous, payload, backendReport.company.deal_id)
      const { order, configs } = requested
      const sections = generatedDraftToSections(project, requested, backendReport, reportEvidence(backendReport), payload)
      assertReportOperationCurrent(previous, latestWorkspace.current, backendReport.report_id, latestReportId.current)
      rememberLocalCopy(previous)
      const now = new Date().toISOString()
      const metadata = sections[0]?.generation
      setWorkspace(current => ({ ...current, order, configs, sections, generatedAt: now,
        backendReportId: backendReport.report_id, backendReportVersion: backendReport.report_version,
        backendDraftId: metadata?.draftId, backendDraftModel: metadata?.model, backendDraftGeneratedAt: metadata?.generatedAt,
        backendEvidenceCheckedReportId: undefined, backendEvidenceCheckedAt: undefined, backendEvidenceReferenceCheck: undefined, sharedDraftId: undefined, sharedDraftVersion: undefined, sharedSavedAt: undefined,
        revisions: [...current.revisions, ...current.sections.map(section => ({ id: crypto.randomUUID(), at: now, section: section.id, title: section.title, before: section.content, after: sections.find(next => next.id === section.id)?.content ?? '', author: 'Loaded stored report' }))] }))
      navigate(base + 'review'); notify('Saved report loaded with its original quotations. Automated review still requires human verification.')
    } catch (reason) {
      if (!controller.signal.aborted) setGenerationError(`${reason instanceof Error ? reason.message : 'The saved report could not be loaded.'} Your current draft and edits have been kept.`)
    } finally { finishReportRequest(controller) }
  }
  function rememberLocalCopy(copy: Workspace) {
    if (!copy.sections.length) return
    if (!saveLocal(recoveryKey, copy)) throw new Error('A recovery copy could not be saved in this browser. Export your local draft or free browser storage before replacing it.')
    setRecovery(structuredClone(copy))
  }
  async function saveShared(asNew = false) {
    if (!backendReport || generationController.current || !workspace.sections.length) return
    const controller = startReportRequest()
    const copy = structuredClone(workspace)
    setGenerating(true); setGenerationError(''); setSaveConflict(false); setStaleEvidence(false)
    try {
      checkedSharedWorkspace(copy, backendReport.company.deal_id)
      const update = !asNew && Boolean(copy.sharedDraftId && copy.sharedDraftVersion)
      const path = `/deals/${encodeURIComponent(backendReport.company.deal_id)}/report-drafts${update ? `/${encodeURIComponent(copy.sharedDraftId!)}` : ''}`
      const response = await apiFetch(path, { method: update ? 'PUT' : 'POST', signal: controller.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(update ? { expected_version: copy.sharedDraftVersion, workspace: copy } : { based_on_report_id: backendReport.report_id, workspace: copy }) })
      const payload: unknown = await reportResponse(response)
      if (!response.ok) {
        const failure = sharedReportError(payload, response.status)
        setSaveConflict(failure.conflict); setStaleEvidence(response.status === 409 && !failure.conflict)
        throw new Error(failure.message)
      }
      const record = checkedSharedReport(payload, backendReport.company.deal_id)
      if (controller.signal.aborted) return
      // A successful save acknowledges the submitted copy, never overwrites newer local edits.
      setWorkspace(current => ({ ...current, sharedDraftId: record.id, sharedDraftVersion: record.version, sharedSavedAt: record.updated_at }))
      setSharedRefresh(value => value + 1)
      notify(`Shared report saved as version ${record.version}. Any edits made during saving remain local until the next save.`)
    } catch (error) {
      if (!controller.signal.aborted) setGenerationError(error instanceof Error ? error.message : 'The shared report could not be saved. Your local draft is preserved.')
    } finally { finishReportRequest(controller) }
  }
  async function loadShared(id: string) {
    if (!backendReport || generationController.current) return
    const controller = startReportRequest()
    const before = structuredClone(workspace)
    setGenerating(true); setGenerationError(''); setSaveConflict(false)
    try {
      const response = await apiFetch(`/deals/${encodeURIComponent(backendReport.company.deal_id)}/report-drafts/${encodeURIComponent(id)}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      const payload: unknown = await reportResponse(response)
      if (!response.ok) throw new Error(sharedReportError(payload, response.status).message)
      const record = checkedSharedReport(payload, backendReport.company.deal_id)
      let saved = record.workspace
      if (!saved) {
        const requested = workspaceForDraftPreferences(before, record.draft, backendReport.company.deal_id)
        const sections = generatedDraftToSections(project, requested, { ...backendReport, report_id: record.based_on_report_id }, reportEvidence(backendReport), record.draft)
        const generation = sections[0]?.generation
        saved = { ...requested, sections, revisions: [], generatedAt: generation?.generatedAt ?? record.created_at, backendReportId: record.based_on_report_id,
          backendReportVersion: undefined, backendDraftId: generation?.draftId, backendDraftModel: generation?.model, backendDraftGeneratedAt: generation?.generatedAt,
          backendEvidenceCheckedReportId: undefined, backendEvidenceCheckedAt: undefined, backendEvidenceReferenceCheck: undefined }
      }
      if (controller.signal.aborted) return
      if (saved.backendDraftId && saved.backendReportId === backendReport.report_id) {
        // Check retained original support only; this never verifies or rewrites human wording.
        refreshReportSourceReferences(project, saved, backendReport, reportEvidence(backendReport))
      }
      assertReportOperationCurrent(before, latestWorkspace.current, backendReport.report_id, latestReportId.current)
      rememberLocalCopy(before)
      setWorkspace({ ...saved, sharedDraftId: record.id, sharedDraftVersion: record.version, sharedSavedAt: record.updated_at })
      navigate(base + 'review'); notify(`Shared version ${record.version} loaded. Your previous local copy is available to restore below.`)
    } catch (error) {
      if (!controller.signal.aborted) setGenerationError(error instanceof Error ? error.message : 'The shared report could not be loaded. Your local draft is preserved.')
    } finally { finishReportRequest(controller) }
  }
  function restoreLocalCopy() {
    if (!recovery || generating) return
    const copy = structuredClone(recovery)
    try { rememberLocalCopy(workspace); setWorkspace(copy); setGenerationError(''); setSaveConflict(false); notify('Previous local copy restored. Shared reports are unchanged.') }
    catch (error) { setGenerationError(error instanceof Error ? error.message : 'The recovery copy could not be restored.') }
  }
  function saveRevision(section: Section, content: string, author = 'You') {
    if (content === section.content) { setEditing(null); return }
    setWorkspace(previous => ({ ...previous, sections: previous.sections.map(s => s.id === section.id ? { ...s, content, humanEdited: Boolean(s.generation) || s.humanEdited } : s), revisions: [...previous.revisions, { id: crypto.randomUUID(), at: new Date().toISOString(), section: section.id, title: section.title, before: section.content, after: content, author }] }))
    setEditing(null); notify('Revision saved. Edited claims need human verification.')
  }
  function restoreRevision(revision: Revision, version: 'before' | 'after') {
    const section = workspace.sections.find(item => item.id === revision.section)
    if (!section) return
    saveRevision(section, revision[version], 'You · restored revision')
    setHistory(false)
  }
  function refreshReferences() {
    if (!backendReport || generating) return
    setReferenceError('')
    try {
      const checked = refreshReportSourceReferences(project, workspace, backendReport, reportEvidence(backendReport))
      setWorkspace(previous => previous.backendReportId === workspace.backendReportId ? { ...previous,
        backendEvidenceCheckedReportId: checked.backendEvidenceCheckedReportId,
        backendEvidenceCheckedAt: checked.backendEvidenceCheckedAt,
        backendEvidenceReferenceCheck: checked.backendEvidenceReferenceCheck } : previous)
      notify('Source references refreshed. Your draft text and original generation basis are preserved; human edits remain unverified.')
    } catch (error) { setReferenceError(error instanceof Error ? error.message.slice(0, 600) : 'Source references could not be refreshed. Your draft text is unchanged.') }
  }

  return <>
    <div className="page-heading"><div><div className="heading-line"><h1>Report</h1><Badge tone="green">Draft</Badge></div></div><div className="heading-actions"><span className="autosave"><Icon name="check" size={14} /> Saved in this browser</span>{backendReport && <button className="button secondary" disabled={generating || !workspace.sections.length} onClick={() => saveShared()}><Icon name="check" size={15} />Save changes</button>}<button className="button secondary" onClick={() => setHistory(true)}><Icon name="history" size={16} /><span>Version history</span>{workspace.revisions.length > 0 && <span className="button-count">{workspace.revisions.length}</span>}</button></div></div>
    <div className="report-steps" aria-label="Report stages">{[['build', 'Build', 'Choose & customize'], ['review', 'Review', 'Read & verify'], ['export', 'Export', 'Ready to share']].map(([id, label, subtitle], index) => <button key={id} className={`step ${stage === id ? 'active' : ''}`} onClick={() => navigate(base + id)} aria-current={stage === id ? 'step' : undefined}><span className="step-number">{index + 1}</span><span><strong>{label}</strong><small>{subtitle}</small></span>{index < 2 && <Icon name="chevron" size={16} className="step-divider" />}</button>)}</div>
    {backendReport && workspace.sections.length > 0 && exportBlocked && <div className="build-changes-note" role="status"><Icon name="help" size={15} /><span>{draftEvidenceStatus?.stale ? 'Backend evidence has changed since this draft was generated.' : 'Some source citations are unavailable in the loaded backend report.'} Your edits are preserved. Refresh unchanged source references to keep your draft, or explicitly regenerate in Build.{Boolean(draftEvidenceStatus?.missingIds.length) && ` Restore or remove ${draftEvidenceStatus!.missingIds.length} unavailable source reference(s) before refreshing.`}</span><button className="button secondary" disabled={generating} onClick={refreshReferences}>Refresh source references<Icon name="link" size={14} /></button><button className="button secondary" onClick={() => navigate(base + 'build')}>Return to Build</button></div>}
    {draftEvidenceStatus?.referencesRefreshed && <div className="build-changes-note" role="status"><Icon name="link" size={15} /><span>Source references were checked against the current evidence at {workspace.backendEvidenceCheckedAt}. The original draft basis is retained. Your wording and human edits were not rewritten or reverified.</span></div>}
    {referenceError && <div className="calculation-error" role="alert"><Icon name="help" size={17} /><span>{referenceError}</span></div>}
    {generationError && <div ref={generationErrorRef} className="calculation-error" role="alert"><Icon name="help" size={17} /><span>{generationError}</span>{draftingProblem === 'sources' && <button className="button secondary" onClick={() => navigate(`/project/${project.id}/data-room`)}>Open Data room<Icon name="upload" size={14} /></button>}{draftingProblem === 'modules' && <button className="button secondary" onClick={focusModuleLibrary}>Choose report modules</button>}{staleEvidence && props.onRefresh && <button className="button secondary" onClick={() => { props.onRefresh?.(); setStaleEvidence(false) }}>Refresh company evidence</button>}</div>}
    {generating && <div className="build-changes-note" role="status"><Icon name="loading" size={17} /><span>Working on your report. Your existing draft remains available while the request runs.</span><button className="button secondary" onClick={() => stopWaiting()}>Stop waiting</button></div>}
    {backendReport && <section className="stored-report-list" aria-label="Shared report versions"><div><h3>Shared reports</h3><p>{workspace.sharedDraftId ? `Connected to shared version ${workspace.sharedDraftVersion}. ` : ''}Draft edits save in this browser. Use Save changes to share the current text and settings with your team.</p></div><div className="shared-report-actions"><button className="button secondary" disabled={sharedLoading} onClick={() => setSharedRefresh(value => value + 1)}><Icon name="history" size={14} />{sharedLoading ? 'Checking saved reports…' : 'Refresh shared reports'}</button>{workspace.sections.length > 0 && <button className="button secondary" disabled={generating} onClick={() => saveShared(true)}>Save as new report</button>}</div><details className="shared-report-browser" open={stage === 'build'}><summary>Browse shared reports ({sharedDrafts.length})</summary>{sharedListError && <p className="form-error" role="alert">{sharedListError}</p>}{!sharedLoading && !sharedListError && !sharedDrafts.length && <p className="muted">No shared reports yet. Generated reports save automatically; save edits when ready.</p>}{sharedDrafts.map(report => <div className="stored-report-row" key={report.id}><span><strong>Version {report.version} · {report.section_count} sections{report.id === workspace.sharedDraftId ? ' · current report' : ''}</strong><small>Report {report.id.slice(0, 12)} · {new Date(report.updated_at).toLocaleString()} · {report.model || 'Team report'}</small></span><button className="button secondary" disabled={generating} onClick={() => loadShared(report.id)}>Load shared report<Icon name="document" size={15} /></button></div>)}</details></section>}
    {saveConflict && <div className="build-changes-note" role="status"><span>Your edits are still here. Load the latest shared version to compare, or save a separate report to retain both versions.</span>{workspace.sharedDraftId && <button className="button secondary" disabled={generating} onClick={() => loadShared(workspace.sharedDraftId!)}>Load latest shared version</button>}<button className="button secondary" disabled={generating} onClick={() => saveShared(true)}>Save a separate report</button></div>}
    {recovery && <div className="build-changes-note report-recovery-note" role="status"><span>A previous local report copy is available in this browser. Restoring swaps it with your current local draft; shared versions stay saved.</span><button className="button secondary" disabled={generating} onClick={restoreLocalCopy}>Restore previous local copy</button></div>}
    {stage === 'build' && Boolean(backendReport?.stored_reports?.length) && <section className="stored-report-list" aria-label="Saved company reports"><div><h3>Saved company reports</h3><p>Imported drafts retain their original quotations. Automated source checks still need human review. Loading saves your previous text in version history.</p></div>{backendReport!.stored_reports!.map(report => <div key={report.id} className="stored-report-row"><span><strong>{report.language} · {report.section_count} sections</strong><small>{report.created_at} · {report.model}</small></span><button className="button secondary" disabled={generating} onClick={() => loadStored(report.id)}>Load saved report<Icon name="document" size={15} /></button></div>)}</section>}
    {backendReport && workspace.backendDraftId && <div className="report-narrative-mode"><Badge tone="amber">Draft · needs review</Badge><span>Every source-supported claim keeps its original evidence.</span><details className="report-draft-details"><summary>Draft details</summary><dl><dt>Model</dt><dd>{workspace.backendDraftModel}</dd><dt>Draft ID</dt><dd>{workspace.backendDraftId}</dd><dt>Generated</dt><dd>{workspace.backendDraftGeneratedAt}</dd><dt>Original generation basis</dt><dd>{workspace.backendReportId}</dd>{workspace.backendEvidenceCheckedReportId && <><dt>References checked against</dt><dd>{workspace.backendEvidenceCheckedReportId}</dd><dt>Reference check time</dt><dd>{workspace.backendEvidenceCheckedAt}</dd></>}</dl></details></div>}
    {configChanged && <div className="build-changes-note"><Icon name="help" size={15} /> Build settings have changed. Regenerate the preview to include them; the current report and human edits are preserved until then.</div>}
    {stage === 'build' && <>
      <div className="builder-intro"><div><h2>Make it your report.</h2></div><span className="subtle-label"><span className="status-dot" /> {backendReport ? 'Source-backed model narrative' : 'Local evidence preview'}</span></div>
      {!hasDraftingEvidence && <div className="build-changes-note" role="status"><Icon name="upload" size={17} /><span>Upload and process at least one source file before generating a report. This company does not yet have source-backed evidence to draft from.</span><button className="button secondary" onClick={() => navigate(`/project/${project.id}/data-room`)}>Add source files</button></div>}
      <div className="builder-grid">
        <section className="module-library" aria-label="Module library"><div className="section-heading"><h3>Module library <span>{MODULES.length}</span></h3><Icon name="layers" size={17} /></div><p className="section-description">A starting point for every question.</p><label className="search-field compact"><Icon name="search" size={16} /><input aria-label="Search modules" placeholder="Find a module…" value={moduleSearch} onChange={e => setModuleSearch(e.target.value)} /><kbd>/</kbd></label><div className="module-list">{visibleModules.map(module => <button key={module.id} className={`library-item ${active === module.id ? 'focused' : ''}`} onClick={() => addModule(module.id)} aria-label={`${workspace.order.includes(module.id) ? 'Configure' : 'Add'} ${module.name}`}><span className={`module-icon ${module.color}`}><Icon name={module.icon} size={18} /></span><span className="library-item-text"><strong>{module.name}</strong><small>{module.description}</small></span><Icon name={workspace.order.includes(module.id) ? 'check' : 'plus'} size={15} className={workspace.order.includes(module.id) ? 'added-icon' : ''} /></button>)}{visibleModules.length === 0 && <p className="module-no-results" role="status">No modules match this search. Try another topic.</p>}</div><div className="library-note"><Icon name="sparkles" size={17} /><p>Start with a few modules.<br />Go deeper where it matters.</p></div></section>
        <section className="structure-panel" aria-label="Report structure"><div className="section-heading"><h3>Your report <span>{selectedCount} modules</span></h3><Badge tone="neutral">Custom</Badge></div><p className="section-description">Drag to reorder, or use the arrow controls.</p><div className="report-cover"><div className="cover-brand"><span className="company-avatar small">{project.name.slice(0, 1).toLowerCase()}.</span><span>{project.name}<small>Diligence report</small></span><Icon name="document" size={24} /></div><div className="cover-meta"><span><Icon name="globe" size={12} /> {project.geography}</span><span>{project.sector}</span><span>Working draft</span></div></div>
          <div className="structure-list" onDragOver={e => e.preventDefault()}>{workspace.order.map((id, index) => {
            const module = MODULES.find(m => m.id === id)!, moduleConfig = workspace.configs[id] ?? moduleDefaults(id)
            return <div key={id} className={`structure-item ${active === id ? 'selected' : ''} ${dragged === index ? 'dragging' : ''}`} draggable onDragStart={e => { setDragged(index); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(index)) }} onDragEnd={() => setDragged(null)} onDrop={e => { e.preventDefault(); if (dragged !== null) move(dragged, index); setDragged(null) }}>
              <Icon name="grip" size={15} className="drag-handle" /><span className="module-index">{String(index + 1).padStart(2, '0')}</span><button className="structure-main" onClick={() => setActive(id)} aria-label={`Customize ${module.name}`}><strong>{module.name}</strong><span>{moduleConfig.topics.length} topics <span className="meta-dot">·</span> {moduleConfig.depth} <span className="meta-dot">·</span> {moduleConfig.geography}</span></button><div className="structure-controls"><button className="mini-button" aria-label={`Move ${module.name} up`} disabled={index === 0} onClick={() => move(index, index - 1)}><Icon name="up" size={13} /></button><button className="mini-button" aria-label={`Move ${module.name} down`} disabled={index === selectedCount - 1} onClick={() => move(index, index + 1)}><Icon name="down" size={13} /></button><button className="mini-button remove-module" aria-label={`Remove ${module.name}`} onClick={() => { setWorkspace(previous => ({ ...previous, order: previous.order.filter(item => item !== id) })); if (active === id) setActive(workspace.order.find(item => item !== id) ?? 'market') }}><Icon name="x" size={13} /></button></div>
            </div>
          })}{selectedCount === 0 && <Empty title="Start with a question" text="Choose a module from the library to build your report." />}</div><button className="add-section" onClick={() => { document.querySelector<HTMLInputElement>('[aria-label="Search modules"]')?.focus() }}><Icon name="plus" size={15} /> Add a module from the library</button>
          <div className="structure-footnote"><Icon name="link" size={16} /><span><strong>{sourceCount} evidence extracts</strong> available across selected modules.<br />Missing evidence is shown as a gap, never filled in.</span></div>
        </section>
        <aside className="customization-panel" aria-label="Module customization"><div className="section-heading"><h3>Customize module</h3><Icon name="settings" size={17} /></div><div className="custom-module-name"><span className={`module-icon ${selected.color}`}><Icon name={selected.icon} size={20} /></span><div><h3>{selected.name}</h3><p>Give this section direction.</p></div></div>
          {!workspace.order.includes(active) && <button className="button secondary full" onClick={() => addModule(active)}><Icon name="plus" size={16} /> Add to report</button>}
          <fieldset className="topics-field"><legend>Sub-topics <span>{config.topics.length} selected</span></legend>{configurableTopics.map(topic => <label className="checkbox-row" key={topic}><input type="checkbox" checked={config.topics.includes(topic)} onChange={() => updateConfig({ topics: config.topics.includes(topic) ? config.topics.filter(t => t !== topic) : [...config.topics, topic] })} /><span>{topic}</span></label>)}</fieldset>
          <fieldset><legend>Depth</legend><div className="segmented" role="group" aria-label="Depth">{(['Brief', 'Standard', 'Deep'] as const).map(depth => <button key={depth} aria-pressed={config.depth === depth} className={config.depth === depth ? 'active' : ''} onClick={() => updateConfig({ depth })}>{depth}</button>)}</div></fieldset>
          <div className="field-pair"><label>Geography<select aria-label="Geography" value={config.geography} onChange={e => updateConfig({ geography: e.target.value })}>{['Global', 'Europe', 'US', 'Nordics', 'Asia Pacific'].map(value => <option key={value}>{value}</option>)}</select></label><label>Time horizon<select aria-label="Time horizon" value={config.horizon} onChange={e => updateConfig({ horizon: e.target.value })}>{['Source period', 'Last 12 months', '3 years', '5 years'].map(value => <option key={value}>{value}</option>)}</select></label></div>
          <fieldset><legend>Evidence scope</legend>{(['Internal only', 'Internal + external'] as const).map(scope => <label className="radio-row" key={scope}><input type="radio" name={`scope-${active}`} checked={config.scope === scope} onChange={() => updateConfig({ scope })} /><span>{scope}</span>{scope === 'Internal + external' && <Icon name="globe" size={13} />}</label>)}</fieldset>
          <label className="focus-field">Additional focus <span>Optional</span><textarea value={config.focus} onChange={e => updateConfig({ focus: e.target.value })} placeholder={active === 'market' ? 'e.g. Focus on Gen Z purchasing behavior…' : 'What should this section pay special attention to?'} rows={3} maxLength={2000} /></label><div className="config-note"><Icon name="help" size={14} /><span>Preferences shape the draft. Generation uses stored evidence; it does not perform new research.</span></div>
        </aside>
      </div>
      <div className="build-bottom"><div><Icon name="shield" size={19} /><span><strong>Built on evidence, with room for your judgment.</strong><small>{backendReport ? 'Stored source sentences and numbers · linked quotations · explicit gaps' : 'Historical snapshot · missing sources stay visible · no investment conclusions'}</small></span></div><button className="button primary" disabled={generating} onClick={generate}><Icon name={generating ? 'loading' : 'sparkles'} size={17} />{generating ? 'Preparing report…' : workspace.sections.length ? 'Regenerate preview' : 'Generate report preview'}<Icon name="arrow" size={16} /></button></div>
    </>}
    {stage === 'review' && (workspace.sections.length === 0 ? <Empty icon="book" title="Your report starts in Build" text="Choose your modules and generate an evidence preview before reviewing."><button className="button primary" onClick={() => navigate(base + 'build')}>Build your report <Icon name="arrow" /></button></Empty> : <ReportReview project={project} workspace={workspace} evidence={evidenceCatalog} backend={Boolean(backendReport)} companyName={backendReport?.company.legal_name} inspect={inspect} edit={section => { setEditing(section); setEditText(section.content) }} history={() => setHistory(true)} onExport={() => navigate(base + 'export')} />)}
    {stage === 'export' && (workspace.sections.length === 0 ? <Empty title="Nothing to export yet" text="Generate and review your report first."><button className="button primary" onClick={() => navigate(base + 'build')}>Go to Build</button></Empty> : <div className="export-layout"><div className="export-card"><div className="export-icon"><Icon name="document" size={34} /></div><h2>Take the evidence with you.</h2><p>Export your report with source references, unresolved questions, and your revisions.</p><div className="format-options">{(['PDF', 'DOCX', 'Markdown'] as const).map(item => <button key={item} aria-pressed={format === item} className={format === item ? 'selected' : ''} onClick={() => setFormat(item)}><Icon name={item === 'DOCX' ? 'pencil' : item === 'Markdown' ? 'file' : 'document'} size={24} /><strong>{item}</strong><small>{item === 'PDF' ? 'Ready to read' : item === 'DOCX' ? 'Ready to edit' : 'Ready to reuse'}</small><span className="format-radio">{format === item && <Icon name="check" size={12} />}</span></button>)}</div>{format === 'PDF' && <p className="export-format-note">PDF preserves original source text; the bundled font loads on the first Unicode export.</p>}<button className="button primary full" disabled={exporting || exportBlocked} aria-describedby={exportBlocked ? 'export-evidence-block' : undefined} onClick={async () => { if (exportBlocked) { notify('Refresh unchanged source references or regenerate explicitly before exporting; current source bindings are required.'); return }; setExportError(''); setExporting(true); try { await exportReport(format, project, workspace.sections, evidenceCatalog, exportContext); notify(`${format} report downloaded.`) } catch (error) { const message = error instanceof Error ? error.message.slice(0, 500) : 'Export failed. Try another format or check browser download permissions.'; setExportError(message); notify(message) } finally { setExporting(false) } }}><Icon name={exporting ? 'loading' : 'download'} size={18} />Download {format}</button>{exportBlocked && <p id="export-evidence-block" className="export-format-note">Export requires current source bindings. Refresh unchanged source references above to retain your wording, or regenerate explicitly in Build.</p>}{exportError && <p className="form-error" role="alert">{exportError}</p>}<small className="export-private"><Icon name="shield" size={13} /> Generated in your browser. No file is uploaded.</small></div><div className="export-checklist"><h3>Included in your export</h3>{[`${workspace.sections.length} report sections`, `${citedEvidenceIds(workspace.sections, evidenceCatalog).length} cited evidence extracts`, 'Source names and exact locators', 'Current human-edited content', 'Missing evidence and limitations'].map(text => <p key={text}><Icon name="check" size={17} />{text}</p>)}<div className="preview-note"><Icon name="help" size={17} /><span>Review edited statements against their sources before sharing. Edits are saved locally and have not been automatically reverified.</span></div><button className="text-button" onClick={() => navigate(base + 'review')}><Icon name="back" size={16} /> Return to review</button></div></div>)}
    {editing && <Dialog title={`Edit ${editing.title}`} subtitle={backendReport ? 'Keep the complete source citation markers in square brackets to preserve evidence links.' : 'Keep citation markers such as [income] to preserve evidence links.'} onClose={() => setEditing(null)}><div className="dialog-body"><textarea className="edit-textarea" aria-label="Section content" value={editText} onChange={e => setEditText(e.target.value)} rows={15} /><div className="dialog-actions"><button className="button secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button primary" onClick={() => saveRevision(editing, editText)}>Save revision</button></div></div></Dialog>}
    {history && <Dialog title="Revision history" subtitle="Changes saved in this browser for this project." onClose={() => setHistory(false)} className="history-dialog"><div className="dialog-body">{workspace.revisions.length === 0 ? <Empty icon="history" title="A clean first draft" text="Human edits and regenerated changes appear here. Generate a report, then edit any section." /> : [...workspace.revisions].reverse().map(revision => {
      const current = workspace.sections.find(section => section.id === revision.section)
      return <div className="revision" key={revision.id}><div><strong>{revision.title}</strong><span>{revision.author} · {new Date(revision.at).toLocaleString()}</span></div><details><summary>Compare revision</summary><h4>Before</h4><pre>{revision.before}</pre><h4>After</h4><pre>{revision.after}</pre></details>{current ? <div className="dialog-actions"><button className="button secondary" disabled={current.content === revision.before} onClick={() => restoreRevision(revision, 'before')}>Restore earlier text</button><button className="button secondary" disabled={current.content === revision.after} onClick={() => restoreRevision(revision, 'after')}>Restore this revision</button></div> : <p className="muted">This section is not in the current draft. Its saved text remains available above to copy.</p>}</div>
    })}<p className="muted">Restoring creates a new human revision. Review its source references before sharing.</p></div></Dialog>}

  </>
}
