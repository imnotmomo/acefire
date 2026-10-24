"""Nonblocking source-number flags. This module never selects an authoritative value."""
from collections import defaultdict
from datetime import date
from decimal import Decimal, localcontext
from pathlib import Path

from app.dynamic import calculate_revenue_dynamic
from app.financial import OUTPUT_DEFINITIONS
from app.schemas import Calculation, Observation, SourceSnapshot, stable_id


def _numeric(observation):
    return (observation.normalization_status == 'confirmed' and observation.value is not None
            and observation.value.is_finite())


def _period(observation):
    if observation.period_kind == 'instant' and observation.period_end is not None and observation.period_start is None:
        return ('instant', None, observation.period_end)
    if (observation.period_kind == 'duration' and observation.period_start is not None
            and observation.period_end is not None and observation.period_start <= observation.period_end):
        return ('duration', observation.period_start, observation.period_end)
    # Distinct TTM labels stay separate; no guessed month ends or durations.
    return ('label', observation.period_label, None)


def _context(observation, include_definition=True):
    fields = ['deal_id', 'entity_key', 'scope', 'scenario', 'accounting_basis', 'unit', 'currency']
    if include_definition:
        fields += ['definition_key']
    return tuple(getattr(observation, name) for name in fields)


def _known(observation, include_definition=True):
    required = ['deal_id', 'entity_key', 'scope', 'scenario', 'accounting_basis', 'unit']
    if include_definition:
        required.append('definition_key')
    if any(getattr(observation, name) in (None, '', 'unknown') for name in required):
        return False
    if observation.unit not in {'ratio', 'percent', 'count', 'employees', 'days', 'months', 'years'} and not observation.currency:
        return False
    return _period(observation)[0] != 'label'


def _proof(observation, snapshots):
    source = snapshots.get(observation.snapshot_id)
    path = source.local_path if source else None
    return {
        'observation_id': observation.id, 'snapshot_id': observation.snapshot_id,
        'provider': observation.provider, 'sha256': source.sha256 if source else None,
        'source_uri': source.source_uri if source else None,
        'file_name': (source.original_filename or (Path(path).name if path else None)) if source else None,
        'locator': observation.locator, 'raw_value': observation.raw_value,
        'value': str(observation.value) if observation.value is not None else None,
        'unit': observation.unit, 'currency': observation.currency,
        'scale_multiplier': str(observation.scale_multiplier) if observation.scale_multiplier is not None else None,
        'period_kind': observation.period_kind, 'period_start': str(observation.period_start) if observation.period_start else None,
        'period_end': str(observation.period_end) if observation.period_end else None,
        'period_label': observation.period_label, 'scope': observation.scope,
        'definition_key': observation.definition_key, 'accounting_basis': observation.accounting_basis,
        'scenario': observation.scenario,
    }


def _alternative(rows, snapshots, value=None, period=None, calculation_id=None):
    first = rows[0]
    result = {
        'observation_ids': sorted(o.id for o in rows),
        'value': str(value if value is not None else first.value),
        'raw_values': [o.raw_value for o in rows], 'unit': first.unit, 'currency': first.currency,
        'metric_keys': sorted({o.metric_key for o in rows}), 'definition_key': first.definition_key,
        'entity_key': first.entity_key, 'scope': first.scope, 'scenario': first.scenario,
        'accounting_basis': first.accounting_basis,
        'period': [str(x) if x is not None else None for x in (period or _period(first))],
        'sources': [_proof(o, snapshots) for o in rows],
        'interpretation': 'source_reported_value' if len(rows) == 1 and calculation_id is None else 'arithmetic_over_source_inputs',
    }
    if calculation_id:
        result['calculation_id'] = calculation_id
    return result


def _event(kind, alternatives, snapshots, delta=None, reasons=None):
    ids = sorted({identifier for alternative in alternatives for identifier in alternative['observation_ids']})
    version_context = [(identifier, snapshots.get(source_id).sha256 if snapshots.get(source_id) else None)
                       for alternative in alternatives for proof in alternative['sources']
                       for identifier, source_id in [(proof['observation_id'], proof['snapshot_id'])]]
    event_id = stable_id('number-flag-v1', kind, alternatives, sorted(version_context))
    return {'id': event_id, 'kind': kind, 'status': 'needs_review' if kind == 'comparability_review' else 'conflict_numbers',
            'observation_ids': ids, 'alternatives': alternatives,
            'delta': str(delta) if delta is not None else None, 'reason_codes': reasons or [],
            'independent_verification': False, 'authoritative_value_selected': False}


def _same_period_for_review(lhs, rhs):
    a, b = _period(lhs), _period(rhs)
    if a[0] != 'label' and b[0] != 'label':
        return a == b
    if lhs.period_label or rhs.period_label:
        return bool(lhs.period_label) and lhs.period_label == rhs.period_label
    return a == b


def detect_conflicts(observations: list[Observation], snapshots: list[SourceSnapshot]) -> list[dict]:
    """Detect comparable disagreement; unresolved contexts get review flags only."""
    sources = {s.id: s for s in snapshots}
    rows = sorted((o for o in observations if _numeric(o)), key=lambda o: o.id)
    events = []
    known_groups = defaultdict(list)
    for observation in rows:
        if _known(observation):
            known_groups[(_context(observation), _period(observation))].append(observation)
    known_pairs = set()
    for group in known_groups.values():
        if len({o.value for o in group}) > 1:
            alternatives = [_alternative([o], sources) for o in group]
            events.append(_event('value_conflict', alternatives, sources))
            known_pairs.update(frozenset((a.id, b.id)) for a in group for b in group if a.id != b.id)
    for index, lhs in enumerate(rows):
        for rhs in rows[index + 1:]:
            if lhs.deal_id != rhs.deal_id or lhs.value == rhs.value or frozenset((lhs.id, rhs.id)) in known_pairs:
                continue
            linked = lhs.metric_key == rhs.metric_key or (lhs.definition_key and lhs.definition_key == rhs.definition_key)
            if not linked or not _same_period_for_review(lhs, rhs):
                continue
            # Explicit definition links are allowed; namespace aliases are never inferred.
            if not (_known(lhs) and _known(rhs) and _context(lhs) == _context(rhs)):
                events.append(_event('comparability_review', [_alternative([lhs], sources), _alternative([rhs], sources)], sources,
                                     reasons=['source_context_unknown_or_not_equivalent']))
    # Recognized revenue is the reviewed additive flow. Ratios, stock balances
    # and similarly named unknown definitions are never summed as aliases.
    for reported in rows:
        if reported.definition_key != 'recognized_revenue' or reported.period_kind != 'duration' or not _known(reported):
            continue
        components = [o for o in rows if o.id != reported.id and o.definition_key == 'recognized_revenue'
                      and o.period_kind == 'duration' and _known(o) and _context(o) == _context(reported)
                      and reported.period_start <= o.period_start and o.period_end <= reported.period_end
                      and (o.period_start, o.period_end) != (reported.period_start, reported.period_end)]
        if not components:
            continue
        replay = calculate_revenue_dynamic(components, reported.deal_id, reported.period_start, reported.period_end)
        if replay.status != 'succeeded' or replay.value == reported.value:
            continue
        chosen = {o.id: o for o in components}
        selected = [chosen[i] for i in replay.input_ids]
        with localcontext() as context:
            context.prec = 50
            delta = replay.value - reported.value
        events.append(_event('aggregate_value_conflict', [
            _alternative([reported], sources), _alternative(selected, sources, replay.value, _period(reported)),
        ], sources, delta=delta))
    return sorted({event['id']: event for event in events}.values(), key=lambda event: (event['kind'], event['id']))


def _date(value):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def annotate_calculation_conflicts(
    calculation: Calculation, observations: list[Observation], snapshots: list[SourceSnapshot],
) -> dict:
    """Return post-calculation flags only; never block or replace a result."""
    by_id = {o.id: o for o in observations}
    sources = {s.id: s for s in snapshots}
    input_ids = set(calculation.input_ids)
    related = [event for event in detect_conflicts(observations, snapshots) if input_ids.intersection(event['observation_ids'])]
    conflicts = [event for event in related if event['kind'] != 'comparability_review']
    needs_review = [event for event in related if event['kind'] == 'comparability_review']
    inputs = [by_id[i] for i in calculation.input_ids if i in by_id]
    if calculation.status != 'succeeded' or calculation.value is None or not inputs or len(inputs) != len(calculation.input_ids):
        return {'conflict_numbers': bool(conflicts), 'conflicts': conflicts, 'needs_review': needs_review}
    first = inputs[0]
    special = calculation.metric_key == 'source_total_assets_replay'
    definition = OUTPUT_DEFINITIONS.get(calculation.metric_key)
    if not special and definition is None:
        return {'conflict_numbers': bool(conflicts), 'conflicts': conflicts, 'needs_review': needs_review}
    coverage = calculation.parameters.get('coverage', {})
    if calculation.metric_key == 'revenue':
        start = _date(coverage.get('requested_start') or calculation.parameters.get('period_start')) or min((o.period_start for o in inputs if o.period_start), default=None)
        end = _date(coverage.get('requested_end') or calculation.parameters.get('period_end')) or max((o.period_end for o in inputs if o.period_end), default=None)
        period = ('duration', start, end)
    elif calculation.metric_key == 'monthly_net_burn':
        period = _period(first)
    else:
        period = ('instant', None, first.period_end)
    for reported in observations:
        if reported.id in input_ids or not _numeric(reported) or reported.deal_id != calculation.deal_id:
            continue
        if special:
            if (reported.metric_key != 'orbis.total_assets' or reported.provider != 'orbis'
                    or reported.snapshot_id != first.snapshot_id or _period(reported) != period):
                continue
        elif not (reported.definition_key == definition or reported.metric_key == calculation.metric_key and reported.definition_key):
            continue
        if _period(reported) != period:
            continue
        context_known = _known(reported, not special) and _known(first, not special)
        # Runway is measured in months, with no monetary currency on the output.
        output_unit = calculation.unit
        output_currency = None if output_unit == 'months' else first.currency
        equivalent = (context_known and reported.entity_key == first.entity_key and reported.scope == first.scope
                      and reported.scenario == first.scenario and reported.accounting_basis == first.accounting_basis
                      and reported.unit == output_unit and reported.currency == output_currency
                      and (special or reported.definition_key == definition))
        if special:
            # This source replay preserves an explicitly unknown scenario and
            # does not require a canonical cross-provider definition.
            equivalent = (reported.snapshot_id == first.snapshot_id and reported.entity_key == first.entity_key
                          and reported.scope == first.scope and reported.scope is not None
                          and reported.scenario == first.scenario and reported.accounting_basis == first.accounting_basis
                          and reported.unit == output_unit and reported.currency == first.currency
                          and reported.locator.get('kind') == 'xlsx_cell'
                          and reported.locator.get('raw_unit_header') == first.locator.get('raw_unit_header')
                          and reported.locator.get('raw_scope_header') == first.locator.get('raw_scope_header'))
        if equivalent and reported.value == calculation.value:
            continue
        # The calculated alternative references every input and its native locator.
        computed = _alternative(inputs, sources, calculation.value, period, calculation.id)
        computed['unit'], computed['currency'], computed['definition_key'] = output_unit, output_currency, definition
        alternatives = [_alternative([reported], sources), computed]
        if equivalent:
            with localcontext() as context:
                context.prec = 50
                delta = calculation.value - reported.value
            existing = next((event for event in conflicts if set(event['observation_ids']) == input_ids | {reported.id}), None)
            if existing:
                existing['calculation_id'] = calculation.id
                existing['calculated_value'] = str(calculation.value)
            else:
                conflicts.append(_event('aggregate_value_conflict' if len(inputs) > 1 else 'value_conflict', alternatives, sources, delta=delta))
        else:
            needs_review.append(_event('comparability_review', alternatives, sources,
                                       reasons=['reported_output_context_unknown_or_not_equivalent']))
    conflicts = sorted({event['id']: event for event in conflicts}.values(), key=lambda event: event['id'])
    needs_review = sorted({event['id']: event for event in needs_review}.values(), key=lambda event: event['id'])
    return {'conflict_numbers': bool(conflicts), 'conflicts': conflicts, 'needs_review': needs_review}
