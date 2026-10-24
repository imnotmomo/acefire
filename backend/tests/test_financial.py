from datetime import date
from decimal import Decimal

import pytest

from app.financial import calculate, compare_observations
from app.schemas import Observation


def observation(identifier='a', **updates):
    data = dict(
        id=identifier, deal_id='circle-2025-ipo', entity_key='circle-internet-group-inc',
        snapshot_id='snapshot-' + identifier, provider='orbis', metric_key='orbis.revenue',
        raw_label='Operating revenue', raw_value='100.10', value=Decimal('100.10'),
        unit='USD', currency='USD', scale_multiplier=Decimal(1), normalization_status='confirmed',
        normalization_basis='Explicit USD header', definition_key='recognized_revenue',
        scope='consolidated', accounting_basis='US_GAAP', period_kind='duration',
        period_start=date(2024, 1, 1), period_end=date(2024, 12, 31), scenario='actual',
        information_as_of=date(2025, 2, 26), verification_status='source_located',
        locator={'sheet': 'financials', 'cell': 'A1'},
    )
    data.update(updates)
    return Observation(**data)


@pytest.mark.parametrize('field,value,code', [
    ('scope', None, 'scope_unknown'),
    ('definition_key', None, 'definition_key_unknown'),
    ('scenario', 'unknown', 'scenario_unknown'),
    ('accounting_basis', None, 'accounting_basis_unknown'),
    ('period_end', None, 'rhs_exact_period_unknown_or_invalid'),
    ('verification_status', 'api_reported', 'rhs_source_location_unverified'),
    ('quarantined', True, 'rhs_quarantined'),
    ('scale_multiplier', None, 'rhs_normalization_basis_or_scale_missing'),
])
def test_unknown_context_blocks_comparison(field, value, code):
    result = compare_observations(observation(), observation('b', **{field: value}), Decimal('0'))
    assert result.status == 'insufficient_evidence'
    assert code in result.reason_codes
    assert result.delta is None and result.tolerance is None


def test_currency_and_known_definition_mismatches_block():
    rhs = observation('b', currency='EUR', unit='EUR', definition_key='analyst_normalized_revenue')
    result = compare_observations(observation(), rhs, Decimal('10'))
    assert result.status == 'not_comparable'
    assert {'currency_mismatch', 'definition_key_mismatch'} <= set(result.reason_codes)
    assert result.delta is None


def test_decimal_delta_tolerance_and_zero_denominator():
    lhs = observation(value=Decimal('0.10'))
    rhs = observation('b', value=Decimal('0.30'))
    result = compare_observations(lhs, rhs, Decimal('0.20'))
    assert result.status == 'matched' and result.delta == Decimal('0.20')
    assert result.relative_delta == Decimal('2')
    assert compare_observations(lhs, rhs, Decimal('0.19')).status == 'value_mismatch'
    result = compare_observations(observation(value=Decimal(0)), rhs, Decimal(0))
    assert result.relative_delta is None


def test_percentage_fractions_do_not_require_a_currency_or_monetary_scale():
    lhs = observation(unit='ratio', currency=None, definition_key='pretax_profit_margin',
                      value=Decimal('0.13218'), raw_value='13.218', scale_multiplier=Decimal('0.01'),
                      normalization_basis='Explicit percent header; percentage points × 0.01')
    rhs = lhs.model_copy(update={'id': 'b', 'snapshot_id': 'snapshot-b'})
    result = compare_observations(lhs, rhs, Decimal('0.00001'))
    assert result.status == 'matched' and result.delta == 0


@pytest.mark.parametrize('unit', ['employees', 'days'])
def test_explicit_nonmonetary_units_do_not_require_currency(unit):
    lhs = observation(unit=unit, currency=None, definition_key='reviewed_' + unit)
    rhs = lhs.model_copy(update={'id': 'b', 'snapshot_id': 'snapshot-b'})
    assert compare_observations(lhs, rhs, Decimal(0)).status == 'matched'


@pytest.mark.parametrize('tolerance', [Decimal('-1'), Decimal('NaN'), Decimal('Infinity')])
def test_invalid_tolerance_rejected(tolerance):
    with pytest.raises(ValueError):
        compare_observations(observation(), observation('b'), tolerance)


def test_historical_cutoff_uses_reporting_and_source_availability_dates():
    lhs, rhs = observation(), observation('b', information_as_of=date(2026, 1, 1))
    result = compare_observations(lhs, rhs, Decimal(0), date(2025, 5, 27))
    assert result.status == 'not_comparable' and 'rhs_source_after_cutoff' in result.reason_codes
    rhs = observation('b', information_as_of=None)
    result = compare_observations(lhs, rhs, Decimal(0), date(2025, 5, 27))
    assert result.status == 'insufficient_evidence'


def test_incomplete_real_provider_context_does_not_calculate_arr():
    result = calculate('arr', [observation(definition_key=None, scope=None)], {}, 'circle-2025-ipo')
    assert result.status == 'insufficient_data' and result.value is None
    assert 'reviewed_definition_required' in result.reasons


def test_forecast_or_nonfinite_inputs_do_not_become_actual_calculations():
    source = observation(definition_key='active_mrr', period_kind='instant', period_start=None,
                         scenario='forecast')
    result = calculate('arr', [source], {}, source.deal_id)
    assert result.status == 'insufficient_data' and 'historical_actual_inputs_required' in result.reasons
    source = source.model_copy(update={'scenario': 'actual', 'value': Decimal('NaN')})
    result = calculate('arr', [source], {}, source.deal_id)
    assert result.status == 'insufficient_data' and 'input_0_numeric_value_missing_or_nonfinite' in result.reasons


def test_arr_requires_confirmed_active_mrr_and_records_lineage():
    source = observation(definition_key='active_mrr', period_kind='instant', period_start=None,
                         value=Decimal('800000.01'))
    result = calculate('arr', [source], {}, source.deal_id)
    assert result.status == 'succeeded' and result.value == Decimal('9600000.12')
    assert result.input_ids == [source.id] and result.input_snapshots == [source.snapshot_id]


def test_revenue_requires_exact_complete_nonoverlapping_coverage():
    a = observation(period_end=date(2024, 6, 30), value=Decimal('0.10'))
    b = observation('b', period_start=date(2024, 7, 1), value=Decimal('0.20'))
    params = {'period_start': '2024-01-01', 'period_end': '2024-12-31'}
    result = calculate('revenue', [b, a], params, a.deal_id)
    assert result.status == 'succeeded' and result.value == Decimal('0.30')
    assert calculate('revenue', [a, b], {}, a.deal_id).status == 'insufficient_data'
    overlap = calculate('revenue', [a, b, observation('annual')], params, a.deal_id)
    assert overlap.status == 'insufficient_data' and 'overlapping_revenue_periods' in overlap.reasons
    gap = calculate('revenue', [a, b.model_copy(update={'period_start': date(2024, 7, 2)})], params, a.deal_id)
    assert gap.status == 'insufficient_data' and 'gap_in_revenue_coverage' in gap.reasons


def test_duplicate_source_inputs_cannot_double_count():
    source = observation()
    result = calculate('revenue', [source, source], {}, source.deal_id)
    assert result.status == 'insufficient_data' and 'duplicate_input_observation' in result.reasons


def cash_flow(identifier, definition, value, **updates):
    return observation(identifier, definition_key=definition, accounting_basis='cash_basis',
                       period_start=date(2024, 12, 1), value=Decimal(value), **updates)


def test_monthly_cash_burn_uses_cash_flows_not_pnl():
    outflow = cash_flow('outflow', 'cash_operating_outflow', '750000.10')
    inflow = cash_flow('inflow', 'cash_operating_inflow', '300000.10')
    result = calculate('monthly_net_burn', [outflow, inflow], {}, outflow.deal_id)
    assert result.status == 'succeeded' and result.value == Decimal('450000.00')
    assert calculate('monthly_net_burn', [observation()], {}, outflow.deal_id).status == 'insufficient_data'
    short_month = outflow.model_copy(update={'period_start': date(2024, 12, 2)})
    result = calculate('monthly_net_burn', [short_month, inflow], {}, outflow.deal_id)
    assert result.status == 'insufficient_data' and 'complete_calendar_month_required' in result.reasons


def test_runway_requires_unrestricted_cash_and_positive_monthly_burn():
    cash = observation('cash', definition_key='unrestricted_cash', accounting_basis='cash_basis',
                       period_kind='instant', period_start=None, value=Decimal('7200000'))
    burn = cash_flow('burn', 'monthly_net_burn', '450000')
    result = calculate('runway', [cash, burn], {}, cash.deal_id)
    assert result.status == 'succeeded' and result.value == Decimal('16') and result.unit == 'months'
    for value in (Decimal(0), Decimal('-1')):
        result = calculate('runway', [cash, burn.model_copy(update={'value': value})], {}, cash.deal_id)
        assert result.status == 'insufficient_data' and 'positive_monthly_burn_required' in result.reasons
    result = calculate('runway', [cash.model_copy(update={'period_end': date(2024, 11, 30)}), burn], {}, cash.deal_id)
    assert result.status == 'insufficient_data' and 'cash_and_burn_as_of_mismatch' in result.reasons


def test_unlisted_function_never_executes_supplied_code():
    result = calculate('__import__("os")', [], {'sql': 'DROP TABLE x'}, 'circle-2025-ipo')
    assert result.status == 'not_applicable' and result.reasons == ['function_not_whitelisted']
