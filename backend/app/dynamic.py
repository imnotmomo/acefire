"""Revenue over explicit source coverage, without extrapolation or double counts."""
from __future__ import annotations

from bisect import bisect_left
from datetime import date
from decimal import Decimal, localcontext
from typing import Any

from app.financial import calculate
from app.schemas import Calculation, Observation, stable_id


_VERSION = '1'
_POLICY = ('Maximize non-overlapping source-covered days, then minimize the sum of '
           'source duration days squared; tie-break by observation IDs. This prefers '
           'the finest complete cover and uses coarser periods only where needed.')
_COVERAGE_REASONS = {
    'incomplete_or_excess_revenue_coverage', 'overlapping_revenue_periods',
    'gap_in_revenue_coverage',
}


def _unique(values):
    return list(dict.fromkeys(values))


def _iso(value):
    return value.isoformat() if value else None


def _select_cover(candidates: list[Observation]) -> list[Observation]:
    """Weighted interval scheduling; no individual day expansion is required."""
    ordered = sorted(candidates, key=lambda o: (o.period_end, o.period_start, o.id))
    ends = [o.period_end.toordinal() for o in ordered]
    # covered days, sum of squared duration days, chosen indices
    best = [(0, 0, ())]

    def score(state):
        return (-state[0], state[1], tuple(ordered[i].id for i in state[2]))

    for index, observation in enumerate(ordered):
        start, end = observation.period_start.toordinal(), observation.period_end.toordinal()
        previous_count = bisect_left(ends, start, hi=index)
        prefix = best[previous_count]
        duration = end - start + 1
        included = (prefix[0] + duration, prefix[1] + duration * duration, prefix[2] + (index,))
        skipped = best[-1]
        best.append(included if score(included) < score(skipped) else skipped)
    return sorted((ordered[i] for i in best[-1][2]), key=lambda o: (o.period_start, o.period_end, o.id))


def _missing_intervals(start: date, end: date, included: list[Observation]) -> list[dict[str, str]]:
    cursor, stop = start.toordinal(), end.toordinal()
    missing = []
    for observation in included:
        first, last = observation.period_start.toordinal(), observation.period_end.toordinal()
        if first > cursor:
            missing.append({'start': date.fromordinal(cursor).isoformat(), 'end': date.fromordinal(first - 1).isoformat()})
        cursor = last + 1
    if cursor <= stop:
        missing.append({'start': date.fromordinal(cursor).isoformat(), 'end': end.isoformat()})
    return missing


def calculate_revenue_dynamic(
    inputs: list[Observation],
    deal_id: str,
    target_start: date | None = None,
    target_end: date | None = None,
) -> Calculation:
    """Calculate recognized revenue only over its actual source date coverage.

    With no target, the requested window is the earliest through latest valid
    supplied duration. With an explicit window, missing dates block the final
    value. An observed partial sum is separately labeled in coverage metadata;
    it is never annualized. Caller-selected duplicate periods are ambiguous
    even if their values agree, so source selection must be explicit.
    """
    # Revenue addition is order independent; audit payloads and failed-result
    # identities must also replay identically when request IDs are reordered.
    inputs = sorted(inputs, key=lambda o: (o.id, str(o.value)))
    eligible: list[Observation] = []
    input_issues: dict[str, list[str]] = {}
    for observation in inputs:
        if (observation.period_kind != 'duration' or observation.period_start is None
                or observation.period_end is None or observation.period_end < observation.period_start):
            input_issues[observation.id] = ['exact_duration_period_required']
            continue
        checked = calculate('revenue', [observation], {
            'period_start': observation.period_start.isoformat(),
            'period_end': observation.period_end.isoformat(),
        }, deal_id)
        if checked.status != 'succeeded':
            input_issues[observation.id] = checked.reasons
        else:
            eligible.append(observation)
    available_start = min((o.period_start for o in eligible), default=None)
    available_end = max((o.period_end for o in eligible), default=None)
    automatic = target_start is None and target_end is None
    requested_start = available_start if automatic else target_start
    requested_end = available_end if automatic else target_end
    coverage: dict[str, Any] = {
        'requested_start': _iso(requested_start), 'requested_end': _iso(requested_end),
        'available_start': _iso(available_start), 'available_end': _iso(available_end),
        'window_basis': 'supplied_source_period_bounds' if automatic else 'explicit_requested_period',
        'included_periods': [], 'missing_intervals': [], 'complete': False,
        'period_label': None, 'selection_policy': _POLICY,
        'excluded_overlapping_input_ids': [], 'excluded_outside_target_input_ids': [],
        'input_issues': input_issues, 'observed_total': None,
        'observed_total_kind': None, 'annualized': False,
    }
    result = {
        'id': stable_id('revenue-dynamic', _VERSION, deal_id,
                        sorted((o.id, str(o.value)) for o in inputs), target_start, target_end),
        'deal_id': deal_id, 'metric_key': 'revenue',
        'function_key': 'revenue_dynamic_v1', 'function_version': _VERSION,
        'formula': 'SUM(recognized_revenue over selected non-overlapping source periods)',
        'parameters': {'coverage': coverage},
        'input_ids': _unique([o.id for o in inputs]),
        'input_snapshots': _unique([o.snapshot_id for o in inputs]),
    }

    def failed(reasons):
        return Calculation(status='insufficient_data', reasons=_unique(reasons), **result)

    if (target_start is None) != (target_end is None):
        return failed(['both_target_start_and_target_end_required'])
    if requested_start is None or requested_end is None:
        return failed(['valid_recognized_revenue_duration_inputs_required']
                      + [reason for reasons in input_issues.values() for reason in reasons])
    if requested_end < requested_start:
        return failed(['requested_period_end_precedes_start'])
    coverage['period_label'] = requested_start.isoformat() + ' to ' + requested_end.isoformat()
    if input_issues:
        return failed(['supplied_inputs_require_review']
                      + [reason for reasons in input_issues.values() for reason in reasons])
    if not eligible:
        return failed(['required_inputs_missing'])

    # Reuse strict source/entity/scope/currency/scenario checks across the entire
    # supplied candidate set. Only overlap/gap/bounds checks are handled here.
    checked = calculate('revenue', eligible, {
        'period_start': requested_start.isoformat(), 'period_end': requested_end.isoformat(),
    }, deal_id)
    context_reasons = [reason for reason in checked.reasons if reason not in _COVERAGE_REASONS]
    if context_reasons:
        return failed(context_reasons)

    period_groups = {}
    for observation in eligible:
        period_groups.setdefault((observation.period_start, observation.period_end), []).append(observation)
    ambiguous = [group for group in period_groups.values() if len(group) > 1]
    if ambiguous:
        coverage['ambiguous_periods'] = [
            {'start': group[0].period_start.isoformat(), 'end': group[0].period_end.isoformat(),
             'observation_ids': sorted(o.id for o in group)} for group in ambiguous
        ]
        return failed(['ambiguous_same_period_sources_require_explicit_input_selection'])
    candidates = [o for o in eligible if requested_start <= o.period_start and o.period_end <= requested_end]
    candidate_ids = {o.id for o in candidates}
    coverage['excluded_outside_target_input_ids'] = sorted(o.id for o in eligible if o.id not in candidate_ids)
    included = _select_cover(candidates)
    result['input_ids'] = [o.id for o in included]
    result['input_snapshots'] = _unique([o.snapshot_id for o in included])
    coverage['included_periods'] = [
        {'observation_id': o.id, 'snapshot_id': o.snapshot_id,
         'start': o.period_start.isoformat(), 'end': o.period_end.isoformat(),
         'value': str(o.value)} for o in included
    ]
    selected_ids = set(result['input_ids'])
    coverage['excluded_overlapping_input_ids'] = sorted(
        o.id for o in candidates if o.id not in selected_ids and any(
            o.period_start <= picked.period_end and picked.period_start <= o.period_end
            for picked in included
        )
    )
    coverage['missing_intervals'] = _missing_intervals(requested_start, requested_end, included)
    coverage['complete'] = bool(included) and not coverage['missing_intervals']
    if included:
        with localcontext() as context:
            context.prec = 50
            coverage['observed_total'] = str(sum((o.value for o in included), Decimal(0)))
        coverage['observed_total_kind'] = 'complete_requested_period' if coverage['complete'] else 'partial_observed_periods'
        coverage['observed_period_start'] = included[0].period_start.isoformat()
        coverage['observed_period_end'] = included[-1].period_end.isoformat()
    if not coverage['complete']:
        coverage['period_label'] += ' (incomplete source coverage)'
        return failed(['requested_period_not_fully_covered'])
    verified = calculate('revenue', included, {
        'period_start': requested_start.isoformat(), 'period_end': requested_end.isoformat(),
    }, deal_id)
    if verified.status != 'succeeded':
        return failed(verified.reasons)
    return Calculation(status='succeeded', value=verified.value, unit=verified.unit, **result)
