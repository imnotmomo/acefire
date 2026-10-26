import { useEffect, useRef, useState } from 'react'
import type { BackendMetric, BackendObservation } from './backend'
import { apiFetch, formatLocator } from './backend'
import { Dialog, Icon } from './ui'
import './normalization-review.css'

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : object(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value)
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const definitions = ['active_mrr', 'recognized_revenue', 'cash_operating_outflow', 'cash_operating_inflow', 'unrestricted_cash', 'monthly_net_burn', 'arr', 'runway_months']

export default function NormalizationReview({ item, onClose, onSaved }: { item: BackendMetric; onClose: () => void; onSaved: (observation: BackendObservation) => void }) {
  const original = item.observation
  const [metric, setMetric] = useState(original.metric_key), [unit, setUnit] = useState(original.unit ?? '')
  const [currency, setCurrency] = useState(original.currency ?? ''), [scale, setScale] = useState(original.scale_multiplier ?? '')
  const [basis, setBasis] = useState(''), [periodKind, setPeriodKind] = useState(original.period_kind)
  const [start, setStart] = useState(original.period_start ?? ''), [end, setEnd] = useState(original.period_end ?? '')
  const [periodLabel, setPeriodLabel] = useState(original.period_label ?? ''), [scenario, setScenario] = useState(original.scenario)
  const [scope, setScope] = useState(original.scope ?? ''), [accounting, setAccounting] = useState(original.accounting_basis ?? '')
  const [definition, setDefinition] = useState(original.definition_key ?? '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { request.current?.abort(); if (timer.current) clearTimeout(timer.current) }, [])
  function close() { request.current?.abort(); onClose() }
  function stopWaiting() {
    request.current?.abort(); request.current = null
    if (timer.current) clearTimeout(timer.current)
    setBusy(false); setError('Stopped waiting for the review to save. Your entered metadata is preserved. Refresh the company before retrying; the server may have saved it.')
  }
  async function save() {
    if (request.current) return
    if (!decimal.test(scale.trim()) || /^[+-]?0*(?:\.0*)?(?:[eE][+-]?\d+)?$/.test(scale.trim()) || scale.trim().startsWith('-')) { setError('Enter a positive exact scale, such as 1, 1000, or 0.01.'); return }
    if (periodKind !== 'unknown' && (!end || periodKind === 'duration' && (!start || start > end))) { setError('Supply the exact period dates. A duration needs a start on or before its end.'); return }
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('')
    timer.current = setTimeout(() => {
      if (request.current !== controller) return
      stopWaiting()
    }, 30000)
    try {
      const response = await apiFetch(`/deals/${encodeURIComponent(original.deal_id)}/observations/${encodeURIComponent(original.id)}/normalize`, {
        method: 'POST', signal: controller.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric_key: metric.trim(), unit: unit.trim(), currency: currency.trim() || null,
          scale_multiplier: scale.trim(), normalization_basis: basis.trim(), period_kind: periodKind,
          period_start: periodKind === 'duration' ? start : null, period_end: periodKind === 'unknown' ? null : end,
          period_label: periodLabel.trim() || null, scenario, scope: scope.trim() || null,
          accounting_basis: accounting.trim() || null, definition_key: definition || null }),
      })
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The review API did not return JSON. Check the backend connection.')
      const payload: unknown = await response.json()
      if (!response.ok) {
        const detail = object(payload) ? payload.detail : undefined
        const message = typeof detail === 'string' ? detail : object(detail) && typeof detail.message === 'string' ? detail.message : Array.isArray(detail) ? detail.map(value => object(value) && typeof value.msg === 'string' ? value.msg : '').filter(Boolean).join(' · ') : `Review save returned HTTP ${response.status}.`
        throw new Error(message.slice(0, 600))
      }
      const row = object(payload) && object(payload.observation) ? payload.observation : null
      if (!row || typeof row.id !== 'string' || row.id === original.id || row.deal_id !== original.deal_id || row.snapshot_id !== original.snapshot_id || row.provider !== original.provider || row.reviewed_from_id !== original.id || row.raw_value !== original.raw_value || canonical(row.locator) !== canonical(original.locator) || row.normalization_status !== 'confirmed' || typeof row.value !== 'string' || !decimal.test(row.value) || row.verification_status !== 'needs_review') throw new Error('The saved review did not match the original source. Refresh the company before using it.')
      if (!controller.signal.aborted) onSaved(row as unknown as BackendObservation)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The normalization review could not be saved. Your entries are preserved.')
    } finally {
      if (request.current === controller) {
        request.current = null; setBusy(false)
        if (timer.current) clearTimeout(timer.current)
      }
    }
  }
  return <Dialog title="Review numeric input" subtitle="Supply the context needed for exact arithmetic. This creates a separate input and keeps the original evidence." onClose={close} className="normalization-review-dialog">
    <form className="dialog-body normalization-review" onSubmit={event => { event.preventDefault(); void save() }} aria-busy={busy}>
      <section className="normalization-original" aria-label="Original source value"><span className="section-kicker">Original evidence · read only</span><strong>{original.raw_label}</strong><code>{original.raw_value ?? 'Missing raw value'}</code><span>{item.source.file_name} · {formatLocator(original.locator)}</span>{typeof original.locator.quote === 'string' && <blockquote>{original.locator.quote}</blockquote>}<details><summary>Source fingerprint and location</summary><dl><dt>SHA-256</dt><dd>{item.source.sha256}</dd><dt>Observation</dt><dd>{original.id}</dd><dt>Locator</dt><dd>{JSON.stringify(original.locator, null, 2)}</dd></dl></details></section>
      <div className="field-pair"><label>Metric key<input required maxLength={256} value={metric} disabled={busy} onChange={event => setMetric(event.target.value)} /></label><label>Unit<input required maxLength={100} value={unit} disabled={busy} placeholder="USD, count, ratio…" onChange={event => setUnit(event.target.value)} /></label></div>
      <div className="field-pair"><label>Currency (if monetary)<input maxLength={3} pattern="[A-Z]{3}" value={currency} disabled={busy} placeholder="USD" onChange={event => setCurrency(event.target.value.toUpperCase())} /></label><label>Exact scale multiplier<input required inputMode="decimal" maxLength={100} value={scale} disabled={busy} placeholder="1, 1000, 0.01…" onChange={event => setScale(event.target.value)} /></label></div>
      <p className="normalization-hint">Normalized value = original raw decimal × this scale. Unit, scale and dates are your explicit review; none are inferred from labels.</p>
      <label>Normalization basis<textarea required rows={3} maxLength={4096} value={basis} disabled={busy} placeholder="Explain where you checked the unit and scale, such as a table header or source note." onChange={event => setBasis(event.target.value)} /></label>
      <div className="field-pair"><label>Period type<select value={periodKind} disabled={busy} onChange={event => setPeriodKind(event.target.value)}><option value="unknown">Exact period unknown</option><option value="instant">Closing balance / point in time</option><option value="duration">Duration / reporting window</option></select></label><label>Actual or forecast<select value={scenario} disabled={busy} onChange={event => setScenario(event.target.value)}><option value="unknown">Unknown</option><option value="actual">Actual</option><option value="forecast">Forecast</option></select></label></div>
      {periodKind !== 'unknown' && <div className="field-pair">{periodKind === 'duration' && <label>Period start<input type="date" required value={start} disabled={busy} onChange={event => setStart(event.target.value)} /></label>}<label>{periodKind === 'instant' ? 'As-of date' : 'Period end'}<input type="date" required value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></label></div>}
      <label>Period label (optional)<input maxLength={1000} value={periodLabel} disabled={busy} placeholder="For example: January–March 2025; exact dates stay above" onChange={event => setPeriodLabel(event.target.value)} /></label>
      <details className="normalization-context"><summary>Additional comparison context</summary><div className="field-pair"><label>Company scope<input maxLength={1000} value={scope} disabled={busy} placeholder="Only if established by the source" onChange={event => setScope(event.target.value)} /></label><label>Accounting basis<input maxLength={1000} value={accounting} disabled={busy} placeholder="Only if established by the source" onChange={event => setAccounting(event.target.value)} /></label></div><label>Reviewed metric definition<select value={definition} disabled={busy} onChange={event => setDefinition(event.target.value)}><option value="">Unreviewed / not assigned</option>{definitions.map(value => <option key={value} value={value}>{value}</option>)}</select></label><p className="normalization-hint">Choose a definition only after checking its meaning. Unknown comparison context stays unknown.</p></details>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="preview-note">The new input remains Verify. It does not certify the source fact, replace an existing calculation, or treat missing data as zero.</p>
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={busy ? stopWaiting : close}>{busy ? 'Stop waiting' : 'Cancel'}</button><button type="submit" className="button primary" disabled={busy || !metric.trim() || !unit.trim() || !scale.trim() || !basis.trim() || original.raw_value === null || original.quarantined}><Icon name={busy ? 'loading' : 'check'} size={15} />{busy ? 'Saving input…' : 'Save reviewed input'}</button></div>
    </form>
  </Dialog>
}
