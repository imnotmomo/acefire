import { useState } from 'react'
import type { Project, Workspace } from './domain'
import { emptyWorkspace, readLocal } from './domain'
import { backendProjectId } from './backend'
import { Badge, Empty, Icon } from './ui'
import { usePageMotion } from './motion'

type Props = { projects: Project[]; archivedIds: Set<string>; onCreate: () => void; onManage: (project: Project) => void; onConnect: (project: Project) => Promise<void>; connectingId: string | null }
const shared = (project: Project) => Boolean(project.backendDealId ?? backendProjectId(project.id))

export default function Projects({ projects, archivedIds, onCreate, onManage, onConnect, connectingId }: Props) {
  const pageMotionRef = usePageMotion('projects')
  const [search, setSearch] = useState(''), [sector, setSector] = useState('All sectors'), [layout, setLayout] = useState('grid')
  const [view, setView] = useState('active')
  const active = projects.filter(p => p.id !== 'enfuce' && !archivedIds.has(p.id))
  const scope = projects.filter(p => view === 'examples' ? p.id === 'enfuce' : p.id !== 'enfuce' && archivedIds.has(p.id) === (view === 'archived'))
  const shown = scope.filter(p => `${p.name} ${p.sector} ${p.geography}`.toLowerCase().includes(search.toLowerCase()) && (sector === 'All sectors' || p.sector === sector))
  return <div ref={pageMotionRef} className="page-transition" data-page="Projects"><h1 className="sr-only">Projects</h1>
    <div className="project-stats">{[{ icon: 'folder', value: active.length, name: 'Active projects', text: 'Current research workspaces' }, { icon: 'link', value: active.filter(shared).length, name: 'Shared companies', text: 'Evidence stored by the backend' }, { icon: 'document', value: active.filter(p => !shared(p)).length, name: 'Browser projects', text: 'Connect to share evidence' }].map(item => <div className="project-stat" key={item.name}><span><Icon name={item.icon} size={22} /></span><div><strong>{item.value}</strong><h3>{item.name}</h3><p>{item.text}</p></div></div>)}</div>
    <div className="project-list-heading"><div><h2>{view === 'examples' ? 'Examples' : view === 'archived' ? 'Archived projects' : 'All projects'} <span>{scope.length}</span></h2></div><div className="project-filters">
      <label className="filter-select"><select aria-label="Project collection" value={view} onChange={e => { setView(e.target.value); setSector('All sectors') }}><option value="active">Active projects</option><option value="archived">Archived projects</option><option value="examples">Historical example</option></select></label>
      <label className="search-field"><Icon name="search" size={16} /><input aria-label="Search projects" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects…" /></label>
      <label className="filter-select"><Icon name="filter" size={15} /><select aria-label="Filter projects by sector" value={sector} onChange={e => setSector(e.target.value)}><option>All sectors</option>{[...new Set(scope.map(p => p.sector))].map(item => <option key={item}>{item}</option>)}</select></label>
      <button className="icon-button view-toggle" aria-label={layout === 'grid' ? 'Switch to list view' : 'Switch to grid view'} onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}><Icon name={layout === 'grid' ? 'menu' : 'dashboard'} size={19} /></button></div></div>
    <div className={`project-cards ${layout === 'list' ? 'list' : ''}`}>{shown.map((project, index) => {
      const seeded = project.id === 'enfuce', linked = shared(project), archived = archivedIds.has(project.id)
      const workspace = readLocal<Workspace>(`acefire:workspace:v1:${project.id}`, emptyWorkspace())
      const documents = readLocal<unknown[]>(`acefire:documents:v1:${project.id}`, [])
      const localCount = Array.isArray(documents) ? documents.length : 0
      return <article className="project-card" key={project.id}>
        <a href={`#/project/${project.id}/dashboard`} className={`project-cover cover-${index % 3}`} aria-label={`Open ${project.name} dashboard`}><ProjectCover project={project} /><span className="project-cover-number">{String(index + 1).padStart(2, '0')}</span><span className="cover-project-tag"><Icon name="folder" size={13} />{seeded ? 'Historical snapshot' : archived ? 'Archived workspace' : linked ? 'Shared company' : 'Browser workspace'}</span><span className="cover-open"><Icon name="outward" size={18} /></span></a>
        <div className="project-card-body"><div className="project-card-title"><div><h3><a href={`#/project/${project.id}/dashboard`}>{project.name}</a></h3><Badge tone={index % 2 === 0 ? 'blue' : 'purple'}>{project.sector}</Badge></div>{!seeded && <button className="icon-button" aria-label={`Manage ${project.name}`} onClick={() => onManage(project)}><Icon name="settings" size={18} /></button>}</div>
          <div className="project-owner"><span className="company-avatar tiny">{project.name.slice(0, 1).toLowerCase()}.</span><span><strong>{project.name}</strong><small>{project.geography}</small></span><span className="project-status"><span className={`status-dot ${linked ? '' : 'gray'}`} />{seeded ? 'Example' : archived ? 'Archived' : linked ? 'Connected' : 'Browser only'}</span></div>
          <div className="project-card-stats"><div><Icon name="document" size={17} /><span><strong>{linked ? 'View data room' : (seeded ? 3 : 0) + localCount}</strong><small>Sources</small></span></div><div><Icon name="layers" size={17} /><span><strong>{workspace?.sections?.length ?? 0}</strong><small>Draft sections here</small></span></div></div>
          <div className="project-card-actions">{!seeded && !linked && <button className="button secondary" disabled={Boolean(connectingId)} onClick={() => { void onConnect(project) }}><Icon name={connectingId === project.id ? 'loading' : 'link'} size={14} />{connectingId === project.id ? 'Connecting…' : 'Connect company workspace'}</button>}<a className="button secondary" href={`#/project/${project.id}/data-room`}>Data room<Icon name="folderOpen" size={14} /></a><a className="button secondary" href={`#/project/${project.id}/report/build`}>Build report<Icon name="document" size={14} /></a></div>
        </div></article>
    })}{shown.length === 0 && <Empty icon="search" title={scope.length ? 'No projects match' : view === 'archived' ? 'No archived projects' : 'Start your company research'} text={scope.length ? 'Try another name or choose a different sector.' : view === 'archived' ? 'Archived workspaces can be restored here.' : 'Create a company workspace and upload its source files.'}>{view === 'active' && <button className="button primary" onClick={onCreate}>Create project<Icon name="plus" size={15} /></button>}</Empty>}</div>
    <div className="projects-bottom-note"><Icon name="shield" size={15} /><span>Files and saved reports are shared. Unsaved edits stay in this browser.</span><button className="text-button" onClick={onCreate}>Start a new project <Icon name="plus" size={14} /></button></div>
  </div>
}

const COVERS: Record<string, string> = { enfuce: '/images/projects/narrative.jpg', 'enfuce-documents': '/images/projects/narrative.jpg', circle: '/images/projects/claims.jpg', backerkit: '/images/projects/numbers.jpg' }
function ProjectCover({ project }: { project: Project }) {
  return COVERS[project.id] ? <img className="project-art project-cover-image" src={COVERS[project.id]} alt="" /> : <div className="project-cover-placeholder"><Icon name="folder" size={40} /><span>{project.name}</span></div>
}
