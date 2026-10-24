import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Project, Workspace } from './domain'
import { ENFUCE, emptyWorkspace, readLocal, saveLocal } from './domain'
import { Badge, Dialog, Empty, Icon } from './ui'
import Report from './Report'
import Dashboard from './Dashboard'
import DataRoom from './DataRoom'
import { EvidenceInspector } from './Evidence'
import Chat from './Chat'
import CompanyChat from './CompanyChat'
import DocumentChat from './DocumentChat'
import './company-chat.css'
import ConnectedDashboard from './ConnectedDashboard'
import { ConnectedEvidenceInspector } from './ConnectedEvidence'
import ConnectedDataRoom from './ConnectedDataRoom'
import { backendProjectId, reportEvidence, useCompanyReport } from './backend'
import { migrateLegacyEnglish } from './english'
import { useEnglishWorkspace } from './useEnglishWorkspace'
import { createCompany, listCompanies } from './workspaceApi'
import { companyProject, connectLocalProject, mergeCompanyProjects, pendingConnectionKey, readProjects, recoverProjectConnections } from './workspaceProjects'
import type { PendingCompanyConnection } from './workspaceProjects'
import { parseWorkspaceRoute, withoutCompanyChatIntent } from './workspaceRoute'
import './connected.css'
import './connection.css'

const INITIAL_PROJECTS: Project[] = [ENFUCE,
  { id: 'circle', name: 'Circle', sector: 'Fintech', geography: 'United States', created: '2026-10-24T12:00:00Z' },
  { id: 'enfuce-documents', name: 'Enfuce · Document claims', sector: 'Fintech', geography: 'Finland', created: '2026-10-24T12:00:00Z' },
  { id: 'backerkit', name: 'BackerKit', sector: 'Crowdfunding', geography: 'United States', created: '2026-10-24T12:00:00Z' },
]
export const go = (path: string) => { window.location.hash = path }
function useRoute() {
  const [path, setPath] = useState(() => window.location.hash.slice(1) || '/projects')
  useEffect(() => { const listener = () => setPath(window.location.hash.slice(1) || '/projects'); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }, [])
  const replacePath = useCallback((next: string) => { window.history.replaceState(null, '', `#${next}`); setPath(next) }, [])
  return [path, replacePath] as const
}

export default function App() {
  const [path, replacePath] = useRoute()
  const [projects, setProjects] = useState<Project[]>(() => readProjects(readLocal<unknown>('acefire:projects:v1', INITIAL_PROJECTS), INITIAL_PROJECTS))
  const [newProject, setNewProject] = useState(false)
  const [toast, setToast] = useState('')
  const [toastToken, setToastToken] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [name, setName] = useState('')
  const [sector, setSector] = useState('Fintech')
  const [geography, setGeography] = useState('United States')
  const [nameError, setNameError] = useState('')
  const [creating, setCreating] = useState(false)
  const [companyListLoading, setCompanyListLoading] = useState(true)
  const [companyListError, setCompanyListError] = useState('')
  const [companyAttempt, setCompanyAttempt] = useState(0)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<{ id: string; message: string } | null>(null)
  const creation = useRef<{ signature: string; id: string } | null>(null)
  const connectionIds = useRef(new Map<string, string>())
  const createController = useRef<AbortController | null>(null)
  const connectController = useRef<AbortController | null>(null)
  const [help, setHelp] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const route = parseWorkspaceRoute(path)
  const parts = route.parts
  const consumeChatIntent = useCallback(() => replacePath(withoutCompanyChatIntent(path)), [path, replacePath])
  const isProject = parts[0] === 'project'
  const project = projects.find(item => item.id === parts[1])
  const current = parts[2] === 'dashboard' ? 'Dashboard' : parts[2] === 'data-room' ? 'Data room' : 'Report'
  const notify = useCallback((message: string) => { setToast(message); setToastToken(token => token + 1) }, [])
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer) } }, [toast, toastToken])
  useEffect(() => { if (!saveLocal('acefire:projects:v1', projects)) notify('Projects could not be saved. Check browser storage permissions.') }, [projects, notify])
  useEffect(() => { setSidebarOpen(false); window.scrollTo(0, 0) }, [path])
  useEffect(() => {
    const controller = new AbortController(); setCompanyListLoading(true); setCompanyListError('')
    listCompanies(controller.signal).then(companies => {
      if (!controller.signal.aborted) setProjects(previous => {
        const pending = previous.flatMap(project => {
          const value = readLocal<PendingCompanyConnection | null>(pendingConnectionKey(project.id), null)
          return value && typeof value === 'object' ? [value] : []
        })
        return mergeCompanyProjects(recoverProjectConnections(previous, companies, pending), companies)
      })
    }).catch(error => {
      if (!controller.signal.aborted) setCompanyListError(error instanceof Error ? error.message : 'Shared company workspaces could not be loaded.')
    }).finally(() => { if (!controller.signal.aborted) setCompanyListLoading(false) })
    return () => controller.abort()
  }, [companyAttempt])
  useEffect(() => () => { createController.current?.abort(); connectController.current?.abort() }, [])

  function closeCreation() {
    if (createController.current) {
      createController.current.abort(); createController.current = null; setCreating(false)
      notify('Stopped waiting for company creation. Your form details are kept for retry.')
    }
    setNewProject(false)
  }
  async function createProject() {
    if (createController.current) return
    const trimmed = name.trim()
    if (!trimmed) { setNameError('Enter a project name.'); return }
    const place = geography.trim() || 'Unknown'
    const signature = JSON.stringify([trimmed, sector, place])
    if (creation.current?.signature !== signature) creation.current = { signature, id: `deal-${crypto.randomUUID()}` }
    const controller = new AbortController(); createController.current = controller
    setCreating(true); setNameError('')
    try {
      const company = await createCompany({ name: trimmed, sector, geography: place, deal_id: creation.current.id }, controller.signal)
      if (controller.signal.aborted) return
      const next = companyProject(company)
      setProjects(previous => mergeCompanyProjects(previous, [company]))
      setNewProject(false); setName(''); setNameError(''); creation.current = null
      go(`/project/${next.id}/data-room`)
      notify('Company workspace created. Upload its source files to start the analysis.')
    } catch (error) {
      if (!controller.signal.aborted) setNameError(`${error instanceof Error ? error.message : 'The company workspace could not be created.'} Your project details are preserved for retry.`)
    } finally { if (createController.current === controller) createController.current = null; if (!controller.signal.aborted) setCreating(false) }
  }
  async function connectProject(project: Project) {
    if (connectController.current || project.id === 'enfuce' || project.backendDealId || backendProjectId(project.id)) return
    const controller = new AbortController(); connectController.current = controller
    const saved = readLocal<PendingCompanyConnection | null>(pendingConnectionKey(project.id), null)
    const sameRequest = saved && saved.name === project.name && saved.sector === project.sector && saved.geography === project.geography && typeof saved.dealId === 'string' && /^deal-[a-z0-9-]+$/.test(saved.dealId)
    const id = connectionIds.current.get(project.id) ?? (sameRequest ? saved.dealId : `deal-${crypto.randomUUID()}`)
    saveLocal(pendingConnectionKey(project.id), { projectId: project.id, dealId: id, name: project.name, sector: project.sector, geography: project.geography })
    connectionIds.current.set(project.id, id); setConnectingId(project.id); setConnectError(null)
    try {
      const company = await createCompany({ name: project.name, sector: project.sector, geography: project.geography, deal_id: id }, controller.signal)
      if (controller.signal.aborted) return
      setProjects(previous => previous.map(item => item.id === project.id ? connectLocalProject(item, company) : item))
      go(`/project/${project.id}/data-room`)
      notify('Company workspace connected. Your browser drafts and saved files are preserved; add saved local files to the shared evidence when ready.')
    } catch (error) {
      if (!controller.signal.aborted) setConnectError({ id: project.id, message: error instanceof Error ? error.message : 'The company workspace could not be connected. Retry when the service is available.' })
    } finally { if (connectController.current === controller) connectController.current = null; if (!controller.signal.aborted) setConnectingId(null) }
  }

  return <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    {sidebarOpen && <button className="sidebar-overlay" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className="sidebar"><a className="brand" href="#/" aria-label="Ingenium home"><span className="brand-mark"><Icon name="layers" size={24} /></span>Ingenium</a><div className="workspace-label">Research workspace</div><nav className="main-nav" aria-label="Main navigation"><a href="#/projects" className={!isProject ? 'active' : ''}><Icon name="folder" size={18} />Projects<span className="nav-count">{projects.length}</span></a></nav>{isProject && project && <><div className="sidebar-divider" /><div className="sidebar-section-label">Current project</div><button className="project-switcher" onClick={() => go('/projects')}><span className="company-avatar tiny">{project.name.slice(0, 1).toLowerCase()}.</span><span>{project.name}<small>{project.sector}</small></span><Icon name="chevronDown" size={14} /></button><nav className="project-nav" aria-label="Project workspace">{[['dashboard', 'Dashboard', 'dashboard'], ['report/build', 'Report', 'document'], ['data-room', 'Data room', 'folderOpen']].map(([route, label, icon]) => <a key={route} href={`#/project/${project.id}/${route}`} className={current === label ? 'active' : ''} aria-current={current === label ? 'page' : undefined}><Icon name={icon} size={18} /><span>{label}</span>{label === 'Report' && <span className="nav-dot" />}</a>)}{current === 'Report' && <div className="report-subnav">{[['build', 'Report builder'], ['review', 'Review report'], ['export', 'Export']].map(([route, label]) => <a key={route} href={`#/project/${project.id}/report/${route}`} className={parts[3] === route || (!parts[3] && route === 'build') ? 'active' : ''}>{label}</a>)}</div>}</nav></>}
    <div className="sidebar-bottom"><div className="workspace-tip"><Icon name="link" size={19} /><strong>Trusted diligence,<br />powered by the<br />world’s evidence.</strong></div><button className="help-link" onClick={() => setHelp(true)}><Icon name="help" size={17} />Help & getting started<Icon name="outward" size={13} /></button><div className="profile"><span className="avatar">M</span><div><strong>My workspace</strong><small>Evidence workspace</small></div><Badge>Personal</Badge></div></div></aside>
    <div className="app-body"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><Icon name="menu" size={20} /></button><a href="#/projects">Projects</a>{isProject && project && <><Icon name="chevron" size={14} /><a href={`#/project/${project.id}/dashboard`}>{project.name}</a><Icon name="chevron" size={14} /><strong>{current}</strong></>}</div><div className="topbar-actions"><span className="preview-badge"><span className="status-dot" />Evidence workspace</span><button className="icon-button" onClick={() => setHelp(true)} aria-label="Help"><Icon name="help" size={18} /></button><button className="icon-button notification-button" onClick={() => setNotifications(true)} aria-label="Notifications"><Icon name="bell" size={18} /><span /></button><button className="button new-project-button" onClick={() => setNewProject(true)}><Icon name="plus" size={15} /><span>Project</span></button><span className="avatar small">M</span></div></header><main id="main-content" tabIndex={-1} className={`main-content ${!isProject ? 'projects-page' : current === 'Dashboard' ? 'dashboard-page' : ''}`}>
      {!isProject && companyListLoading && <div className="backend-connection" role="status"><Icon name="loading" size={16} />Loading shared company workspaces…</div>}
      {companyListError && <div className="backend-error" role="alert"><h2>Company list unavailable</h2><p>{companyListError} Your existing browser projects remain available.</p><button className="button secondary" disabled={companyListLoading} onClick={() => setCompanyAttempt(value => value + 1)}>Retry company list<Icon name="history" size={14} /></button></div>}
      {connectError && <div className="backend-error" role="alert"><h2>Company connection could not finish</h2><p>{connectError.message} The original project, drafts and browser files are unchanged.</p><button className="button secondary" disabled={Boolean(connectingId)} onClick={() => { const target = projects.find(item => item.id === connectError.id); if (target) void connectProject(target) }}>Retry company connection<Icon name="history" size={14} /></button></div>}
      {!isProject ? <Projects projects={projects} onCreate={() => setNewProject(true)} onConnect={connectProject} connectingId={connectingId} /> : project ? <ProjectWorkspace key={project.id} project={project} page={current} stage={parts[3] && ['build', 'review', 'export'].includes(parts[3]) ? parts[3] : 'build'} notify={notify} onConnect={connectProject} connecting={connectingId === project.id} connectionError={connectError?.id === project.id ? connectError.message : undefined} requestCompanyChat={route.companyChat} onChatIntentConsumed={consumeChatIntent} /> : companyListLoading ? <div className="backend-loading" role="status"><Icon name="loading" size={24} /><h2>Loading shared company workspace</h2></div> : <Empty title="Project not found" text="This project may belong to another browser or workspace."><button className="button primary" onClick={() => go('/projects')}>Back to projects</button></Empty>}
    </main></div>
    {toast && <div className="toast" role="status"><Icon name="check" size={17} /><span>{toast}</span><button className="icon-button" onClick={() => setToast('')} aria-label="Dismiss notification"><Icon name="x" size={15} /></button></div>}
    {newProject && <Dialog title="Create a project" subtitle="Create a shared company workspace, then add its evidence." onClose={closeCreation}><form className="dialog-body" aria-busy={creating} onSubmit={event => { event.preventDefault(); void createProject() }}>
      <label>Project name<input value={name} disabled={creating} onChange={event => { setName(event.target.value); setNameError('') }} placeholder="e.g. Acme diligence" maxLength={100} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? 'name-error' : undefined} autoFocus /></label>
      {nameError && <p className="form-error" id="name-error" role="alert">{nameError}</p>}
      <div className="field-pair"><label>Sector<select value={sector} disabled={creating} onChange={event => setSector(event.target.value)}>{['Fintech', 'Enterprise software', 'Healthcare', 'Consumer', 'Climate', 'Crowdfunding', 'Other'].map(item => <option key={item}>{item}</option>)}</select></label><label>Geography<input value={geography} disabled={creating} onChange={event => setGeography(event.target.value)} placeholder="Country or region" maxLength={100} /></label></div>
      <div className="preview-note"><Icon name="shield" size={16} />The company starts without claims or metrics. Uploaded source files provide the evidence for calculations, reports and chat.</div>
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={closeCreation}>{creating ? 'Stop waiting' : 'Cancel'}</button><button type="submit" className="button primary" disabled={creating}><Icon name={creating ? 'loading' : 'plus'} size={16} />{creating ? 'Creating workspace…' : 'Create project'}</button></div>
    </form></Dialog>}
    {help && <Dialog title="Welcome to Ingenium" subtitle="A workspace for evidence-led diligence." onClose={() => setHelp(false)}><div className="dialog-body help-content"><p><strong>Dashboard</strong> shows stored source values and calculations. Select compatible inputs, describe a calculation and inspect its generated code, result and source lineage.</p><p><strong>Report</strong> follows Build → Review → Export. Choose modules, generate a model draft from company evidence, trace dotted passages to their sources, revise the text and export with references.</p><p><strong>Data room</strong> accepts company documents, images, spreadsheets and text. Processing history shows queued work, failures, warnings and saved evidence. Available originals can be opened or downloaded.</p><p><strong>Company chat</strong> uses the selected company’s stored records and citations. Search source files opens a separate document search conversation. All generated answers need review against their evidence.</p><p className="preview-note">Company evidence and calculations use the shared backend. Report edits and legacy files remain in this browser; older local projects can explicitly connect to a company workspace. The original Enfuce workspace remains a historical fixture. Live Akta retrieval is unavailable; saved Akta profiles remain usable.</p><button className="button primary" onClick={() => setHelp(false)}>Start exploring <Icon name="arrow" size={16} /></button></div></Dialog>}
    {notifications && <Dialog title="Workspace notifications" subtitle="Source-specific follow-ups for the saved Enfuce snapshot." onClose={() => setNotifications(false)}><div className="dialog-body"><div className="notification"><Badge tone="amber">Definition check</Badge><h3>Revenue or total operating income?</h3><p>Confirm the intended revenue definition before comparing sources.</p></div><div className="notification"><Badge tone="amber">Scope check</Badge><h3>Group or parent company?</h3><p>2019 report and workbook values agree after rounding, but entity scope is unresolved.</p></div><button className="button primary" onClick={() => { setNotifications(false); go('/project/enfuce/dashboard') }}>Review evidence <Icon name="arrow" size={16} /></button></div></Dialog>}
  </div>
}

function ProjectWorkspace({ project, page, stage, notify, onConnect, connecting, connectionError, requestCompanyChat, onChatIntentConsumed }: { project: Project; page: string; stage: string; notify: (message: string) => void; onConnect: (project: Project) => Promise<void>; connecting: boolean; connectionError?: string; requestCompanyChat: boolean; onChatIntentConsumed: () => void }) {
  const key = `acefire:workspace:v1:${project.id}`
  const [workspace, setWorkspace] = useState<Workspace>(() => { const stored = readLocal<Workspace>(key, emptyWorkspace()); return stored && Array.isArray(stored.order) && Array.isArray(stored.sections) && stored.configs && Array.isArray(stored.revisions) ? migrateLegacyEnglish(stored) : emptyWorkspace() })
  const [evidenceId, setEvidenceId] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [documentChatOpen, setDocumentChatOpen] = useState(false)
  const dealId = project.backendDealId ?? backendProjectId(project.id)
  const { report, loading, error, refresh, loadedAt } = useCompanyReport(dealId)
  const backendEvidence = useMemo(() => report ? reportEvidence(report) : [], [report])
  const selectedEvidence = backendEvidence.find(item => item.id === evidenceId)
  useEnglishWorkspace(project, report, workspace, setWorkspace, notify)
  useEffect(() => { if (requestCompanyChat) { setChatOpen(true); onChatIntentConsumed() } }, [requestCompanyChat, onChatIntentConsumed])
  useEffect(() => { if (!saveLocal(key, workspace)) notify('Changes could not be saved. Export your work and check browser storage.') }, [key, workspace, notify])
  if (dealId && loading && !report) return <div className="backend-loading" role="status"><Icon name="loading" size={26} /><h2>Loading company evidence</h2><p>Reading the stored report, calculations and source references.</p></div>
  if (dealId && !report) return <div className="backend-error" role="alert"><h2>Company report unavailable</h2><p>{error || 'The backend did not return a company report.'}</p><p>Your browser drafts and saved files are preserved. Retry when the company service is available.</p><button className="button primary" onClick={refresh}>Retry connection<Icon name="arrow" size={15} /></button></div>
  return <>
    {!dealId && project.id !== 'enfuce' && <div className="integration-pending" role="note"><Icon name="folderOpen" size={22} /><div><strong>This project is stored in this browser.</strong><p>Connect a company workspace to upload evidence, run calculations and use model reports and chat. Existing drafts and local files stay with this project.</p></div><button className="button primary" disabled={connecting} onClick={() => { void onConnect(project) }}><Icon name={connecting ? 'loading' : 'link'} size={15} />{connecting ? 'Connecting…' : 'Connect company workspace'}</button></div>}
    {error && report && <div className="backend-error" role="alert"><h2>Evidence refresh could not finish</h2><p>{error} The previously loaded evidence and your current work remain visible.</p><button className="button secondary" disabled={loading} onClick={refresh}>Retry refresh<Icon name="history" size={14} /></button></div>}
    {dealId && report && <div className="backend-connection" role="status"><Icon name="shield" size={16} /><div><strong>Stored company report connected</strong><small>{report.persistence?.provider === 'firestore' ? `Firebase · ${report.persistence.database_id} · ` : ''}{report.source_files.length} files · {report.reported_metrics.length} reported observations{loadedAt ? ` · loaded ${new Date(loadedAt).toLocaleTimeString('en-US')}` : ''}</small></div><button className="button secondary" disabled={loading} onClick={refresh}>{loading ? 'Refreshing evidence…' : 'Refresh stored report'}<Icon name={loading ? 'loading' : 'history'} size={14} /></button></div>}
    {page === 'Report' ? <Report project={project} workspace={workspace} setWorkspace={setWorkspace} stage={stage} navigate={go} inspect={setEvidenceId} notify={notify} backendReport={report ?? undefined} onRefresh={refresh} /> : page === 'Dashboard' ? report ? <ConnectedDashboard project={project} report={report} inspect={setEvidenceId} navigate={go} onCalculated={() => { notify('Calculation saved with its code and source references.'); refresh() }} /> : <Dashboard project={project} inspect={setEvidenceId} navigate={go} /> : report ? <ConnectedDataRoom report={report} onRefresh={refresh} onAskSources={() => setDocumentChatOpen(true)} legacyProjectId={project.id} /> : <DataRoom project={project} inspect={setEvidenceId} notify={notify} />}
    <div className="assistant-dock">{report && <button className="dock-suggestion" onClick={() => setDocumentChatOpen(true)}><Icon name="document" size={13} />Search source files</button>}<button className="dock-suggestion" onClick={() => setChatOpen(true)}><Icon name="sparkles" size={12} /> {page === 'Dashboard' ? 'Where do these numbers come from?' : page === 'Report' ? 'What evidence supports this summary?' : 'What do these documents establish?'}</button><button className="assistant-launcher" onClick={() => setChatOpen(true)}><span className="assistant-spark"><Icon name="sparkles" size={19} /></span><span>Ask anything about your evidence</span><Icon name="chat" size={17} /></button></div>
    {evidenceId && (dealId ? selectedEvidence ? <ConnectedEvidenceInspector key={evidenceId} evidence={selectedEvidence} onClose={() => setEvidenceId(null)} notify={notify} /> : <Dialog title="Evidence unavailable" onClose={() => setEvidenceId(null)}><div className="dialog-body"><p>This reference is not present in the current stored report. Refresh the report or regenerate its sections to use current evidence.</p></div></Dialog> : <EvidenceInspector key={evidenceId} id={evidenceId} onClose={() => setEvidenceId(null)} notify={notify} />)}
    {documentChatOpen && report && <DocumentChat project={project} page={page} report={report} inspect={setEvidenceId} navigate={go} onClose={() => setDocumentChatOpen(false)} onCompanyChat={() => { setDocumentChatOpen(false); setChatOpen(true) }} />}
    {chatOpen && (report ? <CompanyChat key={project.id} project={project} page={page} report={report} draftSections={workspace.sections} inspect={setEvidenceId} navigate={go} onClose={() => setChatOpen(false)} onRefresh={refresh} onSearchSources={() => { setChatOpen(false); setDocumentChatOpen(true) }} /> : <Chat project={project} page={page} stage={stage} navigate={go} onClose={() => setChatOpen(false)} onConnect={onConnect} connecting={connecting} connectionError={connectionError} />)}
  </>
}

function Projects({ projects, onCreate, onConnect, connectingId }: { projects: Project[]; onCreate: () => void; onConnect: (project: Project) => Promise<void>; connectingId: string | null }) {
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('All sectors')
  const [layout, setLayout] = useState('grid')
  const shown = projects.filter(p => `${p.name} ${p.sector} ${p.geography}`.toLowerCase().includes(search.toLowerCase()) && (sector === 'All sectors' || p.sector === sector))
  const hasEnfuce = projects.some(p => p.id === 'enfuce')
  return <><div className="page-heading projects-heading"><h1 className="sr-only">Projects</h1><button className="button primary" onClick={onCreate}><Icon name="plus" size={17} />Create project</button></div><div className="project-stats">{[{ icon: 'flag', value: hasEnfuce ? 2 : 0, name: 'Open follow-ups', text: 'Definitions & scope to confirm' }, { icon: 'fileCheck', value: hasEnfuce ? 5 : 0, name: 'Evidence checks', text: 'In the historical Enfuce snapshot' }, { icon: 'folder', value: projects.length, name: 'Projects', text: 'In your research workspace' }].map(item => <div className="project-stat" key={item.name}><span><Icon name={item.icon} size={22} /></span><div><strong>{item.value}</strong><h3>{item.name}</h3><p>{item.text}</p></div></div>)}</div><div className="project-list-heading"><div><h2>All projects <span>{projects.length}</span></h2></div><div className="project-filters"><label className="search-field"><Icon name="search" size={16} /><input aria-label="Search projects" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects…" /></label><label className="filter-select"><Icon name="filter" size={15} /><select aria-label="Filter projects by sector" value={sector} onChange={e => setSector(e.target.value)}><option>All sectors</option>{[...new Set(projects.map(p => p.sector))].map(item => <option key={item}>{item}</option>)}</select></label><button className="icon-button view-toggle" aria-label={layout === 'grid' ? 'Switch to list view' : 'Switch to grid view'} onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}><Icon name={layout === 'grid' ? 'menu' : 'dashboard'} size={19} /></button></div></div><div className={`project-cards ${layout === 'list' ? 'list' : ''}`}>{shown.map((project, index) => {
    const seeded = project.id === 'enfuce'
    const backendLinked = Boolean(project.backendDealId ?? backendProjectId(project.id))
    const workspace = readLocal<Workspace>(`acefire:workspace:v1:${project.id}`, emptyWorkspace())
    const documents = readLocal<unknown[]>(`acefire:documents:v1:${project.id}`, [])
    const localCount = Array.isArray(documents) ? documents.length : 0
    return <article className="project-card" key={project.id}><a href={`#/project/${project.id}/dashboard`} className={`project-cover cover-${index % 3}`} aria-label={`Open ${project.name} dashboard`}><ProjectCover project={project} /><span className="project-cover-number">{String(index + 1).padStart(2, '0')}</span><span className="cover-project-tag"><Icon name="folder" size={13} />{seeded ? 'Historical snapshot' : backendLinked ? 'Backend workspace' : 'Starter workspace'}</span><span className="cover-open"><Icon name="outward" size={18} /></span></a><div className="project-card-body"><div className="project-card-title"><div><h3><a href={`#/project/${project.id}/dashboard`}>{project.name}</a></h3><Badge tone={index % 2 === 0 ? 'blue' : 'purple'}>{project.sector}</Badge></div><div className="project-progress"><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" /><circle className="progress-ring" cx="22" cy="22" r="18" strokeDasharray={`${seeded ? 68 : 0} 113`} /></svg><span>{seeded ? '3/5' : '—'}</span></div></div><div className="project-owner"><span className="company-avatar tiny">{project.name.slice(0, 1).toLowerCase()}.</span><span><strong>{project.name}</strong><small>{project.geography}</small></span><span className="project-status"><span className={`status-dot ${seeded ? '' : 'gray'}`} />{seeded ? 'In review' : backendLinked ? 'Connected' : 'Not connected'}</span></div><div className="project-card-stats"><div><Icon name="document" size={17} /><span><strong>{backendLinked ? '—' : (seeded ? 3 : 0) + localCount}</strong><small>Sources</small></span></div><div><Icon name="layers" size={17} /><span><strong>{workspace?.order?.length ?? 6}</strong><small>Modules</small></span></div><div><Icon name="flag" size={17} /><span><strong>{seeded ? 2 : 0}</strong><small>Follow-ups</small></span></div></div><div className="project-card-actions">{!seeded && !backendLinked && <button className="button secondary" disabled={Boolean(connectingId)} onClick={() => { void onConnect(project) }}><Icon name={connectingId === project.id ? 'loading' : 'link'} size={14} />{connectingId === project.id ? 'Connecting…' : 'Connect company workspace'}</button>}<a className="button secondary" href={`#/project/${project.id}/report/build`}>Build report<Icon name="document" size={14} /></a><a className="button secondary" href={`#/project/${project.id}/dashboard`}>Open project<Icon name="outward" size={14} /></a></div></div></article>
  })}{shown.length === 0 && <Empty icon="search" title="No projects match" text="Try another name or choose a different sector." />}</div><div className="projects-bottom-note"><Icon name="shield" size={15} /><span>Company evidence is shared through the backend. Draft edits and legacy browser files stay local.</span><button className="text-button" onClick={onCreate}>Start a new project <Icon name="plus" size={14} /></button></div></>
}

const PROJECT_COVERS: Record<string, { src: string; alt: string }> = {
  enfuce: { src: '/images/projects/enfuce.png', alt: 'Contactless card payment at a café counter' },
  circle: { src: '/images/projects/circle.png', alt: 'Financial professionals reviewing digital finance operations' },
  backerkit: { src: '/images/projects/backerkit.png', alt: 'Independent creators assembling a board-game prototype' },
}

function ProjectCover({ project }: { project: Project }) {
  const cover = PROJECT_COVERS[project.id === 'enfuce-documents' ? 'enfuce' : project.id]
  return cover
    ? <img className="project-art project-cover-image" src={cover.src} alt={cover.alt} />
    : <div className="project-cover-placeholder"><Icon name="folder" size={40} /><span>{project.name}</span></div>
}
