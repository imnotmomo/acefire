import { useMemo, useState } from 'react'
import type { CompanyReport, PeriodCoverage } from './backend'
import { formatDecimal, formatLocator, humanize, reportEvidence } from './backend'
import type { Project } from './domain'
import { Badge, Empty, Icon } from './ui'
import { evidenceState, ReviewStateBadge } from './ReviewState'
import type { DataState } from './dataState'
import CalculationLab from './CalculationLab'
import './calculation-lab.css'

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record) : []
const text = (value: unknown, fallback = 'Unknown'): string => value === null || value === undefined || value === '' ? fallback : String(value)

export default function ConnectedDashboard({ project, report, inspect, navigate, onCalculated, onRefresh }: { project: Project; report: CompanyReport; inspect: (id: string) => void; navigate: (path: string) => void; onCalculated: () => void; onRefresh: () => void }) {
  const evidence = useMemo(() => reportEvidence(report), [report])
  const calculations = evidence.filter(item => item.kind === 'calculation').sort((a, b) => {
    const time = (item: typeof a) => String((item.calculation?.parameters.agent_execution as Record<string, unknown> | undefined)?.executed_at ?? '')
    return time(b).localeCompare(time(a))
  })
  const observations = evidence.filter(item => item.kind === 'observation')
  const profiles = evidence.filter(item => item.kind === 'profile')
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('all')
  const [visibleRows, setVisibleRows] = useState(20)
  const [coverageIndex, setCoverageIndex] = useState('0')
  const [stateFilter, setStateFilter] = useState<'all' | DataState>('all')
  const [statementSearch, setStatementSearch] = useState('')
  const [visibleStatements, setVisibleStatements] = useState(8)
  const statements = evidence.filter(item => item.kind === 'statement')
  const [profileQuery, setProfileQuery] = useState('')
  const [profileRows, setProfileRows] = useState(8)
  const providers = [...new Set(report.reported_metrics.map(item => item.source.provider))]
  const filtered = observations.filter(item => `${item.title} ${item.value} ${item.file} ${item.period}`.toLowerCase().includes(query.toLowerCase()) && (provider === 'all' || item.sources.some(source => source.provider === provider)) && (stateFilter === 'all' || evidenceState(item) === stateFilter))
  const metricById = new Map(report.reported_metrics.map(item => [item.observation.id, item]))
  const primaryCalculation = calculations.find(item => item.calculation?.status === 'succeeded') ?? calculations[0]
  const coverage = report.data_period_coverage[Number(coverageIndex)]
  const flagMap = new Map([...report.conflicts, ...report.calculations.flatMap(item => item.conflicts ?? [])].filter(item => ['value_conflict', 'aggregate_value_conflict'].includes(text(item.kind))).map(item => [text(item.id), item]))
  const conflicts = [...flagMap.values()]
  const filteredProfiles = profiles.filter(item => `${item.title} ${item.value} ${item.locator}`.toLowerCase().includes(profileQuery.toLowerCase()))
  return <div className="connected-dashboard">
    <div className="page-heading dashboard-heading"><div><h1>Data dashboard</h1><div className="dashboard-breadcrumb"><Icon name="folder" size={13} />{project.name}<span>/</span>Financial evidence</div></div><button className="button primary" onClick={() => navigate(`/project/${project.id}/report/build`)}><Icon name="document" size={16} />Build report<Icon name="arrow" size={15} /></button></div>
    <CalculationLab report={report} onComplete={onCalculated} onRefresh={onRefresh} />
    <section className="connected-inventory" aria-label="Report inventory"><div><span>Source files</span><strong>{report.source_files.length}</strong></div><div><span>Reported observations</span><strong>{report.reported_metrics.length}</strong></div><div><span>Stored calculations</span><strong>{report.calculations.length}</strong></div><div><span>Numeric conflicts</span><strong>{conflicts.length}</strong></div></section>

    {primaryCalculation ? <section className="connected-calculation-hero">
      <div className="connected-hero-heading"><span className="section-kicker">Stored calculation</span><ReviewStateBadge state={evidenceState(primaryCalculation)} /></div>
      <button className="connected-hero-value" onClick={() => inspect(primaryCalculation.id)} aria-label={`Inspect ${primaryCalculation.title}`}>{primaryCalculation.value}<Icon name="outward" size={23} /></button>
      <h2>{primaryCalculation.title}</h2><p>{primaryCalculation.period}</p>
      <div className="connected-formula"><span>Recorded formula</span><code>{primaryCalculation.formula}</code></div>
      <div className="connected-hero-foot"><span><Icon name="link" size={15} />{primaryCalculation.inputIds?.length ?? 0} recorded inputs · {primaryCalculation.sources.length} input source references</span><button className="text-button" onClick={() => inspect(primaryCalculation.id)}>Follow the calculation<Icon name="arrow" size={15} /></button></div>
    </section> : <Empty icon="calculator" title="No stored calculations yet" text="Reported source values are available below. A financial result appears after the backend records a calculation with compatible inputs." />}

    {calculations.length > 1 && <section className="connected-calculation-list" aria-label="Stored calculations">{calculations.filter(item => item.id !== primaryCalculation?.id).map(item => <button key={item.id} className="connected-small-calculation" onClick={() => inspect(item.id)}><span>{item.title}<Icon name="outward" size={15} /></span><strong>{item.value}</strong><small>{item.period}</small><ReviewStateBadge state={evidenceState(item)} /></button>)}</section>}

    {(report.conflict_numbers || conflicts.length > 0) && <section className="connected-flags" aria-label="Conflict numbers"><div className="section-heading"><div><h3><Icon name="flag" size={17} />Conflict numbers</h3><p className="section-description">Comparable values disagree. Both values keep their sources.</p></div><Badge tone="amber">Flagged</Badge></div>{conflicts.map(conflict => <div className="connected-conflict-alternatives" key={text(conflict.id)}>{records(conflict.alternatives).map((alternative, index) => {
      const sources = records(alternative.sources)
      const ids = Array.isArray(alternative.observation_ids) ? alternative.observation_ids : []
      const evidenceId = typeof alternative.calculation_id === 'string' ? alternative.calculation_id : ids.find(id => typeof id === 'string' && evidence.some(item => item.id === id))
      return <div className="connected-conflict-alternative" key={index}><strong>{formatDecimal(typeof alternative.value === 'string' ? alternative.value : null, typeof alternative.unit === 'string' ? alternative.unit : undefined)}</strong><span>{text(alternative.scope, 'Scope unknown')} · {text(alternative.definition_key, 'Definition unknown')}</span>{sources.map((source, sourceIndex) => <small key={sourceIndex}>{text(source.file_name, 'Source file unknown')} · {formatLocator(record(source.locator))}</small>)}{typeof evidenceId === 'string' && <button className="text-button" onClick={() => inspect(evidenceId)}>Inspect source<Icon name="outward" size={13} /></button>}</div>
    })}</div>)}</section>}

    <div className="review-state-legend" aria-label="Data states"><ReviewStateBadge state="missing" /><span>Required data is absent</span><ReviewStateBadge state="verify" /><span>Evidence is available for review</span><ReviewStateBadge state="conflict" /><span>Comparable numbers disagree</span></div>
    <section className="connected-period-section"><div className="section-heading"><div><h3>Period coverage</h3><p className="section-description">Exact source windows, including partial periods and closing balances.</p></div></div>{report.data_period_coverage.length ? <>
      <label className="connected-coverage-select">Metric and source<select value={coverageIndex} onChange={event => setCoverageIndex(event.target.value)}>{report.data_period_coverage.map((item, index) => <option key={index} value={String(index)}>{humanize(item.metric_key || 'Unknown metric')} · {humanize(item.provider || 'Unknown provider')} · {item.scope || 'Scope unknown'} · {item.unit || 'Unit unknown'}</option>)}</select></label>
      {coverage && <CoverageDetails coverage={coverage} inspect={inspect} />}
    </> : <p className="muted">No period coverage has been recorded.</p>}</section>

    <section className="evidence-checks connected-observations"><div className="section-heading"><div><h3>Reported source values</h3><p className="section-description">Source observations retain their original definitions, units and company scope.</p></div><Badge>{observations.length} observations</Badge></div>
      <div className="connected-observation-filters"><label className="search-field compact"><Icon name="search" size={15} /><input aria-label="Search reported values" value={query} onChange={event => { setQuery(event.target.value); setVisibleRows(20) }} placeholder="Find a metric, period or source…" /></label><label>Source<select aria-label="Filter reported values by source" value={provider} onChange={event => { setProvider(event.target.value); setVisibleRows(20) }}><option value="all">All sources</option>{providers.map(item => <option key={item} value={item}>{humanize(item)}</option>)}</select></label><label>State<select aria-label="Filter reported values by state" value={stateFilter} onChange={event => { setStateFilter(event.target.value as 'all' | DataState); setVisibleRows(20) }}><option value="all">All states</option><option value="missing">Missing</option><option value="verify">Verify</option><option value="conflict">Conflict</option></select></label></div>
      {filtered.length ? <><div className="table-scroll"><table className="checks-table"><thead><tr><th>Metric / value</th><th>Period / scope</th><th>Source location</th><th>Status</th></tr></thead><tbody>{filtered.slice(0, visibleRows).map(item => {
        const metric = metricById.get(item.id)
        return <tr key={item.id}><td><button className="table-link" onClick={() => inspect(item.id)}>{item.title}<Icon name="outward" size={13} /></button><strong className="connected-table-value">{item.value}</strong>{item.rawValue != null && item.value === 'Unavailable' && <small>Raw: {item.rawValue}</small>}</td><td><span>{item.period}</span><small>{metric?.observation.scope || 'Scope unknown'} · {humanize(metric?.observation.scenario || 'unknown')}</small></td><td><span>{item.file}</span><small>{item.locator}</small></td><td><ReviewStateBadge state={evidenceState(item)} /></td></tr>
      })}</tbody></table></div><div className="connected-table-footer"><span>Showing {Math.min(visibleRows, filtered.length)} of {filtered.length} observations</span>{visibleRows < filtered.length && <button className="button secondary" onClick={() => setVisibleRows(value => value + 20)}>Show more values</button>}</div></> : <Empty icon="search" title="No matching source values" text="Try another metric, period or source." />}
    </section>

    {statements.length > 0 && <section className="connected-statement-panel"><div className="section-heading"><div><h3>Source sentences for company reports</h3><p className="section-description">Stored quotations retain their original file and location. Extracted claims and model summaries remain separate.</p></div><Badge>{statements.length} quotations</Badge></div><label className="search-field compact"><Icon name="search" size={15} /><input aria-label="Search source sentences" value={statementSearch} onChange={event => { setStatementSearch(event.target.value); setVisibleStatements(8) }} placeholder="Find an original sentence or claim…" /></label><div className="connected-statements">{statements.filter(item => `${item.title} ${item.excerpt} ${item.file}`.toLowerCase().includes(statementSearch.toLowerCase())).slice(0, visibleStatements).map(item => <article className="connected-statement-card" key={item.id}><ReviewStateBadge state={evidenceState(item)} /><blockquote>{item.excerpt}</blockquote><p>{item.file} · {item.locator}</p><button className="text-button" onClick={() => inspect(item.id)}>Inspect sentence evidence<Icon name="outward" size={13} /></button></article>)}</div>{visibleStatements < statements.filter(item => `${item.title} ${item.excerpt} ${item.file}`.toLowerCase().includes(statementSearch.toLowerCase())).length && <button className="button secondary" onClick={() => setVisibleStatements(value => value + 8)}>Show more source sentences</button>}</section>}

    <section className="connected-profile-panel"><div className="section-heading"><div><h3>Stored company profile</h3><p className="section-description">{report.company.legal_name} · Primary source: {humanize(report.company.primary_provider)}</p></div><Badge tone="blue">{profiles.length} source fields</Badge></div>{profiles.length ? <><label className="search-field compact connected-profile-search"><Icon name="search" size={15} /><input aria-label="Search company profile" placeholder="Find a profile field…" value={profileQuery} onChange={event => { setProfileQuery(event.target.value); setProfileRows(8) }} /></label><div className="connected-profile-fields">{filteredProfiles.slice(0, profileRows).map(item => <button key={item.id} onClick={() => inspect(item.id)}><span>{item.title}</span><strong>{item.value}</strong><small>{item.locator}<Icon name="outward" size={13} /></small></button>)}</div>{!filteredProfiles.length && <p className="muted">No matching profile fields.</p>}<div className="connected-table-footer"><span>Showing {Math.min(profileRows, filteredProfiles.length)} of {filteredProfiles.length} fields</span>{profileRows < filteredProfiles.length && <button className="button secondary" onClick={() => setProfileRows(value => value + 8)}>Show more profile fields</button>}</div></> : <p className="muted">Company profile fields have not been supplied.</p>}<div className="connected-pending-note"><Icon name="upload" size={15} /><span>Upload private source files in the data room. New Akta retrieval is still pending; saved Akta records remain available.</span><button className="text-button" onClick={() => navigate(`/project/${project.id}/data-room`)}>Open data room<Icon name="arrow" size={13} /></button></div></section>

    {report.gaps.length > 0 && <section className="connected-gap-panel"><h3>Evidence gaps</h3><ul>{report.gaps.map((gap, index) => <li key={index}><strong>{gap.metric_key ? humanize(String(gap.metric_key)) : humanize(String(gap.code || 'Evidence gap'))}</strong><span>{text(gap.message, 'Supporting evidence has not been supplied.')}</span></li>)}</ul></section>}
  </div>
}

function CoverageDetails({ coverage, inspect }: { coverage: PeriodCoverage; inspect: (id: string) => void }) {
  const known = coverage.known_periods ?? []
  const instant = coverage.instant_periods ?? []
  const unresolved = coverage.unresolved_periods ?? []
  return <div className="connected-coverage-details">
    <div className="connected-coverage-summary"><div><span>Recorded duration span</span><strong>{coverage.available_start && coverage.available_end ? `${coverage.available_start} – ${coverage.available_end}` : 'No exact duration span'}</strong></div><div><span>Duration periods</span><strong>{known.length}</strong></div><div><span>Closing balances</span><strong>{instant.length}</strong></div><div><span>Unknown periods</span><strong>{unresolved.length}</strong></div></div>
    <div className="connected-period-badges">{known.map((item, index) => <button className="connected-period-pill" key={`duration:${index}`} onClick={() => inspect(text(item.observation_id))}><strong>{text(item.period_label, 'Recorded interval')}</strong><span>{text(item.period_start)} – {text(item.period_end)}</span><small>{humanize(text(item.grain))}</small></button>)}{instant.map((item, index) => <button className="connected-period-pill" key={`instant:${index}`} onClick={() => inspect(text(item.observation_id))}><strong>{text(item.period_label, 'Closing balance')}</strong><span>As of {text(item.period_end)}</span><small>Point in time</small></button>)}{unresolved.map((item, index) => <button className="connected-period-pill unresolved" key={`unknown:${index}`} onClick={() => inspect(text(item.observation_id))}><strong>{text(item.period_label, 'Period unknown')}</strong><span>Exact dates unavailable</span></button>)}</div>
    {Boolean(coverage.gaps?.length || coverage.overlaps?.length) && <div className="connected-coverage-warnings">{coverage.gaps?.map((gap, index) => <p key={`gap:${index}`}><Icon name="help" size={14} />Gap: {text(gap.start)} – {text(gap.end)}</p>)}{Boolean(coverage.overlaps?.length) && <p><Icon name="help" size={14} />{coverage.overlaps?.length} recorded overlapping intervals. Overlapping totals are kept separate.</p>}</div>}
    <p className="connected-coverage-note">Partial periods keep their exact dates. Displayed coverage does not annualize or add source values.</p>
  </div>
}
