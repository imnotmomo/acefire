import test from 'node:test'
import assert from 'node:assert/strict'
import { selectDashboardFigures } from '../src/dashboardFigures.ts'

function metric(id, overrides = {}, source = {}) {
  return {
    observation: { id, deal_id: 'company', snapshot_id: 'source', metric_key: 'vendor.operating_revenue', raw_label: 'Operating revenue', raw_value: '1000.0010', value: '1000000.0010', unit: 'USD', currency: 'USD', scale_multiplier: '1000', normalization_status: 'confirmed', normalization_basis: 'source header', definition_key: null, scope: 'consolidated', accounting_basis: 'US GAAP', period_kind: 'duration', period_label: 'FY 2025', period_start: '2025-01-01', period_end: '2025-12-31', scenario: 'unknown', verification_status: 'needs_review', locator: { kind: 'xlsx_cell', cell: 'B2' }, quarantined: false, notes: [], provider: 'vendor', ...overrides },
    source: { snapshot_id: 'source', file_name: 'company.xlsx', sha256: 'a'.repeat(64), provider: 'vendor', locator: { kind: 'xlsx_cell', cell: 'B2' }, ...source },
    context: { review_required: true, review_reasons: ['scenario_unknown', 'definition_not_reviewed'] },
  }
}
function report(metrics, extra = {}) { return { reported_metrics: metrics, data_period_coverage: [], conflicts: [], ...extra } }

test('dashboard selects diverse reported figures, keeps decimals and exact source context unchanged', () => {
  const rows = [metric('old', { period_label: 'FY 2024', period_start: '2024-01-01', period_end: '2024-12-31' }), metric('ratio', { metric_key: 'vendor.revenue_growth_percent', raw_label: 'Revenue growth (%)', unit: 'ratio' }), metric('revenue'), metric('cash', { metric_key: 'vendor.cash_and_cash_equivalents', raw_label: 'Cash and cash equivalent', period_kind: 'instant', period_start: null, value: '9007199254740993.0123456789' }), metric('assets', { metric_key: 'vendor.total_assets', raw_label: 'Total assets', period_kind: 'instant', period_start: null }), metric('income', { metric_key: 'vendor.net_income', raw_label: 'Net income', value: '-0.0000' })]
  const before = structuredClone(rows)
  const selected = selectDashboardFigures(report(rows))
  assert.deepEqual(selected.map(row => row.observation.id), ['revenue', 'cash', 'assets', 'income'])
  assert.equal(selected[1], rows[3]); assert.equal(selected[1].observation.value, '9007199254740993.0123456789')
  assert.equal(selected[3].observation.value, '-0.0000')
  assert.equal(selected[0].observation.scenario, 'unknown')
  assert.deepEqual(rows, before)
})

test('latest date selection never crosses scope, currency, scenario or duration basis', () => {
  const annual = metric('annual', { period_label: 'FY 2024', period_start: '2024-01-01', period_end: '2024-12-31' })
  const partial = metric('partial', { period_label: 'Q1 2025', period_start: '2025-01-01', period_end: '2025-03-31' })
  const forecast = metric('forecast', { scenario: 'forecast' })
  const foreign = metric('foreign', { currency: 'EUR', unit: 'EUR', scope: 'parent-only' })
  const selected = selectDashboardFigures(report([annual, partial, forecast, foreign]))
  assert.deepEqual(selected.map(row => row.observation.id), ['annual', 'partial', 'forecast', 'foreign'])
})

test('normalization and exact date context take priority, quarantine and missing tokens never become zero', () => {
  const raw = metric('raw', { value: null, normalization_status: 'unresolved', raw_value: '$25B+' })
  const unknownPeriod = metric('unknown-period', { period_kind: 'unknown', period_start: null, period_end: null, period_label: 'TTM Dec 2025' }, { snapshot_id: 'other-source' })
  const confirmed = metric('confirmed')
  const quarantined = metric('quarantined', { quarantined: true, metric_key: 'vendor.cash' })
  const missing = metric('missing', { value: null, raw_value: 'n.a.', normalization_status: 'missing' })
  const selected = selectDashboardFigures(report([raw, unknownPeriod, confirmed, quarantined, missing]))
  assert.equal(selected[0], confirmed)
  assert.ok(selected.every(row => !['raw', 'quarantined', 'missing'].includes(row.observation.id)))
  assert.deepEqual(selectDashboardFigures(report([missing, quarantined])), [])
})

test('raw-only workspaces retain exact ranges without inferring scale, units, dates or normalized values', () => {
  const range = metric('range', { raw_value: '{"label":"$25B+"}', value: null, normalization_status: 'unresolved', unit: null, currency: null, scale_multiplier: null, period_kind: 'unknown', period_label: null, period_start: null, period_end: null })
  const zero = metric('zero', { raw_value: '0', value: null, normalization_status: 'unresolved', metric_key: 'vendor.cash' })
  const unavailable = ['n.a.', 'N/A', 'not disclosed', '—', ' '].map((raw_value, index) => metric(`absent-${index}`, { raw_value, value: null, normalization_status: 'unresolved' }))
  assert.deepEqual(selectDashboardFigures(report([range, ...unavailable, zero])), [range, zero])
  assert.equal(range.observation.value, null); assert.equal(range.observation.unit, null)
})

test('conflicting same-period snapshots stay together, with no amount-based winner', () => {
  const a = metric('a')
  const b = metric('b', { value: '2000000.0010', period_label: 'Fiscal 2025' }, { snapshot_id: 'source-b', file_name: 'other.xlsx' })
  const cash = metric('cash', { metric_key: 'vendor.cash' })
  const selected = selectDashboardFigures(report([a, cash, b]))
  assert.deepEqual(selected.map(row => row.observation.id), ['a', 'b', 'cash'])
  const many = Array.from({ length: 5 }, (_, index) => metric(`conflict-${index}`, { value: `${index}.0000` }, { snapshot_id: `source-${index}` }))
  assert.deepEqual(selectDashboardFigures(report(many)), [])
})

test('explicit cross-source conflicts retain all eligible alternatives and never truncate to four', () => {
  const rows = [metric('a'), metric('b', { metric_key: 'other.revenue', raw_label: 'Different provider revenue' }, { provider: 'other', snapshot_id: 'other' })]
  const conflicts = [{ kind: 'value_conflict', observation_ids: ['a', 'b'] }]
  assert.deepEqual(selectDashboardFigures(report(rows, { conflicts })).map(row => row.observation.id), ['a', 'b'])
  const many = [...rows, ...[2, 3, 4].map(index => metric(`other-${index}`, { metric_key: `other.metric_${index}` }))]
  assert.deepEqual(selectDashboardFigures(report(many, { conflicts: [{ kind: 'value_conflict', observation_ids: many.map(row => row.observation.id) }] })), [])
})

test('scientific decimal tokens stay exact and transitive conflict alternatives cannot disappear', () => {
  const rows = [metric('a', { value: '9.0071992547409930123456789E+15' }), metric('b', { metric_key: 'other.revenue' }), metric('c', { metric_key: 'third.revenue' })]
  const conflicts = [{ kind: 'value_conflict', observation_ids: ['b', 'c'] }, { kind: 'value_conflict', observation_ids: ['a', 'b'] }]
  assert.deepEqual(selectDashboardFigures(report(rows, { conflicts })).map(row => row.observation.id), ['a', 'b', 'c'])
  assert.equal(rows[0].observation.value, '9.0071992547409930123456789E+15')
})
