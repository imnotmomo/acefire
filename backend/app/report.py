"""Member C's source-bound company report for the frontend.

Intake/extraction belongs upstream. This module assembles stored observations,
profiles, deterministic calculation runs and comparisons; it neither reads a
document nor fills missing financial data with estimates or model output.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any

from .financial import DEFINITIONS
from .lineage import _index, _source, build_calculation_lineage, build_profile_lineage
from .schemas import Calculation, Company, Comparison, Observation, SourceSnapshot, stable_id

REPORT_VERSION = "1"
_LOCATION_FIELDS = ("page", "line_start", "line_end", "column", "row", "sheet", "cell", "pointer", "paragraph")


def _binding(snapshot: SourceSnapshot, locator: dict | None = None) -> dict[str, Any]:
    source = _source(snapshot, locator)
    # Preserve the original locator exactly, including additional native keys.
    # Explicit nulls say which common location dimensions are not available.
    source["location"] = {key: locator.get(key) if locator is not None else None for key in _LOCATION_FIELDS}
    return source


def _review_reasons(observation: Observation) -> list[str]:
    reasons = []
    if observation.quarantined:
        reasons.append("quarantined")
    if observation.normalization_status != "confirmed" or observation.value is None:
        reasons.append("normalized_value_unavailable")
    if observation.value is not None and not observation.value.is_finite():
        reasons.append("normalized_value_nonfinite")
    if not observation.normalization_basis or observation.scale_multiplier is None or not observation.scale_multiplier.is_finite() or observation.scale_multiplier <= 0:
        reasons.append("normalization_basis_or_scale_missing")
    if not observation.definition_key:
        reasons.append("definition_not_reviewed")
    if observation.verification_status != "source_located":
        reasons.append("source_location_unverified")
    if not observation.locator:
        reasons.append("source_locator_missing")
    if observation.period_kind == "unknown" or observation.period_end is None or (observation.period_kind == "duration" and observation.period_start is None):
        reasons.append("exact_period_unknown")
    for field in ("scope", "accounting_basis", "scenario", "unit"):
        if getattr(observation, field) in (None, "", "unknown"):
            reasons.append(field + "_unknown")
    if observation.unit not in {None, "", "ratio", "percent", "count", "employees", "days", "months", "years"} and not observation.currency:
        reasons.append("currency_unknown")
    return reasons


def _explicit_lineage_locations(lineage: dict[str, Any], snapshots: dict[str, SourceSnapshot]) -> dict[str, Any]:
    """Keep native locators and make unavailable line/page dimensions explicit."""
    for key in ("inputs", "fields"):
        for item in lineage.get(key, []):
            source = item.get("source")
            if source is not None:
                item["source"] = _binding(snapshots[source["snapshot_id"]], source.get("locator"))
    for node in lineage.get("nodes", []):
        data = node.get("data", {})
        source = data.get("source")
        if source is not None:
            data["source"] = _binding(snapshots[source["snapshot_id"]], source.get("locator"))
    return lineage


def build_company_report(
    company: Company,
    profiles: list[dict],
    observations: list[Observation],
    snapshots: list[SourceSnapshot],
    calculations: list[Calculation],
    comparisons: list[Comparison],
) -> dict[str, Any]:
    """Build a frontend-ready, complete report of *available* stored evidence.

    Every reported financial number has its immutable source binding. Every
    calculated/comparison number retains its stored formula and input references.
    Summary counts describe these supplied records and are not company metrics.
    """
    observation_index = _index(observations, "observation")
    snapshot_index = _index(snapshots, "snapshot")
    calculation_index = _index(calculations, "calculation")
    comparison_index = _index(comparisons, "comparison")
    for label, records in (("observation", observation_index), ("snapshot", snapshot_index), ("calculation", calculation_index), ("comparison", comparison_index)):
        for record in records.values():
            if record.deal_id != company.deal_id:
                raise ValueError(f"Company report {label} belongs to another deal: {record.id}")

    def bound_observation(observation: Observation) -> dict[str, Any]:
        snapshot = snapshot_index.get(observation.snapshot_id)
        if snapshot is None:
            raise ValueError(f"Missing source snapshot for observation {observation.id}: {observation.snapshot_id}")
        if snapshot.entity_key != observation.entity_key:
            raise ValueError(f"Observation/source entity mapping disagrees: {observation.id}")
        if snapshot.provider != observation.provider:
            raise ValueError(f"Observation/source provider disagrees: {observation.id}")
        full = observation.model_dump(mode="json")
        reasons = _review_reasons(observation)
        return {
            "observation": full,
            "source": _binding(snapshot, full["locator"]),
            "context": {
                "entity_key": observation.entity_key,
                "scope": observation.scope,
                "accounting_basis": observation.accounting_basis,
                "scenario": observation.scenario,
                "definition_key": observation.definition_key,
                "period_kind": observation.period_kind,
                "period_label": observation.period_label,
                "period_start": full["period_start"],
                "period_end": full["period_end"],
                "information_as_of": full["information_as_of"],
                "review_required": bool(reasons),
                "review_reasons": reasons,
                "notes": list(observation.notes),
            },
        }

    metrics = [bound_observation(observation_index[key]) for key in sorted(observation_index)]
    bound_by_id = {row["observation"]["id"]: row for row in metrics}
    primary_records = []
    profile_source_ids = set()
    for record in profiles:
        snapshot_id = record.get("snapshot_id")
        snapshot = snapshot_index.get(snapshot_id)
        if snapshot is None:
            raise ValueError(f"Missing primary profile snapshot: {snapshot_id}")
        if snapshot.entity_key != company.entity_key:
            raise ValueError("Primary profile snapshot belongs to another entity")
        if snapshot.provider != company.primary_provider or snapshot.data_role != "primary_company_data":
            raise ValueError("Primary profile must be bound to the configured primary company source")
        profile_source_ids.add(snapshot_id)
        primary_records.append({**record, "source": _binding(snapshot)})
    profile_lineage = _explicit_lineage_locations(build_profile_lineage(profiles, list(snapshot_index.values())), snapshot_index)

    calculation_reports = [
        _explicit_lineage_locations(build_calculation_lineage(calculation_index[key], list(observation_index.values()), list(snapshot_index.values())), snapshot_index)
        for key in sorted(calculation_index)
    ]
    comparison_reports = []
    for key in sorted(comparison_index):
        comparison = comparison_index[key]
        lhs = bound_by_id.get(comparison.lhs_id)
        rhs = bound_by_id.get(comparison.rhs_id)
        if lhs is None or rhs is None:
            absent = comparison.lhs_id if lhs is None else comparison.rhs_id
            raise ValueError(f"Missing comparison observation: {absent}")
        comparison_reports.append({
            "comparison": comparison.model_dump(mode="json"),
            "lhs": lhs,
            "rhs": rhs,
            "arithmetic": {
                "delta_formula": "rhs.value - lhs.value",
                "relative_delta_formula": "delta / lhs.value when lhs.value is nonzero; otherwise null",
                "lhs_observation_id": comparison.lhs_id,
                "rhs_observation_id": comparison.rhs_id,
                "stored_result_only": True,
                "note": "No arithmetic is performed while presenting this report; comparison policy and context checks remain attached.",
            },
        })

    observation_source_ids = {item.snapshot_id for item in observation_index.values()}
    source_files = []
    for key in sorted(snapshot_index):
        snapshot = snapshot_index[key]
        full = snapshot.model_dump(mode="json")
        source_files.append({
            **_binding(snapshot),
            "category": "primary_company_data" if snapshot.data_role == "primary_company_data" else "private_supplemental_evidence",
            "source_kind": snapshot.source_kind,
            "source_uri": snapshot.source_uri,
            "retrieved_at": full["retrieved_at"],
            "uploaded_at": full["uploaded_at"],
            "provider_as_of": full["provider_as_of"],
            "has_reported_observations": key in observation_source_ids,
            "has_profile_fields": key in profile_source_ids,
            "context": full["context"],
        })

    coverage = []
    gaps: list[dict[str, Any]] = []
    for metric, definitions in DEFINITIONS.items():
        present = {definition: [item.id for item in observation_index.values() if item.definition_key == definition] for definition in definitions}
        runs = [item for item in calculation_index.values() if item.metric_key == metric]
        succeeded = [item.id for item in runs if item.status == "succeeded"]
        absent = [definition for definition, ids in present.items() if not ids]
        coverage.append({
            "metric_key": metric,
            "required_reviewed_definitions": list(definitions),
            "candidate_input_ids_by_definition": present,
            "missing_definition_keys": absent,
            "calculation_ids": [item.id for item in runs],
            "successful_calculation_ids": succeeded,
            "status": "recorded_calculation_available" if succeeded else "no_successful_recorded_calculation",
            "note": "Candidate presence alone does not establish compatible periods, units, scope or a successful calculation.",
        })
        if not succeeded:
            gaps.append({
                "code": "no_successful_recorded_calculation", "metric_key": metric,
                "missing_definition_keys": absent,
                "calculation_ids": [item.id for item in runs],
                "message": "No successful stored calculation is available. No replacement financial number is inferred.",
            })
    if not profiles:
        gaps.append({"code": "primary_profile_unavailable", "message": "No source-bound primary company profile is available."})
    snapshot_only = sorted(set(snapshot_index) - observation_source_ids - profile_source_ids)
    if snapshot_only:
        gaps.append({"code": "source_files_without_structured_extraction", "snapshot_ids": snapshot_only,
                     "message": "Files are available, but this report has no stored observations or profile fields extracted from them."})
    line_unknown = [row["observation"]["id"] for row in metrics if row["source"]["locator"].get("kind") in {"pdf_page", "pdf_text", "pdf_lines"} and (
        row["source"]["location"]["line_start"] is None or row["source"]["location"]["line_end"] is None
    )]
    if line_unknown:
        gaps.append({"code": "pdf_line_locations_unknown", "observation_ids": line_unknown,
                     "message": "Available page/other locators are preserved; line numbers were not supplied and are not invented."})

    review_ids = [row["observation"]["id"] for row in metrics if row["context"]["review_required"]]
    summary = {
        "reported_metric_count": len(metrics),
        "needs_review_count": len(review_ids),
        "needs_review_observation_ids": review_ids,
        "source_file_count": len(source_files),
        "primary_source_file_count": sum(item["data_role"] == "primary_company_data" for item in source_files),
        "private_supplemental_file_count": sum(item["data_role"] == "supplemental_evidence" for item in source_files),
        "calculation_status_counts": dict(Counter(item.status for item in calculation_index.values())),
        "comparison_status_counts": dict(Counter(item.status for item in comparison_index.values())),
        "basis": {
            "kind": "record_inventory_counts",
            "formula": "Counts of unique supplied record IDs, grouped by the stored role/status; these are report coverage counts, not financial metrics.",
            "snapshot_ids": sorted(snapshot_index), "observation_ids": sorted(observation_index),
            "calculation_ids": sorted(calculation_index), "comparison_ids": sorted(comparison_index),
        },
    }
    payload = {
        "report_version": REPORT_VERSION,
        "company": company.model_dump(mode="json"),
        "primary_profile": {"available": bool(profiles), "provider": company.primary_provider,
                            "records": primary_records, "field_lineage": profile_lineage},
        "reported_metrics": metrics,
        "calculations": calculation_reports,
        "comparisons": comparison_reports,
        "source_files": source_files,
        "coverage": coverage,
        "gaps": gaps,
        "summary": summary,
    }
    return {
        "report_id": stable_id("company-report", REPORT_VERSION, payload),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
