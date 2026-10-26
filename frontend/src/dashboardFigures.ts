import type { BackendMetric, CompanyReport } from './backend.ts'

const decimal = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const absentRaw = /^(?:n\.?\s*\/?a\.?|n\.?m\.?|nan|null|none|unknown|not (?:available|reported|disclosed|applicable)|[-—–])$/i
const isoDate = /^\d{4}-\d{2}-\d{2}$/

function normalized(metric: BackendMetric): boolean {
  const observation = metric.observation
  return observation.normalization_status !== 'missing' && typeof observation.value === 'string' && decimal.test(observation.value)
}

function rawAvailable(metric: BackendMetric): boolean {
  const value = metric.observation.raw_value?.trim()
  return metric.observation.normalization_status !== 'missing' && Boolean(value && !absentRaw.test(value))
}

/** Ranking is presentation only: these labels never make source definitions equivalent. */
function category(metric: BackendMetric): number {
  const key = metric.observation.metric_key.split('.').at(-1)?.toLowerCase().replace(/[-\s]+/g, '_') ?? ''
  if (/^(?:total_|operating_)?revenue$|^sales$|^arr$|^annual_recurring_revenue$/.test(key)) return 0
  if (/^cash(?:_and_cash_equivalents?)?$|^cash_balance$/.test(key)) return 1
  if (key === 'total_assets') return 2
  if (/^net_income(?:_analyst_normalized)?$|^net_profit$|^profit_after_tax$/.test(key)) return 3
  return 4
}

function periodBasis(metric: BackendMetric, grains: Map<string, string>): string {
  const observation = metric.observation
  const grain = grains.get(observation.id)
  if (grain) return `${observation.period_kind}:${grain}`
  if (observation.period_kind === 'instant' && isoDate.test(observation.period_end ?? '')) return 'instant'
  // Only compare repeated calendar windows when no backend grain was supplied.
  // Other windows retain their literal dates; an annual amount never replaces a partial period.
  const { period_start: start, period_end: end } = observation
  if (observation.period_kind === 'duration' && start && end && isoDate.test(start) && isoDate.test(end)) {
    return start.slice(0, 4) === end.slice(0, 4) ? `duration:${start.slice(5)}:${end.slice(5)}` : `duration:${start}:${end}`
  }
  return JSON.stringify([observation.period_kind, observation.period_label, start, end])
}

function identity(metric: BackendMetric, basis: string): string {
  const observation = metric.observation
  return JSON.stringify([metric.source.provider, observation.entity_key, observation.metric_key, observation.raw_label,
    observation.definition_key, observation.scope, observation.unit, observation.currency, observation.accounting_basis,
    observation.scenario, basis])
}

/**
 * Select a compact source snapshot, without calculating or assigning canonical KPIs.
 * Returned objects, decimal strings, source locators and review context are unchanged.
 * Raw-only evidence is a fallback only when this company has no normalized figures.
 */
export function selectDashboardFigures(report: CompanyReport): BackendMetric[] {
  const eligible = report.reported_metrics.filter(metric => !metric.observation.quarantined)
  const available = eligible.filter(normalized)
  const candidates = available.length ? available : eligible.filter(rawAvailable)
  const grains = new Map<string, string>()
  for (const coverage of report.data_period_coverage ?? []) for (const row of coverage.known_periods ?? []) {
    if (typeof row.observation_id === 'string' && typeof row.grain === 'string' && row.grain !== 'date_interval') grains.set(row.observation_id, row.grain)
  }
  const bases = new Map(candidates.map(metric => [metric, identity(metric, periodBasis(metric, grains))]))
  const sourceGroups = new Map<string, BackendMetric[]>()
  for (const metric of candidates) {
    const key = JSON.stringify([metric.source.snapshot_id, bases.get(metric)])
    const group = sourceGroups.get(key) ?? []
    group.push(metric); sourceGroups.set(key, group)
  }
  const latest = [...sourceGroups.values()].flatMap(group => {
    const dates = group.map(metric => metric.observation.period_end).filter((date): date is string => Boolean(date && isoDate.test(date)))
    if (!dates.length) return group
    const end = dates.sort().at(-1)
    return group.filter(metric => metric.observation.period_end === end || !metric.observation.period_end)
  })
  // Equal-context snapshots for the same period are alternatives, not a choice by amount.
  const packs = new Map<string, BackendMetric[]>()
  for (const metric of latest) {
    const observation = metric.observation
    const exactEnd = isoDate.test(observation.period_end ?? '')
    const key = JSON.stringify([bases.get(metric), exactEnd ? null : observation.period_label, observation.period_start, observation.period_end])
    const pack = packs.get(key) ?? []
    pack.push(metric); packs.set(key, pack)
  }
  const byId = new Map(candidates.map(metric => [metric.observation.id, metric]))
  const ranked = [...packs.values()].sort((left, right) => {
    const a = left[0], b = right[0]
    const confirmed = (metric: BackendMetric) => metric.observation.normalization_status === 'confirmed' ? 0 : 1
    const dated = (metric: BackendMetric) => isoDate.test(metric.observation.period_end ?? '') ? 0 : 1
    return confirmed(a) - confirmed(b) || category(a) - category(b) || dated(a) - dated(b)
      || report.reported_metrics.indexOf(a) - report.reported_metrics.indexOf(b)
  })
  const selected: BackendMetric[] = []
  const usedBases = new Set<string>(), usedCategories = new Set<number>()
  function add(pack: BackendMetric[], diversify: boolean): void {
    const first = pack[0], basis = bases.get(first)!
    if (usedBases.has(basis) || diversify && usedCategories.has(category(first))) return
    const alternatives = new Map(pack.map(metric => [metric.observation.id, metric]))
    // Preserve explicitly flagged comparable conflicts even across different source contexts.
    let priorSize = -1
    while (priorSize !== alternatives.size) {
      priorSize = alternatives.size
      for (const conflict of report.conflicts ?? []) {
        if (!['value_conflict', 'aggregate_value_conflict'].includes(String(conflict.kind)) || !Array.isArray(conflict.observation_ids)) continue
        if (conflict.observation_ids.some(id => typeof id === 'string' && alternatives.has(id))) {
          for (const id of conflict.observation_ids) if (typeof id === 'string' && byId.has(id)) alternatives.set(id, byId.get(id)!)
        }
      }
    }
    const additions = [...alternatives.values()].filter(metric => !selected.includes(metric))
    // Do not truncate a conflicting set and present one side as a unique figure.
    if (selected.length + additions.length > 4) return
    selected.push(...additions)
    for (const metric of alternatives.values()) usedBases.add(bases.get(metric)!)
    usedCategories.add(category(first))
  }
  for (const pack of ranked) add(pack, true)
  for (const pack of ranked) add(pack, false)
  return selected
}
