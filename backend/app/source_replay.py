"""Source arithmetic replay for the reviewed native Orbis Summary layout.

This reproduces arithmetic within one provider source. It does not assign a
canonical definition, turn an unknown scenario into actual, or verify another
provider's data. It is deliberately separate from the strict financial engine.
"""
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext
import re

from app.schemas import Calculation, Observation, stable_id


_COMPONENTS = (
    ('orbis.non_current_assets', 'Non-current assets', '49'),
    ('orbis.current_assets', 'Current assets', '53'),
)
_VERSION = '1'


def replay_balance_sheet(
    observations: list[Observation], deal_id: str, period_end: date,
) -> Calculation:
    """Add native non-current and current assets for one exact dated source.

    Inputs must come from a single source-located, normalized Orbis workbook
    column with reviewed row labels, units and reporting scope. Missing or
    ambiguous components produce no number. Reported total assets is not an
    arithmetic input and is not silently counted as another component.
    """
    components = []
    reasons = []
    for metric, _, _ in _COMPONENTS:
        candidates = [o for o in observations if o.metric_key == metric and o.period_end == period_end]
        if not candidates:
            reasons.append('missing_' + metric)
        elif len(candidates) != 1:
            reasons.append('ambiguous_' + metric)
        else:
            components.append(candidates[0])

    context = {
        'source_arithmetic_replay': True,
        'period_end': period_end.isoformat(),
        'canonical_definition_equivalence_asserted': False,
        'scenario_converted_to_actual': False,
        'independent_or_cross_source_verification': False,
        'source_availability_at_historical_cutoff_verified': False,
        'interpretation': 'Arithmetic reproduction of two source-reported native Orbis asset components only.',
    }
    result = {
        'id': stable_id('orbis-balance-sheet-source-replay', _VERSION, deal_id,
                        period_end, [(o.id, o.value) for o in components]),
        'deal_id': deal_id,
        'metric_key': 'source_total_assets_replay',
        'function_key': 'orbis_balance_sheet_components_v1',
        'function_version': _VERSION,
        'formula': 'non_current_assets + current_assets',
        'input_ids': [o.id for o in components],
        'input_snapshots': list(dict.fromkeys(o.snapshot_id for o in components)),
        'parameters': context,
    }

    def missing():
        return Calculation(status='insufficient_data', reasons=list(dict.fromkeys(reasons)), **result)

    if reasons:
        return missing()
    first = components[0]
    columns = []
    for observation, (_, label, row) in zip(components, _COMPONENTS):
        if observation.deal_id != deal_id:
            reasons.append('component_deal_mismatch')
        if observation.provider != 'orbis':
            reasons.append('native_orbis_source_required')
        if not observation.entity_key or observation.entity_key != first.entity_key:
            reasons.append('component_entity_unknown_or_mismatch')
        if not observation.snapshot_id or observation.snapshot_id != first.snapshot_id:
            reasons.append('single_native_snapshot_required')
        if observation.verification_status != 'source_located' or observation.quarantined:
            reasons.append('source_located_nonquarantined_components_required')
        if (observation.normalization_status != 'confirmed' or observation.value is None
                or not observation.value.is_finite() or not observation.normalization_basis):
            reasons.append('confirmed_finite_source_values_required')
        if observation.period_kind != 'instant' or observation.period_start is not None:
            reasons.append('closing_balance_components_required')
        if observation.period_end != period_end:
            reasons.append('exact_component_period_required')
        if observation.scope != 'consolidated' or observation.scope != first.scope:
            reasons.append('verified_matching_consolidation_scope_required')
        if not observation.accounting_basis or observation.accounting_basis != first.accounting_basis:
            reasons.append('matching_known_accounting_basis_required')
        if observation.scenario != first.scenario:
            reasons.append('source_scenario_labels_differ')
        if observation.currency != 'USD' or observation.unit != 'USD':
            reasons.append('reviewed_native_usd_unit_required')
        if observation.scale_multiplier != Decimal(1000):
            reasons.append('reviewed_native_thousand_usd_scale_required')
        if observation.raw_label != label:
            reasons.append('reviewed_component_row_labels_required')
        locator = observation.locator
        match = re.fullmatch(r'([A-Z]{1,3})' + row, str(locator.get('cell', '')))
        if locator.get('kind') != 'xlsx_cell' or not locator.get('sheet') or match is None:
            reasons.append('reviewed_native_component_cell_required')
        else:
            columns.append(match.group(1))
            if (locator.get('unit_cell') != match.group(1) + '41'
                    or locator.get('period_cell') != match.group(1) + '40'):
                reasons.append('native_unit_and_period_header_evidence_required')
        if locator.get('raw_unit_header') != 'th USD' or locator.get('raw_scope_header') != 'Consolidated, Annual report':
            reasons.append('explicit_native_unit_and_scope_headers_required')
        if (locator.get('raw_duration_header') != '12 months'
                or locator.get('raw_accounting_basis_header') != observation.accounting_basis):
            reasons.append('native_reporting_context_required')
        try:
            raw = Decimal(str(locator.get('raw_xml_value')))
            if not raw.is_finite() or observation.value != raw * Decimal(1000):
                reasons.append('native_xml_value_or_normalization_mismatch')
        except InvalidOperation:
            reasons.append('native_xml_numeric_evidence_required')
    if len(set(columns)) != 1 or len(columns) != 2:
        reasons.append('single_native_reporting_column_required')
    if components[0].locator.get('sheet') != components[1].locator.get('sheet'):
        reasons.append('single_native_worksheet_required')
    if reasons:
        return missing()
    with localcontext() as decimal_context:
        decimal_context.prec = 50
        value = sum((o.value for o in components), Decimal(0))
    context['source_scenario'] = first.scenario
    context['source_entity_key'] = first.entity_key
    context['source_scope'] = first.scope
    context['source_accounting_basis'] = first.accounting_basis
    context['source_unit'] = first.unit
    context['source_normalization_multiplier'] = str(first.scale_multiplier)
    return Calculation(status='succeeded', value=value, unit=first.unit, **result)
