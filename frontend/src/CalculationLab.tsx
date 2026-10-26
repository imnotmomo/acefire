import { useEffect, useMemo, useRef, useState } from 'react'
import type { BackendCalculation, BackendMetric, BackendObservation, CompanyReport } from './backend'
import { apiFetch, formatDecimal, formatLocator, humanize } from './backend'
import { calculationTextEvidence } from './calculationEvidence'
import { parseCalculationParameters } from './calculationParameters'
import { Badge, Icon } from './ui'
import NormalizationReview from './NormalizationReview'
import './calculation-lab.css'

type RuntimeStatus = { mode: 'llm_local'; configured: boolean; model: string; generation_provider: string; executor: string; missing: string[]; maximum_inputs: number }
type JsonRecord = Record<string, unknown>
const object = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const period = (item: CompanyReport['reported_metrics'][number]) => {
  const value = item.observation
  const dates = value.period_start && value.period_end ? `${value.period_start} – ${value.period_end}` : value.period_end ? `As of ${value.period_end}` : 'Exact dates unknown'
  return value.period_label ? `${value.period_label} · ${dates}` : dates
}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
type WorkingCalculation = { question: string; parameterText: string; selectedIds: string[]; premiseIds: string[] }
const workingKey = (companyId: string) => `acefire:calculation-workspace:v1:${encodeURIComponent(companyId)}`
function savedWorkingCalculation(companyId: string): WorkingCalculation {
  const empty = { question: '', parameterText: '{}', selectedIds: [], premiseIds: [] }
  try {
    const text = localStorage.getItem(workingKey(companyId))
    if (!text || text.length > 100000) return empty
    const value: unknown = JSON.parse(text)
    if (!object(value) || value.companyId !== companyId) return empty
    return { question: typeof value.question === 'string' ? value.question.slice(0, 4000) : '',
      parameterText: typeof value.parameterText === 'string' ? value.parameterText.slice(0, 50000) : '{}',
      selectedIds: [...new Set(strings(value.selectedIds))].slice(0, 100), premiseIds: [...new Set(strings(value.premiseIds))].slice(0, 30) }
  } catch { return empty }
}
function runtimeStatus(value: unknown): RuntimeStatus {
  if (!object(value) || value.mode !== 'llm_local' || typeof value.configured !== 'boolean' || typeof value.model !== 'string' || typeof value.executor !== 'string' || !Array.isArray(value.missing)) throw new Error('The calculation service returned an unsupported configuration.')
  return { mode: 'llm_local', configured: value.configured, model: value.model, generation_provider: typeof value.generation_provider === 'string' ? value.generation_provider : 'nicrron', executor: value.executor, missing: strings(value.missing), maximum_inputs: typeof value.maximum_inputs === 'number' && Number.isInteger(value.maximum_inputs) && value.maximum_inputs > 0 ? Math.min(value.maximum_inputs, 100) : 100 }
}
async function responseJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The calculation API did not return JSON. Check the backend connection.')
  const payload: unknown = await response.json()
  if (!response.ok) {
    const detail = object(payload) ? payload.detail : undefined
    const message = typeof detail === 'string' ? detail : object(detail) && typeof detail.message === 'string' ? detail.message : `Calculation service returned HTTP ${response.status}. Try again when it is available.`
    throw new Error(message.slice(0, 500))
  }
  return payload
}

export default function CalculationLab({ report, onComplete, onRefresh = onComplete }: { report: CompanyReport; onComplete: () => void; onRefresh?: () => void }) {
  const companyId = report.company.deal_id
  const initialWorking = useMemo(() => savedWorkingCalculation(companyId), [companyId])
  const [loadedCompany, setLoadedCompany] = useState(companyId)
  const [formSaved, setFormSaved] = useState(true)
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState('')
  const [configAttempt, setConfigAttempt] = useState(0)
  const [question, setQuestion] = useState(initialWorking.question)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('all')
  const [visibleRows, setVisibleRows] = useState(20)
  const [selectedIds, setSelectedIds] = useState<string[]>(initialWorking.selectedIds)
  const [premiseQuery, setPremiseQuery] = useState('')
  const [visiblePremises, setVisiblePremises] = useState(8)
  const [premiseIds, setPremiseIds] = useState<string[]>(initialWorking.premiseIds)
  const [parameterText, setParameterText] = useState(initialWorking.parameterText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorStep, setErrorStep] = useState<'question' | 'inputs' | 'config' | 'parameters' | 'request'>('request')
  const [result, setResult] = useState<BackendCalculation | null>(null)
  const [reviewing, setReviewing] = useState<BackendMetric | null>(null)
  const [reviewedRows, setReviewedRows] = useState<BackendMetric[]>([])
  const [normalizationNotice, setNormalizationNotice] = useState('')
  const runController = useRef<AbortController | null>(null)
  const runTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRequest = useRef(false)
  const questionField = useRef<HTMLTextAreaElement>(null)
  const inputHeading = useRef<HTMLHeadingElement>(null)
  const runtimePanel = useRef<HTMLDivElement>(null)
  const parameterField = useRef<HTMLTextAreaElement>(null)
  const metrics = useMemo(() => [...report.reported_metrics, ...reviewedRows.filter(item => !report.reported_metrics.some(existing => existing.observation.id === item.observation.id))], [report, reviewedRows])
  const providers = useMemo(() => [...new Set(metrics.map(item => item.source.provider))], [metrics])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const availableIds = useMemo(() => new Set(metrics.map(item => item.observation.id)), [metrics])
  const textEvidence = useMemo(() => calculationTextEvidence(report), [report])
  const selectedPremises = useMemo(() => new Set(premiseIds), [premiseIds])
  const availablePremiseIds = useMemo(() => new Set(textEvidence.map(item => item.id)), [textEvidence])
  const filteredPremises = useMemo(() => textEvidence.filter(item => `${item.text} ${item.fieldPath} ${item.source.file_name}`.toLowerCase().includes(premiseQuery.toLowerCase())), [textEvidence, premiseQuery])
  const filtered = useMemo(() => metrics.filter(item => (provider === 'all' || item.source.provider === provider) && `${item.observation.raw_label} ${item.observation.metric_key} ${item.source.file_name} ${period(item)}`.toLowerCase().includes(query.toLowerCase())), [metrics, query, provider])
  const maximumInputs = runtime?.maximum_inputs ?? 100
  const resultExecution = result && object(result.parameters.agent_execution) ? result.parameters.agent_execution : null
  const usableSelected = metrics.filter(item => selected.has(item.observation.id) && item.observation.normalization_status === 'confirmed' && item.observation.value !== null && !item.observation.quarantined).length
  const readiness = !question.trim() ? 'Next: describe what to calculate.' : !selectedIds.length ? 'Next: select at least one source input.' : !usableSelected ? 'Next: review numeric context for a selected raw input.' : selectedIds.length > maximumInputs ? `Next: reduce your selection to ${maximumInputs} inputs.` : configLoading ? 'Checking the calculation service…' : !runtime?.configured ? 'Next: review the calculation service configuration.' : `Ready to generate · ${selectedIds.length} inputs, ${usableSelected} with confirmed numbers.`

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort(); setRuntime(null); setConfigLoading(false); setConfigError('The calculation service took too long to respond. Refresh configuration to retry.') }, 20000)
    setConfigLoading(true); setConfigError('')
    apiFetch('/calculation-runtime', { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(responseJson).then(runtimeStatus).then(value => { if (!controller.signal.aborted) setRuntime(value) })
      .catch(reason => { if (!controller.signal.aborted) { setRuntime(null); setConfigError(reason instanceof Error ? reason.message : 'The calculation service could not be reached.') } })
      .finally(() => { clearTimeout(timeout); if (!controller.signal.aborted) setConfigLoading(false) })
    return () => { clearTimeout(timeout); controller.abort() }
  }, [companyId, configAttempt])
  useEffect(() => {
    setReviewedRows([]); setReviewing(null); setNormalizationNotice(''); setBusy(false); setResult(null)
    const restored = savedWorkingCalculation(companyId)
    setSelectedIds(restored.selectedIds); setPremiseIds(restored.premiseIds); setQuestion(restored.question); setParameterText(restored.parameterText); setError(''); setLoadedCompany(companyId)
    return () => { runController.current?.abort(); runController.current = null; activeRequest.current = false; if (runTimer.current) clearTimeout(runTimer.current) }
  }, [companyId])
  useEffect(() => { if (loadedCompany === companyId) setSelectedIds(previous => previous.filter(id => availableIds.has(id))) }, [availableIds, companyId, loadedCompany])
  useEffect(() => { if (loadedCompany === companyId) setPremiseIds(previous => previous.filter(id => availablePremiseIds.has(id))) }, [availablePremiseIds, companyId, loadedCompany])
  useEffect(() => {
    if (loadedCompany !== companyId) return
    try {
      const text = JSON.stringify({ companyId, question, parameterText, selectedIds, premiseIds })
      if (text.length > 100000) { setFormSaved(false); return }
      localStorage.setItem(workingKey(companyId), text); setFormSaved(true)
    } catch { setFormSaved(false) }
  }, [companyId, loadedCompany, question, parameterText, selectedIds, premiseIds])

  function toggle(id: string) {
    if (busy) return
    if (!selected.has(id) && selectedIds.length >= maximumInputs) { setError(`Select up to ${maximumInputs} source observations for one calculation.`); return }
    setSelectedIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]); setError('')
  }
  function togglePremise(id: string) {
    if (busy) return
    if (!selectedPremises.has(id) && premiseIds.length >= 30) { setError('Select up to 30 source-text fields for one calculation.'); return }
    setPremiseIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]); setError('')
  }
  function reviewedInput(observation: BackendObservation) {
    if (!reviewing) return
    setReviewedRows(previous => [...previous.filter(item => item.observation.id !== observation.id), {
      observation, source: { ...reviewing.source, locator: observation.locator },
      context: { review_required: true, review_reasons: ['normalization_metadata_user_supplied', 'source_location_unverified'] },
    }])
    if (selectedIds.length < maximumInputs) setSelectedIds(previous => previous.includes(observation.id) ? previous : [...previous, observation.id])
    setNormalizationNotice(`Reviewed input saved${selectedIds.length < maximumInputs ? ' and added to the selection' : '; clear a selection to add it'}. The original input and all previous calculations are retained.`)
    setReviewing(null); setError(''); onRefresh()
  }
  function stopWaiting(message = 'Stopped waiting for this calculation. Your question and inputs are preserved. The server may still finish and save the result; refresh stored calculations before retrying.') {
    runController.current?.abort(); runController.current = null; activeRequest.current = false
    if (runTimer.current) clearTimeout(runTimer.current)
    setBusy(false); setErrorStep('request'); setError(message)
  }
  function explainMissing(message: string, step: 'question' | 'inputs' | 'config' | 'parameters') {
    setErrorStep(step); setError(message)
    const target = step === 'question' ? questionField.current : step === 'inputs' ? inputHeading.current : step === 'config' ? runtimePanel.current : parameterField.current
    if (step === 'parameters') { const details = target?.closest('details'); if (details) details.open = true }
    target?.focus({ preventScroll: true }); target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  async function calculate() {
    if (activeRequest.current || busy) return
    if (!question.trim()) { explainMissing('Describe the calculation in the question field first. For example, ask for the total over the selected reporting period.', 'question'); return }
    if (!selectedIds.length) { explainMissing('Select at least one source observation using its checkbox. Review its numeric context if the value is unresolved.', 'inputs'); return }
    if (!usableSelected) { explainMissing('The selected inputs have no confirmed numeric values. Choose Review numeric context for a raw input and supply its unit, scale and period, or select another normalized observation.', 'inputs'); return }
    if (selectedIds.length > maximumInputs) { explainMissing(`Select no more than ${maximumInputs} inputs for one calculation. Clear some selected observations before retrying.`, 'inputs'); return }
    if (configLoading) { explainMissing('The calculation service is still being checked. Wait for its status, then generate again.', 'config'); return }
    if (!runtime?.configured) { explainMissing(configError || `The calculation service is not ready. ${runtime?.missing.length ? `Backend configuration missing: ${runtime.missing.join(', ')}. ` : ''}Refresh configuration after the service is available.`, 'config'); return }
    let parameters: Record<string, unknown>
    try { parameters = parseCalculationParameters(parameterText) }
    catch (reason) { explainMissing(reason instanceof Error ? reason.message : 'Calculation parameters are invalid.', 'parameters'); return }
    const controller = new AbortController(); runController.current = controller; activeRequest.current = true
    runTimer.current = setTimeout(() => { if (runController.current === controller) stopWaiting('This calculation took too long. Your question and inputs are preserved. The server may still save a result; refresh stored calculations before retrying.') }, 210000)
    setBusy(true); setErrorStep('request'); setError(''); setResult(null)
    try {
      const response = await apiFetch(`/deals/${encodeURIComponent(companyId)}/calculate/agent`, { method: 'POST', signal: controller.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ question: question.trim(), input_ids: selectedIds, premise_ids: premiseIds, parameters }) })
      const payload = await responseJson(response)
      const value = object(payload) && object(payload.calculation) ? payload.calculation : payload
      if (!object(value) || typeof value.id !== 'string' || value.deal_id !== companyId || typeof value.status !== 'string' || !['succeeded', 'insufficient_data', 'not_applicable'].includes(value.status) || !(value.value === null || typeof value.value === 'string' && /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.value)) || !object(value.parameters)) throw new Error('The calculation service returned an unsupported result. Refresh the stored report before retrying.')
      if (!controller.signal.aborted) { setResult(value as unknown as BackendCalculation); onComplete() }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The calculation could not be completed. Your question and selected inputs are preserved.')
    } finally {
      if (runController.current === controller) {
        activeRequest.current = false; runController.current = null
        if (runTimer.current) clearTimeout(runTimer.current)
        if (!controller.signal.aborted) setBusy(false)
      }
    }
  }

  return <section className="calculation-lab" aria-label="Calculation workspace" aria-busy={busy}>
    <div className="calculation-lab-heading"><div><span className="section-kicker">Ask the data</span><h2>A calculation, with its working.</h2><p>Choose source observations. Describe the calculation. Review the generated Python and its result.</p></div><Badge tone="blue">LLM + local Python</Badge></div>
    <div className="calculation-runtime" role="status" ref={runtimePanel} tabIndex={-1}><Icon name={configLoading || busy ? 'loading' : runtime?.configured ? 'check' : 'clock'} size={17} /><div><strong>{busy ? 'Generating and executing calculation…' : configLoading ? 'Checking calculation service…' : runtime?.configured ? 'Calculation service ready' : 'Calculation service pending'}</strong><span>{runtime ? `${runtime.model} · Local Python worker` : 'Model generation and execution are provided by the backend.'}</span>{!configLoading && runtime && !runtime.configured && <small>Backend configuration missing: {runtime.missing.join(', ') || 'provider configuration'}. Add it in the backend environment, then refresh.</small>}{configError && <small className="calculation-runtime-error">{configError}</small>}</div><button className="button secondary" disabled={configLoading || busy} onClick={() => { setConfigAttempt(value => value + 1); if (errorStep === 'config') setError('') }}>Refresh configuration<Icon name="history" size={13} /></button></div>
    {error && errorStep === 'config' && <div className="calculation-error" role="alert">{error}</div>}
    <div className="calculation-question"><label htmlFor="calculation-question">What should be calculated?</label><textarea ref={questionField} id="calculation-question" aria-label="Calculation question" rows={3} maxLength={4000} value={question} disabled={busy} onChange={event => { setQuestion(event.target.value); if (errorStep === 'question') setError('') }} placeholder="For example: use the selected source values to explain this period’s revenue total. Keep gaps and assumptions visible." /><small>The model uses the selected source records. Missing inputs remain unknown; the backend records the code and execution evidence.</small></div>
    {error && errorStep === 'question' && <div className="calculation-error" role="alert">{error}</div>}
    <div className="calculation-input-heading"><div><h3 ref={inputHeading} tabIndex={-1} id="calculation-input-heading">Source inputs <Badge>{selectedIds.length} selected</Badge></h3><p>Select the exact observations to make available to the calculation.</p></div>{selectedIds.length > 0 && <button className="text-button" disabled={busy} onClick={() => setSelectedIds([])}>Clear selection</button>}</div>
    {error && errorStep === 'inputs' && <div className="calculation-error" role="alert">{error}</div>}
    <div className="calculation-input-filters"><label className="search-field compact"><Icon name="search" size={15} /><input aria-label="Search calculation inputs" placeholder="Find a metric, file or period…" value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setVisibleRows(20) }} /></label><label>Source<select aria-label="Filter calculation inputs by source" value={provider} disabled={busy} onChange={event => { setProvider(event.target.value); setVisibleRows(20) }}><option value="all">All sources</option>{providers.map(value => <option key={value} value={value}>{humanize(value)}</option>)}</select></label></div>
    {normalizationNotice && <p className="calculation-normalization-saved" role="status">{normalizationNotice}</p>}
    {selectedIds.length > 0 && <div className="calculation-selected" aria-label="Selected calculation inputs">{metrics.filter(item => selected.has(item.observation.id)).map(item => <button key={item.observation.id} disabled={busy} onClick={() => toggle(item.observation.id)} aria-label={`Remove ${item.observation.raw_label} from calculation`}><span>{item.observation.raw_label} · {item.observation.period_label || item.observation.period_end || 'Period unknown'}</span><Icon name="x" size={12} /></button>)}</div>}
    <div className="calculation-input-list"><div className="table-scroll"><table className="source-table"><thead><tr><th><span className="sr-only">Select</span></th><th>Observation</th><th>Exact value / period</th><th>Source location</th></tr></thead><tbody>{filtered.slice(0, visibleRows).map(item => <tr key={item.observation.id} className={selected.has(item.observation.id) ? 'selected' : ''}><td><input type="checkbox" checked={selected.has(item.observation.id)} disabled={busy || !selected.has(item.observation.id) && selectedIds.length >= maximumInputs} onChange={() => toggle(item.observation.id)} aria-label={`Use ${item.observation.raw_label} ${item.observation.period_label || item.observation.period_end || item.observation.id} from ${item.source.file_name} ${formatLocator(item.source.locator)}`} /></td><td><strong>{item.observation.raw_label || humanize(item.observation.metric_key)}</strong><small>{item.observation.scope || 'Scope unknown'} · {humanize(item.observation.scenario)}</small>{item.observation.reviewed_from_id && <small>Explicit normalization review · original retained</small>}</td><td><span>{formatDecimal(item.observation.value, item.observation.unit)}</span>{item.observation.value === null && item.observation.raw_value !== null && <small>Raw: {item.observation.raw_value}</small>}<small>{period(item)}</small><Badge tone={item.observation.normalization_status === 'confirmed' ? 'blue' : 'amber'}>{item.observation.normalization_status === 'confirmed' ? 'Normalized · Verify' : humanize(item.observation.normalization_status)}</Badge>{item.observation.raw_value !== null && !item.observation.quarantined && <button className="text-button calculation-review-button" disabled={busy} onClick={() => setReviewing(item)} aria-label={`Review numeric context for ${item.observation.raw_label} ${item.observation.id}`}><Icon name="pencil" size={12} />Review numeric context</button>}</td><td><span>{item.source.file_name}</span><small>{formatLocator(item.source.locator)}</small></td></tr>)}</tbody></table></div>{!filtered.length && <p className="calculation-no-inputs">No matching observations. Try another metric, period or file.</p>}</div>
    <div className="calculation-input-footer"><span>Showing {Math.min(visibleRows, filtered.length)} of {filtered.length} observations · up to {maximumInputs} inputs per run</span>{visibleRows < filtered.length && <button className="text-button" disabled={busy} onClick={() => setVisibleRows(value => value + 20)}>Show more inputs<Icon name="down" size={13} /></button>}</div>
    <details className="calculation-premises" aria-label="Optional calculation text context"><summary>Optional source-text context for this calculation</summary><section aria-label="Sentence evidence and premises"><div className="calculation-input-heading"><div><h3>Calculation context <Badge>{premiseIds.length} selected</Badge></h3><p>Company summaries and report claims use source sentences in Report Builder. Here, text is optional context for a numeric calculation.</p></div>{premiseIds.length > 0 && <button className="text-button" disabled={busy} onClick={() => setPremiseIds([])}>Clear text selection</button>}</div><label className="search-field compact"><Icon name="search" size={15} /><input aria-label="Search sentence evidence" placeholder="Find a description, phrase or source field…" value={premiseQuery} disabled={busy} onChange={event => { setPremiseQuery(event.target.value); setVisiblePremises(8) }} /></label>{premiseIds.length > 0 && <div className="calculation-selected calculation-selected-premises" aria-label="Selected sentence evidence">{textEvidence.filter(item => selectedPremises.has(item.id)).map(item => <button key={item.id} disabled={busy} onClick={() => togglePremise(item.id)} aria-label={`Remove premise ${item.fieldPath}`}><span>{humanize(item.fieldPath.split('/').filter(Boolean).join(' / '))}</span><Icon name="x" size={12} /></button>)}</div>}<div className="calculation-premise-list">{filteredPremises.slice(0, visiblePremises).map(item => <label className={`calculation-premise-card ${selectedPremises.has(item.id) ? 'selected' : ''}`} key={item.id}><input type="checkbox" checked={selectedPremises.has(item.id)} disabled={busy || !selectedPremises.has(item.id) && premiseIds.length >= 30} onChange={() => togglePremise(item.id)} aria-label={`Use premise ${item.fieldPath} from ${item.source.file_name}`} /><span><strong>{humanize(item.fieldPath.split('/').filter(Boolean).join(' / '))}</strong><blockquote>{item.text}</blockquote><small>{item.source.file_name}</small><small>{formatLocator(item.source.locator)}</small></span></label>)}{!filteredPremises.length && <p className="calculation-no-inputs">{textEvidence.length ? 'No matching source text. Try another phrase or field.' : 'No stored source-text fields are available for this company.'}</p>}</div><div className="calculation-input-footer"><span>Showing {Math.min(visiblePremises, filteredPremises.length)} of {filteredPremises.length} source-text fields · up to 30 per run</span>{visiblePremises < filteredPremises.length && <button className="text-button" disabled={busy} onClick={() => setVisiblePremises(value => value + 8)}>Show more source text<Icon name="down" size={13} /></button>}</div><p className="calculation-premise-note">Quoted source text and the model’s interpretation are recorded separately. Existing files are used; this does not retrieve or extract new material.</p></section></details>
    <details className="calculation-parameters"><summary>Optional calculation parameters</summary><label htmlFor="calculation-parameters">Parameters as JSON</label><textarea ref={parameterField} id="calculation-parameters" aria-label="Calculation parameters JSON" maxLength={50000} rows={4} value={parameterText} disabled={busy} onChange={event => { setParameterText(event.target.value); if (errorStep === 'parameters') setError('') }} spellCheck={false} />{error && errorStep === 'parameters' && <div className="calculation-error" role="alert">{error}</div>}<p>Use named dates or assumptions when needed. Financial amounts should be decimal strings, such as <code>"1000.00"</code>. These parameters are saved with the calculation.</p></details>
    {error && errorStep === 'request' && <div className="calculation-error" role="alert"><Icon name="help" size={17} /><span>{error}</span></div>}
    {result && <div className="calculation-result" role="status"><Badge tone={result.status === 'succeeded' ? 'blue' : 'amber'}>{result.status === 'succeeded' ? 'Model-generated result · review context' : humanize(result.status)}</Badge><strong>{formatDecimal(result.value, result.unit)}</strong>{resultExecution && typeof resultExecution.explanation === 'string' && <p>{resultExecution.explanation}</p>}{strings(result.reasons).map(reason => <p key={reason}>{humanize(reason)}</p>)}{resultExecution && strings(resultExecution.limitations).length > 0 && <ul>{strings(resultExecution.limitations).map((item, index) => <li key={index}>{item}</li>)}</ul>}<small>Calculation saved. Open it in stored calculations to inspect its code, inputs and source files.</small></div>}
    <p id="calculation-readiness" className="calculation-normalization-saved" role="status">{readiness}<br /><small>{formSaved ? 'Your question, parameters and selections are kept in this browser for this company.' : 'This browser cannot keep the calculation form. Copy your question and parameters before leaving.'}</small></p>
    <div className="calculation-submit"><div><Icon name="link" size={18} /><span>{busy ? 'Generating Python and executing it with the selected source records…' : 'Generated code, exact source bindings and execution output stay with the result.'}{busy && <small>Leaving this page stops waiting; the backend may still finish the current run.</small>}</span></div><div className="calculation-submit-actions">{busy ? <button className="button secondary" onClick={() => stopWaiting()}>Stop waiting</button> : <button className="button secondary" onClick={onRefresh}>Refresh stored calculations</button>}<button className="button primary" disabled={busy} aria-describedby="calculation-readiness" onClick={calculate}><Icon name={busy ? 'loading' : 'calculator'} size={17} />{busy ? 'Calculating…' : 'Generate and run calculation'}</button></div></div>
    {reviewing && <NormalizationReview key={reviewing.observation.id} item={reviewing} onClose={() => setReviewing(null)} onSaved={reviewedInput} />}
  </section>
}
