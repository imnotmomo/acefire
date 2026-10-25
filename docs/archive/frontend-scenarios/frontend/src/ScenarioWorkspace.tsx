import { useEffect, useState } from 'react'
import type { Project, Workspace } from './domain'
import { readLocal, saveLocal } from './domain'
import type { DemoScenario, ScenarioClaim } from './scenarios'
import { initialScenarioWorkspace } from './scenarios'
import { Badge, Dialog, Icon } from './ui'
import Report from './Report'
import './scenarios.css'

type Props = { project: Project; scenario: DemoScenario; page: string; stage: string; notify: (message: string) => void }
export default function ScenarioWorkspace({ project, scenario, page, stage, notify }: Props) {
  const key = `acefire:workspace:v1:${project.id}`
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    const saved = readLocal<Workspace | null>(key, null)
    return saved && Array.isArray(saved.sections) && Array.isArray(saved.order) && Array.isArray(saved.revisions) && saved.configs ? saved : initialScenarioWorkspace(scenario)
  })
  const [selected, setSelected] = useState(scenario.claims[0].id)
  const [inspecting, setInspecting] = useState<string | null>(null)
  const claim = scenario.claims.find(item => item.id === selected) ?? scenario.claims[0]
  const inspected = scenario.claims.find(item => item.evidenceId === inspecting)
  useEffect(() => { if (!saveLocal(key, workspace)) notify('Scenario edits could not be saved in this browser.') }, [key, workspace, notify])
  const navigate = (path: string) => { window.location.hash = path }
  return <>
    <div className="scenario-disclosure" role="note"><Icon name="help" size={19} /><div><strong>Illustrative demo · fictional company and evidence</strong><p>Numbers, documents, external excerpts and assessments are simulated. No live PubMed, FDA, hospital, App Store, Reddit or traffic-data search has been performed. “Verified” below means supported within this fictional example.</p></div></div>
    {page === 'Report' ? <Report project={project} workspace={workspace} setWorkspace={setWorkspace} stage={stage} navigate={navigate} inspect={setInspecting} notify={notify} demoScenario={scenario} /> : page === 'Data room' ? <><div className="page-heading"><div><h1>Data room</h1><p>Illustrative internal and external evidence packs.</p></div><Badge tone="amber">Simulated sources</Badge></div><div className="scenario-source-list">{scenario.claims.map(item => <button key={item.id} onClick={() => setInspecting(item.evidenceId)}><Icon name="document" size={22} /><span><strong>{item.title}</strong><small>{item.channel} · illustrative excerpts</small></span><Badge>Simulated</Badge><Icon name="outward" size={17} /></button>)}</div></> : <>
      <div className="page-heading"><div><div className="scenario-eyebrow">{scenario.question}</div><h1>{scenario.title}</h1><p>{scenario.description}</p></div><button className="button primary" onClick={() => navigate(`/project/${project.id}/report/review`)}>Review report <Icon name="arrow" size={16} /></button></div>
      <div className="scenario-flow" aria-label="Evidence workflow">{scenario.stages.map((item, index) => <span key={item}><strong>{item}</strong>{index < scenario.stages.length - 1 && <Icon name="arrow" size={15} />}</span>)}</div>
      <div className="scenario-layout"><section className="scenario-claims" aria-label="Company claims"><div className="section-heading"><h2>Company claims</h2><span>{scenario.claims.length} examples</span></div>{scenario.claims.map(item => <button key={item.id} className={`scenario-claim-option ${selected === item.id ? 'active' : ''}`} onClick={() => setSelected(item.id)} aria-pressed={selected === item.id}><span className="scenario-claim-title">{item.title}</span><strong>{item.claim}</strong><Assessment claim={item} /><span className="scenario-open">Follow the evidence <Icon name="arrow" size={14} /></span></button>)}</section>
      <section className="scenario-trace" aria-label="Selected claim evidence"><div className="section-heading"><h2>{claim.title}</h2><Assessment claim={claim} /></div><div className="scenario-trace-step"><span>01 · Company claim</span><h3>{claim.claim}</h3></div><div className="scenario-trace-step"><span>02 · Internal evidence · simulated</span><p>{claim.internal}</p></div><div className="scenario-trace-step"><span>03 · External evidence · simulated</span><small>{claim.channel}</small><p>{claim.external}</p></div><div className={`scenario-assessment ${claim.status.toLowerCase()}`}><span>Investment question</span><p>{claim.conclusion}</p></div><button className="button secondary" onClick={() => setInspecting(claim.evidenceId)}>Inspect evidence pack <Icon name="outward" size={15} /></button></section></div>
    </>}
    {inspected && <Dialog title="Illustrative evidence pack" subtitle="Fictional source excerpts for demonstrating the diligence workflow." onClose={() => setInspecting(null)}><div className="dialog-body"><Badge tone="amber">SIMULATED · not retrieved evidence</Badge><h3>{inspected.title}</h3><h4>Company claim</h4><p>{inspected.claim}</p><h4>Internal evidence · simulated</h4><blockquote>{inspected.internal}</blockquote><h4>External evidence · simulated</h4><small>{inspected.channel}</small><blockquote>{inspected.external}</blockquote><Assessment claim={inspected} /><p>{inspected.conclusion}</p><p className="preview-note">No original document, page locator, DOI, trial ID, FDA identifier or file hash is claimed for this fictional example.</p></div></Dialog>}
  </>
}
function Assessment({ claim }: { claim: ScenarioClaim }) { return <span className={`scenario-status ${claim.status.toLowerCase()}`}><Icon name={claim.status === 'Verified' ? 'check' : claim.status === 'Contradicted' ? 'flag' : 'help'} size={13} />{claim.status} · example</span> }
