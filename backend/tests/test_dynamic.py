from calendar import monthrange
from datetime import date
from decimal import Decimal

import pytest

from app.dynamic import calculate_revenue_dynamic
from app.schemas import Observation


def revenue(identifier, start, end, value='1', **updates):
    fields = dict(id=identifier, deal_id='company-deal', entity_key='company-entity',
                  snapshot_id='snapshot-' + identifier, provider='uploaded',
                  metric_key='uploaded.recognized_revenue', raw_label='Recognized revenue',
                  raw_value=value, value=Decimal(value), unit='USD', currency='USD',
                  scale_multiplier=Decimal(1), normalization_status='confirmed',
                  normalization_basis='Explicit source USD', definition_key='recognized_revenue',
                  scope='consolidated', accounting_basis='US_GAAP', period_kind='duration',
                  period_start=start, period_end=end, scenario='actual',
                  verification_status='source_located', locator={'kind': 'csv_row', 'row': 2})
    fields.update(updates)
    return Observation(**fields)


def months(count=12):
    return [revenue('month-' + str(month), date(2024, month, 1),
                    date(2024, month, monthrange(2024, month)[1]))
            for month in range(1, count + 1)]


def test_six_available_months_produce_only_six_month_total_without_target():
    result = calculate_revenue_dynamic(months(6), 'company-deal')
    coverage = result.parameters['coverage']
    assert result.status == 'succeeded' and result.value == Decimal(6)
    assert coverage['requested_start'] == '2024-01-01' and coverage['requested_end'] == '2024-06-30'
    assert coverage['complete'] and not coverage['annualized']
    assert len(result.input_ids) == 6 and not coverage['missing_intervals']


def test_explicit_year_with_six_months_has_partial_total_and_no_annual_result():
    result = calculate_revenue_dynamic(months(6), 'company-deal', date(2024, 1, 1), date(2024, 12, 31))
    coverage = result.parameters['coverage']
    assert result.status == 'insufficient_data' and result.value is None
    assert coverage['observed_total'] == '6' and coverage['observed_total_kind'] == 'partial_observed_periods'
    assert coverage['missing_intervals'] == [{'start': '2024-07-01', 'end': '2024-12-31'}]
    assert not coverage['complete'] and not coverage['annualized']


def test_twelve_months_are_preferred_to_overlapping_annual_total():
    annual = revenue('annual', date(2024, 1, 1), date(2024, 12, 31), '999')
    result = calculate_revenue_dynamic([annual] + list(reversed(months())), 'company-deal')
    coverage = result.parameters['coverage']
    assert result.status == 'succeeded' and result.value == Decimal(12)
    assert len(result.input_ids) == 12 and 'annual' not in result.input_ids
    assert coverage['excluded_overlapping_input_ids'] == ['annual']


def test_annual_only_uses_reported_full_year_without_guessing_monthly_values():
    annual = revenue('annual', date(2024, 1, 1), date(2024, 12, 31), '123.45')
    result = calculate_revenue_dynamic([annual], 'company-deal')
    assert result.status == 'succeeded' and result.value == Decimal('123.45')
    assert result.input_ids == ['annual']


def test_quarter_and_monthly_data_form_nonoverlapping_available_chain():
    quarter = revenue('q1', date(2024, 1, 1), date(2024, 3, 31), '3')
    result = calculate_revenue_dynamic([quarter] + months(6)[3:], 'company-deal')
    assert result.status == 'succeeded' and result.value == Decimal(6)
    assert result.input_ids == ['q1', 'month-4', 'month-5', 'month-6']


def test_coarser_quarter_fills_a_gap_when_finer_months_cannot_cover_it():
    quarter = revenue('q1', date(2024, 1, 1), date(2024, 3, 31), '3')
    result = calculate_revenue_dynamic([months(1)[0], quarter] + months(6)[3:], 'company-deal')
    assert result.status == 'succeeded' and result.value == Decimal(6)
    assert 'q1' in result.input_ids and 'month-1' not in result.input_ids


def test_same_period_from_multiple_sources_is_ambiguous_even_when_equal():
    monthly = months(1)[0]
    duplicate = monthly.model_copy(update={'id': 'another-source', 'snapshot_id': 'other-snapshot'})
    result = calculate_revenue_dynamic([monthly, duplicate], 'company-deal')
    assert result.status == 'insufficient_data' and result.value is None
    assert 'ambiguous_same_period_sources_require_explicit_input_selection' in result.reasons
    assert result.parameters['coverage']['observed_total'] is None


def test_gaps_in_auto_window_block_full_window_but_label_observed_components():
    result = calculate_revenue_dynamic([months(3)[0], months(3)[2]], 'company-deal')
    coverage = result.parameters['coverage']
    assert result.status == 'insufficient_data' and result.value is None
    assert coverage['missing_intervals'] == [{'start': '2024-02-01', 'end': '2024-02-29'}]
    assert coverage['observed_total'] == '2' and coverage['observed_total_kind'] == 'partial_observed_periods'


@pytest.mark.parametrize('changes,reason', [
    ({'scope': 'parent-only'}, 'scope_mismatch'),
    ({'currency': 'EUR', 'unit': 'EUR'}, 'currency_mismatch'),
    ({'scenario': 'forecast'}, 'historical_actual_inputs_required'),
    ({'definition_key': None}, 'reviewed_definition_required'),
    ({'period_start': None, 'period_end': None, 'period_kind': 'unknown'}, 'exact_duration_period_required'),
])
def test_unknown_or_mismatched_candidates_fail_closed_through_strict_engine(changes, reason):
    rows = months(2)
    rows[1] = rows[1].model_copy(update=changes)
    result = calculate_revenue_dynamic(rows, 'company-deal')
    assert result.status == 'insufficient_data' and result.value is None
    assert reason in result.reasons


def test_an_annual_amount_cannot_be_sliced_into_a_requested_half_year():
    annual = revenue('annual', date(2024, 1, 1), date(2024, 12, 31), '123')
    result = calculate_revenue_dynamic([annual], 'company-deal', date(2024, 1, 1), date(2024, 6, 30))
    coverage = result.parameters['coverage']
    assert result.value is None and result.status == 'insufficient_data'
    assert coverage['observed_total'] is None and result.input_ids == []
    assert coverage['excluded_outside_target_input_ids'] == ['annual']


def test_decimal_partial_sum_and_order_independence():
    rows = [row.model_copy(update={'value': Decimal('0.1'), 'raw_value': '0.1'}) for row in months(6)]
    first = calculate_revenue_dynamic(rows, 'company-deal')
    second = calculate_revenue_dynamic(list(reversed(rows)), 'company-deal')
    assert first.value == Decimal('0.6')
    assert first.model_dump() == second.model_dump()


def test_invalid_or_missing_target_bounds_do_not_guess_a_window():
    result = calculate_revenue_dynamic(months(1), 'company-deal', date(2024, 1, 1))
    assert result.status == 'insufficient_data' and 'both_target_start_and_target_end_required' in result.reasons
    assert calculate_revenue_dynamic([], 'company-deal').status == 'insufficient_data'


def test_failed_result_is_also_stable_under_input_reordering():
    rows = months(2)
    rows[1] = rows[1].model_copy(update={'scenario': 'forecast'})
    first = calculate_revenue_dynamic(rows, 'company-deal')
    second = calculate_revenue_dynamic(list(reversed(rows)), 'company-deal')
    assert first.model_dump() == second.model_dump()
