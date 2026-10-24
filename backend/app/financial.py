"""Reviewed Decimal functions. Source formulas and SQL are never executed.

Canonical ``definition_key`` values are assigned by a reviewed mapping, not by
matching provider labels. The intake adapters deliberately leave them unset.
"""
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, localcontext
from typing import Any

from .schemas import Calculation, Comparison, Observation, stable_id


VERSION = '1'
OUTPUT_DEFINITIONS = {'arr': 'arr', 'revenue': 'recognized_revenue', 'monthly_net_burn': 'monthly_net_burn', 'runway': 'runway_months'}
DEFINITIONS = {
    'arr': ('active_mrr',),
    'revenue': ('recognized_revenue',),
    'monthly_net_burn': ('cash_operating_outflow', 'cash_operating_inflow'),
    'runway': ('unrestricted_cash', 'monthly_net_burn'),
}
FORMULAS = {
    'arr': 'active monthly recurring revenue × 12',
    'revenue': 'SUM(recognized revenue over complete, contiguous, non-overlapping periods)',
    'monthly_net_burn': 'monthly operating cash outflow − monthly operating cash inflow',
    'runway': 'unrestricted cash balance / positive monthly net cash burn',
}


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def _period_valid(observation: Observation) -> bool:
    if observation.period_kind == 'duration':
        return (
            observation.period_start is not None
            and observation.period_end is not None
            and observation.period_start <= observation.period_end
        )
    if observation.period_kind == 'instant':
        return observation.period_start is None and observation.period_end is not None
    return False


def _monetary(observation: Observation) -> bool:
    # Currency-valued observations use their ISO currency as canonical unit.
    # Ratios, percentages and counts explicitly carry no currency.
    return observation.unit not in {'ratio', 'percent', 'count', 'employees', 'days', 'months', 'years'}


def _source_issues(observation: Observation, prefix: str) -> list[str]:
    result = []
    if observation.quarantined:
        result.append(prefix + '_quarantined')
    if observation.normalization_status != 'confirmed':
        result.append(prefix + '_normalization_unconfirmed')
    if (observation.scale_multiplier is None or not observation.scale_multiplier.is_finite()
            or observation.scale_multiplier <= 0 or not observation.normalization_basis):
        result.append(prefix + '_normalization_basis_or_scale_missing')
    if observation.value is None or not observation.value.is_finite():
        result.append(prefix + '_numeric_value_missing_or_nonfinite')
    if observation.verification_status != 'source_located':
        result.append(prefix + '_source_location_unverified')
    if not observation.snapshot_id or not observation.locator:
        result.append(prefix + '_source_reference_missing')
    if not _period_valid(observation):
        result.append(prefix + '_exact_period_unknown_or_invalid')
    if not observation.unit:
        result.append(prefix + '_unit_unknown')
    if _monetary(observation) and not observation.currency:
        result.append(prefix + '_currency_unknown')
    return result


def compare_observations(
    lhs: Observation,
    rhs: Observation,
    tolerance: Decimal,
    historical_cutoff: date | None = None,
) -> Comparison:
    """Compare RHS − LHS only after known, matching source context.

    Tolerance is an explicit absolute policy in canonical units. A matched result
    means processing agreement; it does not establish independent corroboration.
    At a historical cutoff, unknown source availability is a missing context.
    """
    try:
        tolerance = Decimal(str(tolerance))
    except (InvalidOperation, ValueError):
        raise ValueError('Tolerance must be a finite nonnegative decimal.') from None
    if not tolerance.is_finite() or tolerance < 0:
        raise ValueError('Tolerance must be a finite nonnegative decimal.')

    missing = _source_issues(lhs, 'lhs') + _source_issues(rhs, 'rhs')
    mismatch = []
    checks: dict[str, Any] = {}
    for field in ('deal_id', 'entity_key', 'definition_key', 'scope', 'accounting_basis', 'scenario', 'unit'):
        a, b = getattr(lhs, field), getattr(rhs, field)
        known = a not in (None, '', 'unknown') and b not in (None, '', 'unknown')
        checks[field] = {'lhs': a, 'rhs': b, 'known': known, 'equal': a == b}
        if not known:
            missing.append(field + '_unknown')
        elif a != b:
            mismatch.append(field + '_mismatch')
    # Both null currencies are meaningful only for an explicitly nonmonetary unit.
    if lhs.currency != rhs.currency:
        mismatch.append('currency_mismatch')
    checks['currency'] = {'lhs': lhs.currency, 'rhs': rhs.currency, 'equal': lhs.currency == rhs.currency}
    if _period_valid(lhs) and _period_valid(rhs):
        for field in ('period_kind', 'period_start', 'period_end'):
            a, b = getattr(lhs, field), getattr(rhs, field)
            checks[field] = {'lhs': str(a) if a else None, 'rhs': str(b) if b else None, 'equal': a == b}
            if a != b:
                mismatch.append(field + '_mismatch')
    if lhs.id == rhs.id:
        mismatch.append('same_observation')
    if historical_cutoff is not None:
        checks['historical_cutoff'] = historical_cutoff.isoformat()
        for name, observation in (('lhs', lhs), ('rhs', rhs)):
            if observation.period_end and observation.period_end > historical_cutoff:
                mismatch.append(name + '_period_after_cutoff')
            if observation.information_as_of is None:
                missing.append(name + '_source_availability_at_cutoff_unknown')
            elif observation.information_as_of > historical_cutoff:
                mismatch.append(name + '_source_after_cutoff')
    checks['independent_sources_established'] = False
    reasons = _unique(mismatch + missing)
    result = {
        'id': stable_id('comparison', VERSION, lhs.id, rhs.id, tolerance, historical_cutoff),
        'deal_id': lhs.deal_id, 'lhs_id': lhs.id, 'rhs_id': rhs.id,
        'reason_codes': reasons, 'checks': checks,
    }
    if reasons:
        return Comparison(status='not_comparable' if mismatch else 'insufficient_evidence', **result)
    with localcontext() as context:
        context.prec = 50
        delta = rhs.value - lhs.value
        relative_delta = delta / lhs.value if lhs.value != 0 else None
    return Comparison(
        status='matched' if abs(delta) <= tolerance else 'value_mismatch',
        delta=delta, relative_delta=relative_delta, tolerance=tolerance, **result,
    )


def _calendar_month(observation: Observation) -> bool:
    if observation.period_kind != 'duration' or not _period_valid(observation):
        return False
    start, end = observation.period_start, observation.period_end
    return start.day == 1 and end == date(start.year, start.month, monthrange(start.year, start.month)[1])


def _coverage_date(parameters: dict[str, Any], key: str) -> date | None:
    value = parameters.get(key)
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def calculate(
    metric_key: str,
    inputs: list[Observation],
    parameters: dict[str, Any],
    deal_id: str,
) -> Calculation:
    """Run a named function against trusted, reviewed source observations.

    ``revenue`` requires ``period_start`` and ``period_end`` in parameters;
    inputs must exactly cover that requested interval without gaps or overlap.
    ``arr`` requires one dated instant active-MRR observation. Burn uses two
    positive-direction operating cash-flow totals for one calendar month.
    Runway requires unrestricted closing cash and positive monthly burn ending
    at that same date. These are evidence requirements, not inferred aliases.
    """
    result = {
        'id': stable_id('calculation', VERSION, metric_key,
                        [(x.id, x.value) for x in inputs], parameters, deal_id),
        'deal_id': deal_id, 'metric_key': metric_key,
        'function_key': metric_key + '_v' + VERSION,
        'formula': FORMULAS.get(metric_key, 'Unsupported function'),
        'input_ids': [x.id for x in inputs],
        'input_snapshots': _unique([x.snapshot_id for x in inputs]),
        'parameters': parameters, 'function_version': VERSION,
    }

    def failed(reasons: list[str], status: str = 'insufficient_data') -> Calculation:
        return Calculation(status=status, reasons=_unique(reasons), **result)

    if metric_key not in DEFINITIONS:
        return failed(['function_not_whitelisted'], 'not_applicable')
    if not inputs:
        return failed(['required_inputs_missing'])
    issues = []
    if len({x.id for x in inputs}) != len(inputs):
        issues.append('duplicate_input_observation')
    first = inputs[0]
    for index, observation in enumerate(inputs):
        issues += _source_issues(observation, f'input_{index}')
        if observation.deal_id != deal_id:
            issues.append('deal_id_mismatch')
        for field in ('entity_key', 'scope', 'accounting_basis', 'scenario', 'unit', 'currency'):
            value = getattr(observation, field)
            if value in (None, '', 'unknown'):
                issues.append(field + '_unknown')
            elif value != getattr(first, field):
                issues.append(field + '_mismatch')
        if observation.currency != observation.unit:
            issues.append('canonical_currency_unit_required')
        if observation.definition_key not in DEFINITIONS[metric_key]:
            issues.append('reviewed_definition_required')
        if observation.scenario != 'actual':
            # Calculation has no forecast-scenario contract, so it cannot label
            # a projected run-rate or cash balance as a present financial result.
            issues.append('historical_actual_inputs_required')
    if issues:
        return failed(issues)

    with localcontext() as context:
        context.prec = 50
        if metric_key == 'arr':
            if len(inputs) != 1:
                return failed(['one_active_mrr_input_required'])
            if first.period_kind != 'instant':
                return failed(['active_mrr_as_of_date_required'])
            if first.value < 0:
                return failed(['negative_active_mrr'])
            value, unit = first.value * Decimal(12), first.unit
        elif metric_key == 'revenue':
            start = _coverage_date(parameters, 'period_start')
            end = _coverage_date(parameters, 'period_end')
            if start is None or end is None or end < start:
                return failed(['explicit_valid_coverage_period_required'])
            if any(x.period_kind != 'duration' for x in inputs):
                return failed(['duration_revenue_inputs_required'])
            ordered = sorted(inputs, key=lambda x: x.period_start)
            if ordered[0].period_start != start or ordered[-1].period_end != end:
                return failed(['incomplete_or_excess_revenue_coverage'])
            for before, after in zip(ordered, ordered[1:]):
                if after.period_start <= before.period_end:
                    return failed(['overlapping_revenue_periods'])
                if after.period_start != before.period_end + timedelta(days=1):
                    return failed(['gap_in_revenue_coverage'])
            value, unit = sum((x.value for x in ordered), Decimal(0)), first.unit
        elif metric_key == 'monthly_net_burn':
            by_definition = {x.definition_key: x for x in inputs}
            if len(inputs) != 2 or set(by_definition) != set(DEFINITIONS[metric_key]):
                return failed(['one_operating_cash_inflow_and_outflow_required'])
            if not all(_calendar_month(x) for x in inputs):
                return failed(['complete_calendar_month_required'])
            if len({(x.period_start, x.period_end) for x in inputs}) != 1:
                return failed(['cash_flow_period_mismatch'])
            if any(x.value < 0 for x in inputs):
                return failed(['cash_flow_positive_direction_convention_required'])
            value = (by_definition['cash_operating_outflow'].value
                     - by_definition['cash_operating_inflow'].value)
            unit = first.unit
        else:
            by_definition = {x.definition_key: x for x in inputs}
            if len(inputs) != 2 or set(by_definition) != set(DEFINITIONS[metric_key]):
                return failed(['one_unrestricted_cash_and_monthly_burn_required'])
            cash, burn = by_definition['unrestricted_cash'], by_definition['monthly_net_burn']
            if cash.period_kind != 'instant' or not _calendar_month(burn):
                return failed(['closing_cash_and_complete_monthly_burn_required'])
            if cash.period_end != burn.period_end:
                return failed(['cash_and_burn_as_of_mismatch'])
            if cash.value < 0:
                return failed(['unrestricted_cash_must_be_nonnegative'])
            if burn.value <= 0:
                return failed(['positive_monthly_burn_required'])
            value, unit = cash.value / burn.value, 'months'
    return Calculation(status='succeeded', value=value, unit=unit, **result)
