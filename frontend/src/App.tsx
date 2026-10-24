import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project, Workspace } from './domain'
import { ENFUCE, emptyWorkspace, readLocal, saveLocal } from './domain'
import { Badge, Dialog, Empty, Icon } from './ui'
import Report from './Report'
import Dashboard from './Dashboard'
import DataRoom from './DataRoom'
import { EvidenceInspector } from './Evidence'
import Chat from './Chat'
import ConnectedDashboard from './ConnectedDashboard'
import { ConnectedEvidenceInspector } from './ConnectedEvidence'
import ConnectedDataRoom from './ConnectedDataRoom'
import { backendProjectId, reportEvidence, useCompanyReport } from './backend'
import './connected.css'
import './connection.css'

const INITIAL_PROJECTS: Project[] = [ENFUCE,
  { id: 'circle', name: 'Circle', sector: 'Fintech', geography: 'United States', created: '2026-10-24T12:00:00Z' },
  { id: 'backerkit', name: 'BackerKit', sector: 'Crowdfunding', geography: 'United States', created: '2026-10-24T12:00:00Z' },
]
export const go = (path: string) => { window.location.hash = path }
function useRoute() {
  const [path, setPath] = useState(() => window.location.hash.slice(1) || '/projects')
  useEffect(() => { const listener = () => setPath(window.location.hash.slice(1) || '/projects'); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }, [])
  return path
}

export default function App() {
  const path = useRoute()
  const [projects, setProjects] = useState<Project[]>(() => { const stored = readLocal<Project[]>('acefire:projects:v1', INITIAL_PROJECTS); return Array.isArray(stored) && stored.every(p => p && typeof p.id === 'string' && typeof p.name === 'string') ? stored : INITIAL_PROJECTS })
  const [newProject, setNewProject] = useState(false)
  const [toast, setToast] = useState('')
  const [toastToken, setToastToken] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [name, setName] = useState('')
  const [sector, setSector] = useState('Fintech')
  const [geography, setGeography] = useState('United States')
  const [nameError, setNameError] = useState('')
  const [help, setHelp] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const parts = path.split('/').filter(Boolean)
  const isProject = parts[0] === 'project'
  const project = projects.find(item => item.id === parts[1])
  const current = parts[2] === 'dashboard' ? 'Dashboard' : parts[2] === 'data-room' ? 'Data room' : 'Report'
  const notify = useCallback((message: string) => { setToast(message); setToastToken(token => token + 1) }, [])
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer) } }, [toast, toastToken])
  useEffect(() => { if (!saveLocal('acefire:projects:v1', projects)) notify('Projects could not be saved. Check browser storage permissions.') }, [projects, notify])
  useEffect(() => { setSidebarOpen(false); window.scrollTo(0, 0) }, [path])

  return <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    {sidebarOpen && <button className="sidebar-overlay" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className="sidebar"><a className="brand" href="#/" aria-label="Ingenium home"><span className="brand-mark"><Icon name="layers" size={24} /></span>Ingenium</a><div className="workspace-label">Research workspace</div><nav className="main-nav" aria-label="Main navigation"><a href="#/projects" className={!isProject ? 'active' : ''}><Icon name="folder" size={18} />Projects<span className="nav-count">{projects.length}</span></a></nav>{isProject && project && <><div className="sidebar-divider" /><div className="sidebar-section-label">Current project</div><button className="project-switcher" onClick={() => go('/projects')}><span className="company-avatar tiny">{project.name.slice(0, 1).toLowerCase()}.</span><span>{project.name}<small>{project.sector}</small></span><Icon name="chevronDown" size={14} /></button><nav className="project-nav" aria-label="Project workspace">{[['dashboard', 'Dashboard', 'dashboard'], ['report/build', 'Report', 'document'], ['data-room', 'Data room', 'folderOpen']].map(([route, label, icon]) => <a key={route} href={`#/project/${project.id}/${route}`} className={current === label ? 'active' : ''} aria-current={current === label ? 'page' : undefined}><Icon name={icon} size={18} /><span>{label}</span>{label === 'Report' && <span className="nav-dot" />}</a>)}{current === 'Report' && <div className="report-subnav">{[['build', 'Report builder'], ['review', 'Review report'], ['export', 'Export']].map(([route, label]) => <a key={route} href={`#/project/${project.id}/report/${route}`} className={parts[3] === route || (!parts[3] && route === 'build') ? 'active' : ''}>{label}</a>)}</div>}</nav></>}
    <div className="sidebar-bottom"><div className="workspace-tip"><Icon name="link" size={19} /><strong>Trusted diligence,<br />powered by the<br />world’s evidence.</strong></div><button className="help-link" onClick={() => setHelp(true)}><Icon name="help" size={17} />Help & getting started<Icon name="outward" size={13} /></button><div className="profile"><span className="avatar">M</span><div><strong>My workspace</strong><small>Local preview</small></div><Badge>Personal</Badge></div></div></aside>
    <div className="app-body"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><Icon name="menu" size={20} /></button><a href="#/projects">Projects</a>{isProject && project && <><Icon name="chevron" size={14} /><a href={`#/project/${project.id}/dashboard`}>{project.name}</a><Icon name="chevron" size={14} /><strong>{current}</strong></>}</div><div className="topbar-actions"><span className="preview-badge"><span className="status-dot" />Local workspace</span><button className="icon-button" onClick={() => setHelp(true)} aria-label="Help"><Icon name="help" size={18} /></button><button className="icon-button notification-button" onClick={() => setNotifications(true)} aria-label="Notifications"><Icon name="bell" size={18} /><span /></button><button className="button new-project-button" onClick={() => setNewProject(true)}><Icon name="plus" size={15} /><span>Project</span></button><span className="avatar small">M</span></div></header><main id="main-content" tabIndex={-1} className={`main-content ${!isProject ? 'projects-page' : current === 'Dashboard' ? 'dashboard-page' : ''}`}>
      {!isProject ? <Projects projects={projects} onCreate={() => setNewProject(true)} /> : project ? <ProjectWorkspace key={project.id} project={project} page={current} stage={parts[3] && ['build', 'review', 'export'].includes(parts[3]) ? parts[3] : 'build'} notify={notify} /> : <Empty title="Project not found" text="This project may belong to another browser or workspace."><button className="button primary" onClick={() => go('/projects')}>Back to projects</button></Empty>}
    </main></div>
    {toast && <div className="toast" role="status"><Icon name="check" size={17} /><span>{toast}</span><button className="icon-button" onClick={() => setToast('')} aria-label="Dismiss notification"><Icon name="x" size={15} /></button></div>}
    {newProject && <Dialog title="Create a project" subtitle="Give your next diligence workspace a home." onClose={() => setNewProject(false)}><form className="dialog-body" onSubmit={e => { e.preventDefault(); const trimmed = name.trim(); if (!trimmed) { setNameError('Enter a project name.'); return }; const next = { id: crypto.randomUUID(), name: trimmed, sector, geography: geography.trim() || 'Not specified', created: new Date().toISOString() }; setProjects(previous => [...previous, next]); setNewProject(false); setName(''); setNameError(''); go(`/project/${next.id}/report/build`); notify('Project created. Add source material to start building.') }}><label>Project name<input value={name} onChange={e => { setName(e.target.value); setNameError('') }} placeholder="e.g. Acme diligence" maxLength={100} aria-invalid={!!nameError} aria-describedby={nameError ? 'name-error' : undefined} autoFocus /></label>{nameError && <p className="form-error" id="name-error">{nameError}</p>}<div className="field-pair"><label>Sector<select value={sector} onChange={e => setSector(e.target.value)}>{['Fintech', 'Enterprise software', 'Healthcare', 'Consumer', 'Climate', 'Crowdfunding', 'Other'].map(item => <option key={item}>{item}</option>)}</select></label><label>Geography<input value={geography} onChange={e => setGeography(e.target.value)} placeholder="Country or region" maxLength={100} /></label></div><div className="preview-note"><Icon name="shield" size={16} /> Your new project starts without metrics or extracted evidence.</div><div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setNewProject(false)}>Cancel</button><button type="submit" className="button primary">Create project<Icon name="arrow" size={16} /></button></div></form></Dialog>}
    {help && <Dialog title="Welcome to Ingenium" subtitle="A workspace for evidence-led diligence." onClose={() => setHelp(false)}><div className="dialog-body help-content"><p><strong>Dashboard</strong> shows the saved evidence checks. Select a metric to follow its source fields, formula and result.</p><p><strong>Report</strong> follows Build → Review → Export. Choose modules, customize their research scope, generate a local evidence preview, edit the text, then export with references.</p><p><strong>Data room</strong> shows registered backend sources for Circle. Upload processing and Akta retrieval are pending. Other local projects store files in this browser.</p><p><strong>Ask your evidence</strong> answers supported snapshot questions and opens the relevant workspace. A live AI model is not connected.</p><p className="preview-note">Projects and edits are stored locally, without team sync or sign-in. Export important work before clearing browser data. Enfuce uses historical source extracts. Circle reads stored backend reports; new uploads and Akta retrieval are pending. BackerKit and newly created projects remain local starter workspaces.</p><button className="button primary" onClick={() => setHelp(false)}>Start exploring <Icon name="arrow" size={16} /></button></div></Dialog>}
    {notifications && <Dialog title="Workspace notifications" subtitle="Source-specific follow-ups for the saved Enfuce snapshot." onClose={() => setNotifications(false)}><div className="dialog-body"><div className="notification"><Badge tone="amber">Definition check</Badge><h3>Revenue or total operating income?</h3><p>Confirm the intended revenue definition before comparing sources.</p></div><div className="notification"><Badge tone="amber">Scope check</Badge><h3>Group or parent company?</h3><p>2019 report and workbook values agree after rounding, but entity scope is unresolved.</p></div><button className="button primary" onClick={() => { setNotifications(false); go('/project/enfuce/dashboard') }}>Review evidence <Icon name="arrow" size={16} /></button></div></Dialog>}
  </div>
}

function ProjectWorkspace({ project, page, stage, notify }: { project: Project; page: string; stage: string; notify: (message: string) => void }) {
  const key = `acefire:workspace:v1:${project.id}`
  const [workspace, setWorkspace] = useState<Workspace>(() => { const stored = readLocal<Workspace>(key, emptyWorkspace()); return stored && Array.isArray(stored.order) && Array.isArray(stored.sections) && stored.configs && Array.isArray(stored.revisions) ? stored : emptyWorkspace() })
  const [evidenceId, setEvidenceId] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const dealId = backendProjectId(project.id)
  const { report, loading, error, refresh, loadedAt } = useCompanyReport(dealId)
  const backendEvidence = useMemo(() => report ? reportEvidence(report) : [], [report])
  const selectedEvidence = backendEvidence.find(item => item.id === evidenceId)
  useEffect(() => { if (!saveLocal(key, workspace)) notify('Changes could not be saved. Export your work and check browser storage.') }, [key, workspace, notify])
  if (dealId && loading) return <div className="backend-loading" role="status"><Icon name="loading" size={26} /><h2>Loading company evidence</h2><p>Reading the stored report, calculations and source references.</p></div>
  if (dealId && (error || !report)) return <div className="backend-error" role="alert"><h2>Company report unavailable</h2><p>{error || 'The backend did not return a company report.'}</p><p>Start the data backend and prepare the saved Circle case, then try again.</p><button className="button primary" onClick={refresh}>Retry connection<Icon name="arrow" size={15} /></button></div>
  return <>
    {dealId && report && <div className="backend-connection" role="status"><Icon name="shield" size={16} /><div><strong>Stored company report connected</strong><small>{report.source_files.length} files · {report.reported_metrics.length} reported observations{loadedAt ? ` · loaded ${new Date(loadedAt).toLocaleTimeString()}` : ''}</small></div><button className="button secondary" onClick={refresh}>Refresh stored report<Icon name="history" size={14} /></button></div>}
    {page === 'Report' ? <Report project={project} workspace={workspace} setWorkspace={setWorkspace} stage={stage} navigate={go} inspect={setEvidenceId} notify={notify} backendReport={report ?? undefined} /> : page === 'Dashboard' ? report ? <ConnectedDashboard project={project} report={report} inspect={setEvidenceId} navigate={go} /> : <Dashboard project={project} inspect={setEvidenceId} navigate={go} /> : report ? <ConnectedDataRoom report={report} /> : <DataRoom project={project} inspect={setEvidenceId} notify={notify} />}
    {dealId ? <div className="backend-assistant-note"><Icon name="link" size={17} /><span>Select a number to inspect its formula and source files. New uploads and Akta retrieval are pending.</span><a href={`#/project/${project.id}/data-room`}>View sources <Icon name="outward" size={13} /></a></div> : <div className="assistant-dock"><button className="dock-suggestion" onClick={() => setChatOpen(true)}><Icon name="sparkles" size={12} /> {page === 'Dashboard' ? 'Where do these numbers come from?' : page === 'Report' ? 'What evidence is still missing?' : 'Help me organize my sources'}</button><button className="assistant-launcher" onClick={() => setChatOpen(true)}><span className="assistant-spark"><Icon name="sparkles" size={19} /></span><span>Ask anything about your evidence</span><Icon name="chat" size={17} /></button></div>}
    {evidenceId && (dealId ? selectedEvidence ? <ConnectedEvidenceInspector key={evidenceId} evidence={selectedEvidence} onClose={() => setEvidenceId(null)} notify={notify} /> : <Dialog title="Evidence unavailable" onClose={() => setEvidenceId(null)}><div className="dialog-body"><p>This reference is not present in the current stored report. Refresh the report or regenerate its sections to use current evidence.</p></div></Dialog> : <EvidenceInspector key={evidenceId} id={evidenceId} onClose={() => setEvidenceId(null)} notify={notify} />)}
    {chatOpen && !dealId && <Chat project={project} page={page} inspect={setEvidenceId} navigate={go} onClose={() => setChatOpen(false)} />}
  </>
}

function Projects({ projects, onCreate }: { projects: Project[]; onCreate: () => void }) {
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('All sectors')
  const [layout, setLayout] = useState('grid')
  const shown = projects.filter(p => `${p.name} ${p.sector} ${p.geography}`.toLowerCase().includes(search.toLowerCase()) && (sector === 'All sectors' || p.sector === sector))
  const hasEnfuce = projects.some(p => p.id === 'enfuce')
  return <><div className="page-heading projects-heading"><h1 className="sr-only">Projects</h1><button className="button primary" onClick={onCreate}><Icon name="plus" size={17} />Create project</button></div><div className="project-stats">{[{ icon: 'flag', value: hasEnfuce ? 2 : 0, name: 'Open follow-ups', text: 'Definitions & scope to confirm' }, { icon: 'fileCheck', value: hasEnfuce ? 5 : 0, name: 'Evidence checks', text: 'In the historical Enfuce snapshot' }, { icon: 'folder', value: projects.length, name: 'Projects', text: 'In your research workspace' }].map(item => <div className="project-stat" key={item.name}><span><Icon name={item.icon} size={22} /></span><div><strong>{item.value}</strong><h3>{item.name}</h3><p>{item.text}</p></div></div>)}</div><div className="project-list-heading"><div><h2>All projects <span>{projects.length}</span></h2></div><div className="project-filters"><label className="search-field"><Icon name="search" size={16} /><input aria-label="Search projects" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects…" /></label><label className="filter-select"><Icon name="filter" size={15} /><select aria-label="Filter projects by sector" value={sector} onChange={e => setSector(e.target.value)}><option>All sectors</option>{[...new Set(projects.map(p => p.sector))].map(item => <option key={item}>{item}</option>)}</select></label><button className="icon-button view-toggle" aria-label={layout === 'grid' ? 'Switch to list view' : 'Switch to grid view'} onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}><Icon name={layout === 'grid' ? 'menu' : 'dashboard'} size={19} /></button></div></div><div className={`project-cards ${layout === 'list' ? 'list' : ''}`}>{shown.map((project, index) => {
    const seeded = project.id === 'enfuce'
    const backendLinked = backendProjectId(project.id) !== null
    const workspace = readLocal<Workspace>(`acefire:workspace:v1:${project.id}`, emptyWorkspace())
    const documents = readLocal<unknown[]>(`acefire:documents:v1:${project.id}`, [])
    const localCount = Array.isArray(documents) ? documents.length : 0
    return <article className="project-card" key={project.id}><a href={`#/project/${project.id}/dashboard`} className={`project-cover cover-${index % 3}`} aria-label={`Open ${project.name} dashboard`}><ProjectCover project={project} /><span className="project-cover-number">{String(index + 1).padStart(2, '0')}</span><span className="cover-project-tag"><Icon name="folder" size={13} />{seeded ? 'Historical snapshot' : backendLinked ? 'Backend workspace' : 'Starter workspace'}</span><span className="cover-open"><Icon name="outward" size={18} /></span></a><div className="project-card-body"><div className="project-card-title"><div><h3><a href={`#/project/${project.id}/dashboard`}>{project.name}</a></h3><Badge tone={index % 2 === 0 ? 'blue' : 'purple'}>{project.sector}</Badge></div><div className="project-progress"><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" /><circle className="progress-ring" cx="22" cy="22" r="18" strokeDasharray={`${seeded ? 68 : 0} 113`} /></svg><span>{seeded ? '3/5' : '—'}</span></div></div><div className="project-owner"><span className="company-avatar tiny">{project.name.slice(0, 1).toLowerCase()}.</span><span><strong>{project.name}</strong><small>{project.geography}</small></span><span className="project-status"><span className={`status-dot ${seeded ? '' : 'gray'}`} />{seeded ? 'In review' : backendLinked ? 'Stored report' : 'Not connected'}</span></div><div className="project-card-stats"><div><Icon name="document" size={17} /><span><strong>{backendLinked ? '—' : (seeded ? 3 : 0) + localCount}</strong><small>Sources</small></span></div><div><Icon name="layers" size={17} /><span><strong>{workspace?.order?.length ?? 6}</strong><small>Modules</small></span></div><div><Icon name="flag" size={17} /><span><strong>{seeded ? 2 : 0}</strong><small>Follow-ups</small></span></div></div><div className="project-card-actions"><a className="button secondary" href={`#/project/${project.id}/report/build`}>Build report<Icon name="document" size={14} /></a><a className="button secondary" href={`#/project/${project.id}/dashboard`}>Open project<Icon name="outward" size={14} /></a></div></div></article>
  })}{shown.length === 0 && <Empty icon="search" title="No projects match" text="Try another name or choose a different sector." />}</div><div className="projects-bottom-note"><Icon name="shield" size={15} /><span>Your research, in one place. Project files and edits stay in this browser.</span><button className="text-button" onClick={onCreate}>Start a new project <Icon name="plus" size={14} /></button></div></>
}

const PROJECT_COVERS: Record<string, { src: string; alt: string }> = {
  enfuce: { src: '/images/projects/enfuce.png', alt: 'Contactless card payment at a café counter' },
  circle: { src: '/images/projects/circle.png', alt: 'Financial professionals reviewing digital finance operations' },
  backerkit: { src: '/images/projects/backerkit.png', alt: 'Independent creators assembling a board-game prototype' },
}

function ProjectCover({ project }: { project: Project }) {
  const cover = PROJECT_COVERS[project.id]
  return cover
    ? <img className="project-art project-cover-image" src={cover.src} alt={cover.alt} />
    : <div className="project-cover-placeholder"><Icon name="folder" size={40} /><span>{project.name}</span></div>
}
