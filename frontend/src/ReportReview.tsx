import { Fragment, useMemo, useState } from 'react'
import type { Evidence } from './data'
import type { BackendEvidence } from './backend'
import { formatLocator } from './backend'
import { ReviewStateBadge, evidenceState } from './ReviewState'
import type { Project, Section, Workspace } from './domain'
import { reviewAdvice, reviewParagraphs } from './review'
import { Badge, Icon } from './ui'
import './review.css'

type Selection = { sectionId: string; content: string; paragraph: number; sentence: number }
type Props = { project: Project; workspace: Workspace; evidence: Evidence[]; backend: boolean; companyName?: string; inspect: (id: string) => void; edit: (section: Section) => void; history: () => void; onExport: () => void }

export default function ReportReview({ project, workspace, evidence, backend, companyName, inspect, edit, history, onExport }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [panel, setPanel] = useState<'sources' | 'activity'>('sources')
  const [filter, setFilter] = useState('All')
  const [outlineId, setOutlineId] = useState<string | null>(null)
  const availableIds = useMemo(() => new Set(evidence.map(item => item.id)), [evidence])
  const paragraphs = useMemo(() => new Map(workspace.sections.map(section => [section.id, reviewParagraphs(section.content, availableIds, section.evidenceIds)])), [workspace.sections, availableIds])
  const section = workspace.sections.find(item => item.id === selection?.sectionId && item.content === selection.content)
  const paragraph = section && selection ? paragraphs.get(section.id)?.[selection.paragraph] : undefined
  const selectedText = paragraph && selection ? paragraph.sentences[selection.sentence] : undefined
  const selectedClaims = section?.sourceClaims?.filter(claim => paragraph?.text === `${claim.kind === 'inference' ? 'Inference: ' : ''}${claim.text}` && claim.citations.length > 0 && claim.citations.every(citation => paragraph.evidenceIds.includes(citation.evidence_id))) ?? []
  const findings = paragraph?.evidenceIds.map(id => evidence.find(item => item.id === id)!).filter(Boolean) ?? []
  const advice = useMemo(() => reviewAdvice(workspace.sections, evidence), [workspace.sections, evidence])
  const humanRevisions = [...workspace.revisions].reverse().filter(revision => revision.author.startsWith('You'))
  function selectPassage(next: Selection) {
    setSelection(next); setPanel('sources')
    if (window.matchMedia('(max-width:1000px)').matches) requestAnimationFrame(() => {
      document.getElementById('report-findings')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    })
  }
  function scrollToSection(id: string) {
    setOutlineId(id)
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }
  function reviewSource(id: string) {
    const target = workspace.sections.find(item => paragraphs.get(item.id)?.some(p => p.evidenceIds.includes(id)))
    if (!target) return
    const index = paragraphs.get(target.id)!.findIndex(p => p.evidenceIds.includes(id))
    selectPassage({ sectionId: target.id, content: target.content, paragraph: index, sentence: 0 })
    if (!window.matchMedia('(max-width:1000px)').matches) scrollToSection(target.id)
  }
  return <div className="review-grid report-review">
    <aside className="outline"><h3>In this report</h3>{workspace.sections.map((item, index) => <button key={item.id} className={outlineId === item.id ? 'active' : ''} onClick={() => scrollToSection(item.id)}><span>{String(index + 1).padStart(2, '0')}</span>{item.title}</button>)}<div className="outline-footer"><Icon name="link" size={18} /><strong>Read. Select. Trace.</strong><p>Select a sentence or number to see its source references in Findings.</p></div></aside>
    <article className="report-paper"><div className="paper-brand"><Icon name="zap" size={18} /> Ingenium <span>Research workspace</span></div><p className="document-type">Diligence report</p><h2>{companyName ?? project.name}</h2><p className="report-byline">{project.sector} / {project.geography} / {backend ? 'Source-backed model draft · unverified' : 'Historical evidence snapshot'}</p><div className="preview-note"><Icon name="help" size={16} />Dotted underlines lead to the original evidence. Select a passage to read its sources.</div>
      {workspace.sections.map((item, index) => <section key={item.id} id={`section-${item.id}`} className="report-section"><div className="report-section-title"><h3><span>{index + 1}.</span> {item.title}</h3><button className="icon-button" aria-label={`Edit ${item.title}`} onClick={() => edit(item)}><Icon name="pencil" size={16} /></button></div>{paragraphs.get(item.id)!.map((passage, pi) => <div className="review-paragraph" key={pi}><p>{passage.sentences.map((sentence, si) => {
        const active = Boolean(section?.id === item.id && selection?.paragraph === pi && selection?.sentence === si)
        const linked = passage.evidenceIds.length > 0
        return <Fragment key={si}>{linked || passage.missingIds.length ? <button className={`report-claim ${linked ? 'source-linked' : 'source-missing'} ${active ? 'selected' : ''}`} aria-pressed={active} aria-controls="report-findings" title={linked ? `${passage.evidenceIds.length} source reference${passage.evidenceIds.length === 1 ? '' : 's'} · click to inspect` : 'The cited source is unavailable'} onClick={() => selectPassage({ sectionId: item.id, content: item.content, paragraph: pi, sentence: si })}>{sentence.trimEnd()}</button> : <span className="report-uncited">{sentence.trimEnd()}</span>}{/\n\s*$/.test(sentence) ? <br /> : ' '}</Fragment>
      })}</p></div>)}{item.humanEdited && item.generation && <Badge tone="amber">Human edited · source support not reverified</Badge>}{backend && <ReviewStateBadge state={item.sourceClaims?.some(claim => claim.reviewState === 'conflict') || item.evidenceIds.some(id => (evidence.find(e => e.id === id) as Partial<BackendEvidence>)?.conflictNumbers) ? 'conflict' : item.evidenceIds.length ? 'verify' : 'missing'} />}{!item.evidenceIds.length && <Badge tone="amber">Evidence needed</Badge>}</section>)}
      <div className="paper-end">Evidence informs the work. The judgment remains yours.</div>
    </article>
    <div className="review-context"><div className="review-context-tabs" role="tablist" aria-label="Report reference panels"><button role="tab" aria-selected={panel === 'sources'} onClick={() => setPanel('sources')}><Icon name="link" size={14} />Sources</button><button role="tab" aria-selected={panel === 'activity'} onClick={() => setPanel('activity')}><Icon name="history" size={14} />Activity<span>{humanRevisions.length + advice.length}</span></button></div>
    <aside hidden={panel !== 'sources'} className="suggestions findings-panel" id="report-findings" aria-label="Findings"><div className="section-heading"><h3><Icon name="link" size={16} /> Findings{selectedText && <span>{findings.length}</span>}</h3>{selectedText && <button className="icon-button" aria-label="Clear selected passage" onClick={() => setSelection(null)}><Icon name="x" size={15} /></button>}</div>
      <div className="finding-selection" role="status">{selectedText ? <><small>Selected passage</small><blockquote>{selectedText}</blockquote><p>Source references are recorded for this paragraph. Verify the selected statement against the originals.</p></> : <div className="findings-empty"><Icon name="document" size={27} /><h4>Select a sentence or number</h4><p>Its recorded source references will appear here.</p></div>}</div>
      {selectedText && section && selectedClaims.length > 0 && <NarrativeSupport section={{ ...section, sourceClaims: selectedClaims }} inspect={inspect} />}
      {selectedText && findings.map(item => <FindingCard key={item.id} evidence={item} inspect={inspect} />)}
      {selectedText && findings.length === 0 && <div className="finding-missing"><Badge tone="amber">No linked evidence</Badge><p>This passage has no available source citation. Add a source reference when revising the report.</p></div>}
      {selectedText && Boolean(paragraph?.missingIds.length) && <div className="finding-missing" role="alert"><Badge tone="amber">Source unavailable</Badge><p>{paragraph!.missingIds.length} cited reference(s) could not be found in the loaded evidence.</p></div>}
    </aside>
    <aside hidden={panel !== 'activity'} className="activity-rail"><div className="section-heading"><h3>Activity <span>{humanRevisions.length + advice.length}</span></h3></div><div className="activity-filters">{['All', 'Human', 'Agent'].map(value => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div><div className="activity-events">
      {filter !== 'Agent' && humanRevisions.map(revision => <div key={revision.id} className="activity-event human-revision"><span>H</span><div><small>Human revision</small><time dateTime={revision.at}>{new Date(revision.at).toLocaleString()}</time><p>Revised {revision.title}</p><details><summary>Compare changes</summary><h4>Before</h4><pre>{revision.before}</pre><h4>After</h4><pre>{revision.after}</pre></details></div></div>)}
      {filter !== 'Human' && advice.map(item => <div key={item.id} className="activity-event agent-advice"><span>A</span><div><small>Agent advice · evidence rule</small><Badge tone="amber">{item.conflict ? 'Conflicting values' : 'Review needed'}</Badge><h4>{item.evidence.title}</h4><p>{item.message}</p><button className="text-button" onClick={() => reviewSource(item.id)}>Review passage <Icon name="link" size={13} /></button><button className="text-button" onClick={() => edit(item.section)}>Revise section <Icon name="pencil" size={13} /></button></div></div>)}
      {(filter === 'Human' ? humanRevisions.length === 0 : filter === 'Agent' ? advice.length === 0 : humanRevisions.length + advice.length === 0) && <p className="activity-empty">{filter === 'Human' ? 'No human revisions yet.' : filter === 'Agent' ? 'No source review advice for this report.' : 'Human revisions and source review advice will appear here.'}</p>}
    </div><button className="text-button" onClick={history}>Full revision history<Icon name="history" size={14} /></button></aside>
    </div>
    <div className="review-footer"><button className="button secondary" onClick={onExport}>Continue to export <Icon name="arrow" size={15} /></button></div>
  </div>
}

function FindingCard({ evidence: item, inspect }: { evidence: Evidence; inspect: (id: string) => void }) {
  const backend = item as Partial<BackendEvidence>
  return <section className="finding-card"><div className="finding-card-header">{backend.kind ? <ReviewStateBadge state={evidenceState(item as BackendEvidence)} /> : <Badge tone={item.status === 'Needs review' ? 'amber' : 'neutral'}>{item.status}</Badge>}</div><h4>{item.title}</h4><strong className="finding-value">{item.value}</strong><dl><dt>Source</dt><dd>{item.file}</dd><dt>Location</dt><dd>{item.locator || 'Not recorded'}</dd><dt>Period</dt><dd>{item.period}</dd><dt>Unit</dt><dd>{item.unit}</dd></dl><small className="finding-quote-label">{backend.quoteBasis === 'structured_record' ? 'Stored numeric record · structured evidence' : 'Source excerpt'}</small><blockquote>{backend.citationText ?? item.excerpt}</blockquote>{item.formula && <div className="finding-formula"><small>Recorded formula</small><code>{item.formula}</code></div>}{item.rows.length > 0 && <details><summary>Recorded values & context</summary><dl>{item.rows.map(([label, value], index) => <div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>}{item.note && <p className="finding-note">{item.note}</p>}<button className="button secondary full" onClick={() => inspect(item.id)}>Open source evidence <Icon name="outward" size={14} /></button></section>
}

function NarrativeSupport({ section, inspect }: { section: Section; inspect: (id: string) => void }) {
  return <details className="report-source-support"><summary>Original supporting text ({section.sourceClaims?.length ?? 0} claims)</summary><p>These quotations support the original generated claims. Model interpretation is shown separately from source text; human edits have not been reverified.</p>{section.sourceClaims?.map(claim => <article className="report-supported-claim" key={claim.id}><Badge tone={claim.kind === 'inference' ? 'amber' : 'blue'}>{claim.kind === 'inference' ? 'Model inference' : 'Model summary'}</Badge>{claim.reviewState && <ReviewStateBadge state={claim.reviewState} />}<p className="report-original-claim">{claim.text}</p>{claim.citations.map((citation, index) => <div className="report-claim-quotation" key={`${citation.evidence_id}:${index}`}><span>{citation.quote_basis === 'source_text' ? 'Original supporting text' : 'Stored numeric record · structured evidence'}</span><blockquote>{citation.quote}</blockquote>{(citation.source ? [citation.source] : citation.sources ?? []).map((source, sourceIndex) => <dl className="source-details" key={`${source.snapshot_id}:${sourceIndex}`}><dt>Source file</dt><dd>{source.file_name}</dd><dt>Location</dt><dd>{formatLocator(source.locator)}</dd><dt>SHA-256</dt><dd className="hash">{source.sha256}</dd><dt>Evidence ID</dt><dd className="hash">{citation.evidence_id}</dd></dl>)}<button className="text-button" onClick={() => inspect(citation.evidence_id)}>Inspect supporting evidence<Icon name="outward" size={13} /></button></div>)}</article>)}</details>
}
