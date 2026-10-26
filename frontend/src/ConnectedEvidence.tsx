import { useEffect, useId, useState } from 'react'
import type { BackendEvidence, BackendGraph, BackendSource } from './backend'
import { formatDecimal, formatLocator, humanize } from './backend'
import { Badge, Dialog, Empty, Icon } from './ui'
import { evidenceState, ReviewStateBadge } from './ReviewState'
import SourceFileButton from './SourceFileButton'
import SourceFilePreview from './SourceFilePreview'
import './calculation-lab.css'

type RecordValue = Record<string, unknown>
type SourceAccess = { sources?: BackendSource[]; onOpenSource?: (source: BackendSource) => void }
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const display = (value: unknown): string => value === null || value === undefined || value === '' ? 'Not supplied' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}` : JSON.stringify(value ?? null)
const sameOriginal = (left: RecordValue, right: RecordValue) => ['snapshot_id', 'sha256', 'file_name', 'provider'].every(key => typeof left[key] === 'string' && left[key] === right[key]) && canonical(left.locator) === canonical(right.locator)
const nodeKind = (node: BackendGraph['nodes'][number]): string => {
  const kind = display(node.data.kind ?? node.type)
  return kind === 'source' ? 'source_file' : kind === 'observation' ? 'source_observation' : kind
}

export function SourceReference({ source, onOpen }: { source: BackendSource; onOpen?: (source: BackendSource) => void }) {
  return <div className="connected-source-reference">
    <div className="connected-source-title"><Icon name={/\.xlsx?$/i.test(source.file_name) ? 'sheet' : 'document'} size={20} /><div><strong>{source.file_name}</strong><small>{humanize(source.provider)} · {source.data_role === 'primary_company_data' ? 'Primary company source' : 'Supplemental evidence'}</small></div></div>
    <dl className="connected-reference-details"><dt>Location</dt><dd>{formatLocator(source.locator)}</dd><dt>SHA-256</dt><dd className="hash">{source.sha256 || 'Not supplied'}</dd></dl>
    {source.locator && <details className="connected-native-locator"><summary>Original locator details</summary><dl className="connected-reference-details">{Object.entries(source.locator).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{display(value)}</dd></div>)}</dl></details>}
    <SourceFileButton source={source} onOpen={onOpen} />
  </div>
}

export function ConnectedEvidenceInspector({ evidence, onClose, notify }: { evidence: BackendEvidence; onClose: () => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState('Evidence')
  const [fileSource, setFileSource] = useState<BackendSource | null>(evidence.sources[0] ?? null)
  const openFile = (source: BackendSource) => { setFileSource(source); setTab('File') }
  const execution = record(evidence.calculation?.parameters.agent_execution)
  const hasExecution = Object.keys(execution).length > 0
  const textual = evidence.kind === 'statement' || evidence.kind === 'profile'
  return <Dialog title="Evidence inspector" subtitle="Original quotations, source files and the recorded calculation path." onClose={onClose} className="evidence-dialog connected-evidence-dialog">
    <div className="dialog-body">
      <div className="evidence-title"><span className={`module-icon ${evidence.conflictNumbers || evidence.status === 'Needs review' ? 'orange' : 'green'}`}><Icon name={evidence.kind === 'calculation' ? 'calculator' : 'fileCheck'} size={22} /></span><div><h3>{evidence.title}</h3><ReviewStateBadge state={evidenceState(evidence)} /></div></div>
      {textual ? <blockquote className="connected-source-quotation">{evidence.value}</blockquote> : <div className="inspector-value connected-exact-value">{evidence.value}<small>{evidence.period} / {evidence.unit}</small></div>}
      {fileSource && <div className="inspector-file-toolbar">{evidence.sources.length > 1 && <label>Source file and location<select aria-label="Inspect source file" value={evidence.sources.indexOf(fileSource)} onChange={e => setFileSource(evidence.sources[Number(e.target.value)])}>{evidence.sources.map((source, index) => <option key={index} value={index}>{source.file_name} · {formatLocator(source.locator)}</option>)}</select></label>}<SourceFileButton source={fileSource} onOpen={openFile} /></div>}
      {evidence.conflictNumbers && <div className="connected-conflict-note" role="status"><Icon name="flag" size={18} /><span><strong>Conflict numbers</strong> Comparable values disagree. The stored result and original source values remain available.</span></div>}
      <div className="tab-bar" role="tablist" aria-label="Evidence details">{['Evidence', ...(fileSource ? ['File'] : []), 'Lineage', ...(hasExecution ? ['Execution'] : []), 'Source details'].map(item => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
      {tab === 'File' && fileSource && (fileSource.preview_available === false ? <p className="source-file-unavailable">Original file unavailable here. The stored quotation and location remain available.</p> : <SourceFilePreview key={`${fileSource.snapshot_id}:${JSON.stringify(fileSource.locator)}`} source={fileSource} />)}
      {tab === 'Evidence' && <>
        {!textual && <p className="connected-evidence-excerpt">{evidence.excerpt}</p>}
        {evidence.formula && <div className="connected-formula"><span>Stored formula</span><code>{evidence.formula}</code></div>}
        {evidence.calculation && <dl className="source-details"><dt>Function</dt><dd>{evidence.calculation.function_key}</dd><dt>Function version</dt><dd>{evidence.calculation.function_version}</dd><dt>Calculation status</dt><dd>{humanize(evidence.calculation.status)}</dd></dl>}
        <div className="table-scroll"><table className="source-table"><caption>{evidence.kind === 'calculation' ? 'Recorded calculation and inputs' : 'Recorded source details'}</caption><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>{evidence.rows.map(([name, value], index) => <tr key={`${name}:${index}`}><td>{name}</td><td>{value}</td></tr>)}</tbody></table></div>
        <div className="evidence-caveat"><Icon name="help" size={17} /><div><strong>Evidence context</strong><p>{evidence.note}</p></div></div>
        {hasExecution && <CitedPremises execution={execution} sources={evidence.sources} onOpenSource={openFile} />}
        {Boolean(evidence.explanationSteps?.some(step => step.kind === 'source_normalization')) && <details className="connected-normalization"><summary>How source inputs were normalized</summary><div className="table-scroll"><table className="source-table"><thead><tr><th>Source / location</th><th>Raw value</th><th>Scale multiplier</th><th>Recorded normalized value</th><th>Basis</th></tr></thead><tbody>{evidence.explanationSteps?.filter(step => step.kind === 'source_normalization').map((step, index) => { const source = record(step.source); return <tr key={index}><td>{display(source.file_name)}<small>{formatLocator(record(source.locator))}</small></td><td>{display(step.raw_value)}</td><td>{display(step.scale_multiplier)}</td><td>{formatDecimal(step.normalized_value == null ? null : String(step.normalized_value), typeof step.unit === 'string' ? step.unit : undefined)}</td><td>{display(step.normalization_basis)}</td></tr> })}</tbody></table></div></details>}
        {Boolean(evidence.conflicts?.length) && <div className="connected-inspector-conflicts"><h4>Differing recorded values</h4>{evidence.conflicts?.map((conflict, index) => <div className="connected-conflict-alternatives" key={String(conflict.id ?? index)}>{(Array.isArray(conflict.alternatives) ? conflict.alternatives : []).map((value, alternativeIndex) => { const alternative = record(value); return <div className="connected-conflict-alternative" key={alternativeIndex}><strong>{formatDecimal(typeof alternative.value === 'string' ? alternative.value : null, typeof alternative.unit === 'string' ? alternative.unit : undefined)}</strong>{(Array.isArray(alternative.sources) ? alternative.sources : []).map((value, sourceIndex) => { const source = record(value); return <small key={sourceIndex}>{display(source.file_name)} · {formatLocator(record(source.locator))}</small> })}</div> })}</div>)}</div>}
        <div className="connected-source-list">{evidence.sources.map((source, index) => <SourceReference key={`${source.snapshot_id}:${index}`} source={source} onOpen={openFile} />)}</div>
      </>}
      {tab === 'Lineage' && (evidence.graph?.nodes.length ? <ConnectedLineage graph={evidence.graph} /> : <Empty icon="layers" title="No recorded graph" text="A lineage graph has not been supplied for this record." />)}
      {tab === 'Execution' && hasExecution && <AgentExecutionAudit execution={execution} sources={evidence.sources} onOpenSource={openFile} />}
      {tab === 'Source details' && <>
        <dl className="source-details"><dt>Record ID</dt><dd className="hash">{evidence.id}</dd><dt>Period</dt><dd>{evidence.period}</dd><dt>Unit</dt><dd>{evidence.unit}</dd><dt>Source locator</dt><dd>{evidence.locator}</dd></dl>
        <div className="connected-source-list">{evidence.sources.map((source, index) => <SourceReference key={`${source.snapshot_id}:${index}`} source={source} onOpen={openFile} />)}</div>
        <p className="muted">The original file opens in another tab or downloads in its native format. Locations are shown exactly as recorded; unavailable page or line numbers remain unknown.</p>
        <button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(`${evidence.title}\n${evidence.id}\n${evidence.value} | ${evidence.period}\n${evidence.sources.map(source => `${source.file_name} | ${formatLocator(source.locator)} | SHA-256 ${source.sha256}`).join('\n')}\n${evidence.note}`); notify('Source reference copied.') } catch { notify('Clipboard access was denied. Select and copy the source details manually.') } }}><Icon name="copy" size={16} />Copy reference</button>
      </>}
    </div>
  </Dialog>
}

export function AgentExecutionAudit({ execution, sources, onOpenSource }: { execution: RecordValue } & SourceAccess) {
  const items = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  const code = typeof execution.code === 'string' ? execution.code : ''
  const output = (value: unknown, limit = 16000) => typeof value === 'string' ? value.length > limit ? `${value.slice(0, limit)}\n[Display truncated; the complete recorded output remains in the calculation.]` : value : 'Not supplied'
  return <div className="connected-execution-audit"><Badge tone="amber">Model-generated · review context</Badge><h3>Generated code and execution</h3><p>The backend recorded the generated Python, selected source inputs and local worker output. Execution does not independently verify source definitions or assumptions.</p><dl className="source-details"><dt>Model</dt><dd>{display(execution.model)}</dd><dt>Generation provider</dt><dd>{display(execution.generation_provider)}</dd><dt>Execution</dt><dd>{execution.executor === 'local_python' || execution.mode === 'llm_local' ? 'Local Python worker' : display(execution.executor)}</dd><dt>Execution ID</dt><dd className="hash">{display(execution.execution_id)}</dd><dt>Executed at</dt><dd>{display(execution.executed_at)}</dd><dt>Exit code</dt><dd>{display(execution.exit_code)}</dd><dt>Worker cleanup</dt><dd>{execution.cleanup_succeeded === true ? 'Confirmed' : execution.cleanup_succeeded === false ? 'Not confirmed' : 'Not supplied'}</dd><dt>Code SHA-256</dt><dd className="hash">{display(execution.code_sha256)}</dd><dt>Input manifest SHA-256</dt><dd className="hash">{display(execution.input_manifest_sha256)}</dd></dl>{typeof execution.question === 'string' && <><h4>Calculation request</h4><p>{execution.question}</p></>}{typeof execution.explanation === 'string' && <><h4>Model explanation</h4><p>{execution.explanation}</p></>}<CitedPremises execution={execution} sources={sources} onOpenSource={onOpenSource} showSupplied />{items(execution.assumptions).length > 0 && <><h4>Model assumptions</h4><ul>{items(execution.assumptions).map((item, index) => <li key={index}>{item}</li>)}</ul></>}{items(execution.limitations).length > 0 && <><h4>Limitations</h4><ul>{items(execution.limitations).map((item, index) => <li key={index}>{item}</li>)}</ul></>}<h4>Generated Python</h4><pre aria-label="Generated calculation Python">{code ? output(code, 50000) : 'Code was not supplied in this record.'}</pre><h4>Standard output</h4><pre aria-label="Calculation standard output">{output(execution.stdout)}</pre><h4>Standard error</h4><pre aria-label="Calculation standard error">{output(execution.stderr)}</pre></div>
}

export function CitedPremises({ execution, showSupplied = false, sources = [], onOpenSource }: { execution: RecordValue; showSupplied?: boolean } & SourceAccess) {
  const premises = Array.isArray(execution.premises) ? execution.premises.filter(value => value && typeof value === 'object' && !Array.isArray(value)).map(record) : []
  const supplied = Array.isArray(execution.supplied_text_evidence) ? execution.supplied_text_evidence.filter(value => value && typeof value === 'object' && !Array.isArray(value)).map(record) : []
  if (!premises.length && !(showSupplied && supplied.length)) return null
  return <section className="connected-cited-premises" aria-label="Cited source premises"><h4>Cited premises</h4><p className="connected-premise-intro">Source quotes are recorded separately from the model’s role and explanation.</p>{premises.map((premise, index) => {
    const original = supplied.find(item => item.id === premise.evidence_id)
    const source = record(premise.source ?? original?.source)
    // Reuse a registered source object so the File tab keeps the exact selected
    // original and locator, with the same authenticated/hash-checked path.
    const originalSource = record(original?.source)
    const boundSource = original && sameOriginal(source, originalSource) ? sources.find(candidate => sameOriginal(source, record(candidate))) : undefined
    return <article className="connected-quoted-premise" key={`${display(premise.evidence_id)}:${index}`}><span className="connected-quote-label">Source quote</span><blockquote>{typeof premise.quote === 'string' ? premise.quote : 'No source quote recorded.'}</blockquote><dl className="source-details"><dt>Source field ID</dt><dd className="hash">{display(premise.evidence_id)}</dd><dt>Source file</dt><dd>{display(source.file_name)}</dd><dt>Location</dt><dd>{formatLocator(record(source.locator))}</dd><dt>SHA-256</dt><dd className="hash">{display(source.sha256)}</dd><dt>Model role</dt><dd>{display(premise.role)}</dd><dt>Model explanation</dt><dd>{display(premise.reason)}</dd></dl>{original && typeof original.text === 'string' && <details><summary>Original source text</summary><p className="connected-original-text">{original.text}</p></details>}{boundSource ? <SourceFileButton source={boundSource} onOpen={onOpenSource} /> : <p className="source-file-unavailable">This premise has no matching supplied original. Its stored quotation and source details remain available.</p>}</article>
  })}{showSupplied && supplied.length > 0 && <details className="connected-supplied-text"><summary>All supplied source text ({supplied.length})</summary>{supplied.map((item, index) => { const source = record(item.source); return <div key={`${display(item.id)}:${index}`}><blockquote>{typeof item.text === 'string' ? item.text : 'Text not supplied.'}</blockquote><small>{display(source.file_name)} · {formatLocator(record(source.locator))}</small><code>{display(item.id)}</code></div> })}</details>}</section>
}

export function ConnectedLineage({ graph }: { graph: BackendGraph }) {
  const [zoom, setZoom] = useState(100)
  const [selectedId, setSelectedId] = useState(graph.nodes[0]?.id ?? '')
  const markerId = useId().replace(/:/g, '')
  useEffect(() => { setSelectedId(graph.nodes[0]?.id ?? ''); setZoom(100) }, [graph])
  const nodes = graph.nodes.map((node, index) => {
    const kind = nodeKind(node)
    const column = kind === 'source_file' || kind === 'source' ? 0 : kind === 'calculation' ? 2 : 1
    return { ...node, x: node.position?.x ?? column * 355, y: node.position?.y ?? index * 145 }
  })
  const width = Math.max(1000, ...nodes.map(node => node.x + 290))
  const height = Math.max(210, ...nodes.map(node => node.y + 130))
  const selected = nodes.find(node => node.id === selectedId)
  const data = record(selected?.data)
  const observation = record(data.observation)
  const calculation = record(data.calculation)
  const source = record(data.source)
  const selectedIsText = selected ? nodeKind(selected) === 'text_evidence' : false
  const sourceQuote = data.text ?? data.quote
  const rawValue = data.display_value ?? data.value ?? observation.value ?? observation.raw_value
  const unit = display(data.unit ?? observation.unit ?? calculation.unit)
  return <div className="connected-lineage">
    <div className="lineage-toolbar"><span><Icon name="layers" size={15} />Recorded lineage</span><div><button className="mini-button" aria-label="Zoom out" disabled={zoom <= 50} onClick={() => setZoom(value => value - 10)}>−</button><span>{zoom}%</span><button className="mini-button" aria-label="Zoom in" disabled={zoom >= 150} onClick={() => setZoom(value => value + 10)}>+</button></div></div>
    <p className="connected-graph-hint">Scroll to follow the connected records. Select a node for its source or formula.</p>
    <div className="connected-graph-scroll" tabIndex={0} role="region" aria-label="Scrollable calculation graph"><div style={{ width: width * zoom / 100, height: height * zoom / 100 }}><div className="connected-graph-surface" style={{ width, height, transform: `scale(${zoom / 100})` }}>
      <svg width={width} height={height} className="connected-graph-edges" aria-hidden="true"><defs><marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#8a79df" /></marker></defs>{graph.edges.map(edge => {
        const start = nodes.find(node => node.id === edge.source), end = nodes.find(node => node.id === edge.target)
        if (!start || !end) return null
        const sx = start.x + 280, sy = start.y + 48, ex = end.x, ey = end.y + 48
        return <g key={edge.id} className={edge.source === selectedId || edge.target === selectedId ? 'active' : ''}><path d={`M${sx} ${sy} C${sx + 40} ${sy} ${ex - 40} ${ey} ${ex - 4} ${ey}`} markerEnd={`url(#${markerId})`} />{edge.label && <text x={(sx + ex) / 2} y={(sy + ey) / 2 - 8} textAnchor="middle">{humanize(edge.label)}</text>}</g>
      })}</svg>
      {nodes.map(node => {
        const nodeData = record(node.data), nodeObservation = record(nodeData.observation), nodeCalculation = record(nodeData.calculation)
        const kind = nodeKind(node)
        const value = nodeData.display_value ?? nodeData.value ?? nodeObservation.value ?? nodeObservation.raw_value
        return <button key={node.id} className={`connected-graph-node ${kind === 'calculation' ? 'formula' : kind === 'source_file' ? 'source' : kind === 'text_evidence' ? 'text' : 'number'} ${node.id === selectedId ? 'selected' : ''}`} style={{ left: node.x, top: node.y }} aria-pressed={node.id === selectedId} onClick={() => setSelectedId(node.id)}>
          <span><Icon name={kind === 'calculation' ? 'calculator' : kind === 'source_file' || kind === 'text_evidence' ? 'document' : 'fileCheck'} size={14} />{humanize(kind)}</span>
          <strong>{display(nodeData.label ?? nodeData.file_name)}</strong>
          <small>{kind === 'text_evidence' ? display(nodeData.text ?? nodeData.quote) : kind === 'source_file' ? 'Original source file' : value !== undefined ? formatDecimal(typeof value === 'string' ? value : display(value), typeof nodeData.unit === 'string' ? nodeData.unit : typeof nodeObservation.unit === 'string' ? nodeObservation.unit : '') : display(nodeCalculation.status ?? nodeData.field_path)}</small>
        </button>
      })}
    </div></div></div>
    {selected && <div className="connected-node-details" aria-live="polite"><h4>{display(data.label ?? data.file_name)}</h4><dl className="source-details">
      <dt>Record</dt><dd className="hash">{selected.id}</dd>
      {selectedIsText && sourceQuote !== undefined ? <><dt>Source quote</dt><dd className="connected-node-quote">{display(sourceQuote)}</dd></> : rawValue !== undefined && <><dt>Value</dt><dd>{typeof rawValue === 'object' ? display(rawValue) : formatDecimal(rawValue === null ? null : String(rawValue), unit === 'Not supplied' ? undefined : unit)}</dd></>}
      {(data.formula ?? calculation.formula) !== undefined && <><dt>Formula</dt><dd><code>{display(data.formula ?? calculation.formula)}</code></dd><dt>Function version</dt><dd>{display(calculation.function_version)}</dd></>}
      {(source.file_name ?? data.file_name) !== undefined && <><dt>Source file</dt><dd>{display(source.file_name ?? data.file_name)}</dd></>}
      {(source.locator ?? data.locator ?? observation.locator) !== undefined && <><dt>Location</dt><dd>{formatLocator((source.locator ?? data.locator ?? observation.locator) as Record<string, unknown>)}</dd></>}
      {(source.sha256 ?? data.sha256) !== undefined && <><dt>SHA-256</dt><dd className="hash">{display(source.sha256 ?? data.sha256)}</dd></>}
    </dl></div>}
  </div>
}
