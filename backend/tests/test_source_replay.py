from datetime import date
from decimal import Decimal
import os
from pathlib import Path

import pytest

from app.local_sources import ingest_local_circle
from app.schemas import CIRCLE
from app.source_replay import replay_balance_sheet


DATA = Path(os.environ.get('DATA_ROOT', str(Path(__file__).resolve().parents[2] / 'data' / 'additional-cases')))


@pytest.fixture(scope='module')
def observations():
    return ingest_local_circle(DATA / CIRCLE.deal_id).observations


def test_real_source_arithmetic_replay_has_component_values_and_file_locators(observations):
    result = replay_balance_sheet(observations, CIRCLE.deal_id, date(2024, 12, 31))
    assert result.status == 'succeeded' and result.value == Decimal('45834409000')
    assert result.formula == 'non_current_assets + current_assets'
    by_id = {o.id: o for o in observations}
    inputs = [by_id[i] for i in result.input_ids]
    assert [o.value for o in inputs] == [Decimal('669460000'), Decimal('45164949000')]
    assert [o.locator['cell'] for o in inputs] == ['I49', 'I53']
    assert {o.locator['sheet'] for o in inputs} == {'CIRCLE_INTERNET_GROUP__INC'}
    assert len(result.input_snapshots) == 1
    assert all(o.metric_key != 'orbis.total_assets' for o in inputs)
    reported = next(o for o in observations if o.metric_key == 'orbis.total_assets' and o.period_end == date(2024, 12, 31))
    assert result.value == reported.value  # Processing agreement within this same source, not independence.
    assert all(o.scenario == 'unknown' and o.definition_key is None for o in inputs)
    assert result.parameters['source_scenario'] == 'unknown'
    assert not result.parameters['scenario_converted_to_actual']
    assert not result.parameters['independent_or_cross_source_verification']


@pytest.mark.parametrize('changes,reason', [
    ({'snapshot_id': 'another-snapshot'}, 'single_native_snapshot_required'),
    ({'unit': 'EUR', 'currency': 'EUR'}, 'reviewed_native_usd_unit_required'),
    ({'normalization_status': 'unresolved'}, 'confirmed_finite_source_values_required'),
    ({'scope': None}, 'verified_matching_consolidation_scope_required'),
    ({'quarantined': True}, 'source_located_nonquarantined_components_required'),
    ({'scale_multiplier': Decimal(1)}, 'reviewed_native_thousand_usd_scale_required'),
    ({'value': Decimal('1')}, 'native_xml_value_or_normalization_mismatch'),
])
def test_source_replay_rejects_mixed_or_unverified_components(observations, changes, reason):
    components = [o for o in observations if o.metric_key in {'orbis.non_current_assets', 'orbis.current_assets'} and o.period_end == date(2024, 12, 31)]
    components[1] = components[1].model_copy(update=changes)
    result = replay_balance_sheet(components, CIRCLE.deal_id, date(2024, 12, 31))
    assert result.status == 'insufficient_data' and result.value is None
    assert reason in result.reasons


def test_source_replay_returns_missing_instead_of_zero_for_missing_cells(observations):
    result = replay_balance_sheet(observations, CIRCLE.deal_id, date(2022, 12, 31))
    assert result.status == 'insufficient_data' and result.value is None
    assert result.reasons


def test_duplicate_uploaded_and_legacy_components_require_explicit_snapshot_selection(observations):
    component = next(o for o in observations if o.metric_key == 'orbis.current_assets' and o.period_end == date(2024, 12, 31))
    result = replay_balance_sheet(observations + [component.model_copy(update={'id': 'duplicate', 'snapshot_id': 'upload'})], CIRCLE.deal_id, date(2024, 12, 31))
    assert result.status == 'insufficient_data'
    assert 'ambiguous_orbis.current_assets' in result.reasons


def test_unavailable_requested_year_never_picks_another_period(observations):
    result = replay_balance_sheet(observations, CIRCLE.deal_id, date(2021, 12, 31))
    assert result.status == 'insufficient_data' and result.value is None
    assert not result.input_ids
