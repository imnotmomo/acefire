"""Describe recorded data windows without aggregating financial values."""
from __future__ import annotations

import calendar
import json
from collections import Counter
from datetime import date, timedelta
from typing import Any

from .schemas import Observation

_GROUP_FIELDS = ("deal_id", "metric_key", "provider", "entity_key", "scope", "scenario", "currency", "unit")


def _grain(start: date, end: date) -> str:
    complete_months = start.day == 1 and end.day == calendar.monthrange(end.year, end.month)[1]
    months = (end.year - start.year) * 12 + end.month - start.month + 1
    if complete_months:
        return {1: "monthly", 3: "3_month_period", 6: "6_month_period", 12: "12_month_period"}.get(months, "date_interval")
    return "date_interval"


def _value_status(observation: Observation) -> str:
    if observation.quarantined:
        return "quarantined"
    if observation.normalization_status == "missing":
        return "missing"
    if observation.normalization_status == "confirmed" and observation.value is not None and observation.value.is_finite():
        return "normalized_value_available"
    return "unresolved"


def _record(observation: Observation) -> dict[str, Any]:
    return {
        "observation_id": observation.id,
        "snapshot_id": observation.snapshot_id,
        "period_kind": observation.period_kind,
        "period_label": observation.period_label,
        "period_start": observation.period_start.isoformat() if observation.period_start else None,
        "period_end": observation.period_end.isoformat() if observation.period_end else None,
        "candidate_value_status": _value_status(observation),
        "normalization_status": observation.normalization_status,
        "verification_status": observation.verification_status,
        "quarantined": observation.quarantined,
        "definition_key": observation.definition_key,
        "accounting_basis": observation.accounting_basis,
    }


def _union(periods: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for period in sorted(periods, key=lambda item: (item["period_start"], item["period_end"], item["observation_id"])):
        start, end = date.fromisoformat(period["period_start"]), date.fromisoformat(period["period_end"])
        if merged:
            prior_end = date.fromisoformat(merged[-1]["end"])
            adjacent = start <= prior_end or (prior_end < date.max and start == prior_end + timedelta(days=1))
            if adjacent:
                merged[-1]["end"] = max(merged[-1]["end"], end.isoformat())
                merged[-1]["observation_ids"].append(period["observation_id"])
                continue
        merged.append({"start": start.isoformat(), "end": end.isoformat(), "observation_ids": [period["observation_id"]]})
    return merged


def _gaps(intervals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "start": (date.fromisoformat(left["end"]) + timedelta(days=1)).isoformat(),
            "end": (date.fromisoformat(right["start"]) - timedelta(days=1)).isoformat(),
            "preceding_observation_ids": list(left["observation_ids"]),
            "following_observation_ids": list(right["observation_ids"]),
        }
        for left, right in zip(intervals, intervals[1:])
    ]


def _overlaps(periods: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for index, lhs in enumerate(periods):
        for rhs in periods[index + 1:]:
            start = max(lhs["period_start"], rhs["period_start"])
            end = min(lhs["period_end"], rhs["period_end"])
            if start > end:
                continue
            left_days = (date.fromisoformat(lhs["period_end"]) - date.fromisoformat(lhs["period_start"])).days
            right_days = (date.fromisoformat(rhs["period_end"]) - date.fromisoformat(rhs["period_start"])).days
            coarser = lhs if left_days > right_days else rhs if right_days > left_days else None
            finer = rhs if left_days > right_days else lhs if right_days > left_days else None
            identical = lhs["period_start"] == rhs["period_start"] and lhs["period_end"] == rhs["period_end"]
            contained = (start == lhs["period_start"] and end == lhs["period_end"]) or (start == rhs["period_start"] and end == rhs["period_end"])
            result.append({
                "lhs_observation_id": lhs["observation_id"], "rhs_observation_id": rhs["observation_id"],
                "start": start, "end": end,
                "relationship": "same_interval" if identical else "contained_interval" if contained else "partial_overlap",
                "coarser_observation_id": coarser["observation_id"] if coarser else None,
                "finer_observation_id": finer["observation_id"] if finer else None,
                "aggregation_performed": False,
            })
    return result


def build_period_coverage(observations: list[Observation]) -> list[dict[str, Any]]:
    """Group exact source windows for frontend selection; never sum source amounts.

    A 3/6/12-month grain is a complete calendar-month date interval, not a claim
    about the issuer's fiscal quarters or year. Rolling labels with unknown exact
    dates remain unresolved. Instant stock balances are kept outside flow unions.
    """
    unique: dict[str, Observation] = {}
    for observation in observations:
        old = unique.get(observation.id)
        if old is not None and old.model_dump(mode="json") != observation.model_dump(mode="json"):
            raise ValueError(f"Conflicting period observations for ID {observation.id}")
        unique[observation.id] = observation
    groups: dict[tuple, list[Observation]] = {}
    for observation in unique.values():
        key = tuple(getattr(observation, field) for field in _GROUP_FIELDS)
        groups.setdefault(key, []).append(observation)
    result: list[dict[str, Any]] = []
    for key in sorted(groups, key=lambda value: json.dumps(value, default=str)):
        values = sorted(groups[key], key=lambda item: item.id)
        context = dict(zip(_GROUP_FIELDS, key))
        duration, instant, unresolved = [], [], []
        for observation in values:
            record = _record(observation)
            if observation.period_kind == "duration":
                if observation.period_start is None or observation.period_end is None:
                    unresolved.append({**record, "reason": "duration_dates_incomplete"})
                elif observation.period_end < observation.period_start:
                    unresolved.append({**record, "reason": "duration_dates_reversed"})
                else:
                    duration.append({**record, "grain": _grain(observation.period_start, observation.period_end)})
            elif observation.period_kind == "instant":
                if observation.period_end is None or observation.period_start is not None:
                    unresolved.append({**record, "reason": "instant_closing_date_unknown_or_invalid"})
                else:
                    instant.append(record)
            else:
                unresolved.append({**record, "reason": "exact_period_kind_or_dates_unknown"})
        duration.sort(key=lambda item: (item["period_start"], item["period_end"], item["observation_id"]))
        instant.sort(key=lambda item: (item["period_end"], item["observation_id"]))
        intervals = _union(duration)
        numeric_intervals = _union([item for item in duration if item["candidate_value_status"] == "normalized_value_available"])
        closing: dict[str, list[str]] = {}
        for item in instant:
            closing.setdefault(item["period_end"], []).append(item["observation_id"])
        result.append({
            **context,
            "unknown_context_fields": [field for field, value in context.items() if value in (None, "", "unknown")],
            "observation_ids": [item.id for item in values],
            "accounting_bases": sorted({item.accounting_basis for item in values}, key=lambda item: str(item)),
            "definition_keys": sorted({item.definition_key for item in values}, key=lambda item: str(item)),
            "available_start": intervals[0]["start"] if intervals else None,
            "available_end": intervals[-1]["end"] if intervals else None,
            "known_periods": duration,
            "coverage_intervals": intervals,
            "gaps": _gaps(intervals),
            "candidate_value_coverage_intervals": numeric_intervals,
            "candidate_value_gaps": _gaps(numeric_intervals),
            "overlaps": _overlaps(duration),
            "instant_periods": instant,
            "closing_dates": [{"date": end, "observation_ids": ids} for end, ids in sorted(closing.items())],
            "unresolved_periods": unresolved,
            "candidate_value_status_counts": dict(Counter(_value_status(item) for item in values)),
            "aggregation_performed": False,
            "notes": [
                "Coverage describes recorded inclusive date intervals; it does not establish comparable definitions or calculation readiness.",
                "Candidate value coverage requires a confirmed finite normalized value and no quarantine; other context still needs validation.",
                "Overlapping coarse and fine intervals must not be added together automatically.",
                "Calendar-month span labels do not assert fiscal-quarter or fiscal-year identity; closing balances are separate from duration flows.",
            ],
        })
    return result
