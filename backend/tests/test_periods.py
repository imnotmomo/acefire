from datetime import date
from decimal import Decimal

from app.periods import build_period_coverage
from app.schemas import CIRCLE, Observation


def period(identifier, start=None, end=None, **changes):
    fields = dict(
        id=identifier, deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        snapshot_id="file-" + identifier, provider="orbis", metric_key="orbis.operating_revenue",
        raw_label="Operating revenue", raw_value="1", value=Decimal("1000"), unit="USD", currency="USD",
        normalization_status="confirmed", scope="consolidated", scenario="unknown",
        period_kind="duration", period_start=date.fromisoformat(start) if start else None,
        period_end=date.fromisoformat(end) if end else None,
        locator={"kind": "xlsx_cell", "sheet": "Summary", "cell": "F81"},
    )
    fields.update(changes)
    return Observation(**fields)


def test_calendar_spans_and_missing_month_are_explicit_without_annualizing():
    rows = [period("annual", "2023-01-01", "2023-12-31"),
            period("six", "2024-01-01", "2024-06-30"),
            period("jul", "2024-07-01", "2024-07-31"),
            period("sep", "2024-09-01", "2024-09-30")]
    group = build_period_coverage(rows)[0]
    grains = {record["observation_id"]: record["grain"] for record in group["known_periods"]}
    assert grains == {"annual": "12_month_period", "six": "6_month_period", "jul": "monthly", "sep": "monthly"}
    assert group["available_start"] == "2023-01-01" and group["available_end"] == "2024-09-30"
    assert len(group["coverage_intervals"]) == 2
    assert group["gaps"][0]["start"] == "2024-08-01"
    assert group["gaps"][0]["end"] == "2024-08-31"
    assert group["aggregation_performed"] is False
    assert all("value" not in record for record in group["known_periods"])
    # Non-calendar dates remain explicit, even if their duration resembles a quarter.
    arbitrary = build_period_coverage([period("custom", "2024-01-15", "2024-04-14")])[0]
    assert arbitrary["known_periods"][0]["grain"] == "date_interval"


def test_annual_monthly_overlap_is_not_summed_and_missing_values_have_separate_coverage():
    rows = [period("annual", "2024-01-01", "2024-12-31"),
            period("jan", "2024-01-01", "2024-01-31"),
            period("feb", "2024-02-01", "2024-02-29", value=None, normalization_status="missing")]
    group = build_period_coverage(rows)[0]
    assert len(group["coverage_intervals"]) == 1
    assert group["gaps"] == []
    assert {(item["coarser_observation_id"], item["finer_observation_id"]) for item in group["overlaps"]} == {("annual", "jan"), ("annual", "feb")}
    assert group["candidate_value_status_counts"] == {"normalized_value_available": 2, "missing": 1}
    assert "feb" not in group["candidate_value_coverage_intervals"][0]["observation_ids"]


def test_unknown_ttm_labels_do_not_turn_into_month_end_dates():
    rows = [period("ttm", period_kind="unknown", period_label="TTM Jun 2026", provider="pitchbook", scope=None),
            period("quarterlabel", period_kind="unknown", period_label="Sep 2025", provider="pitchbook", scope=None)]
    group = build_period_coverage(rows)[0]
    assert group["available_start"] is None and group["available_end"] is None
    assert group["coverage_intervals"] == group["known_periods"] == []
    assert {item["period_label"] for item in group["unresolved_periods"]} == {"TTM Jun 2026", "Sep 2025"}
    assert all(item["period_start"] is None and item["period_end"] is None for item in group["unresolved_periods"])
    assert "scope" in group["unknown_context_fields"]


def test_instant_cash_is_a_closing_balance_not_a_flow_grain():
    group = build_period_coverage([
        period("cash-dec", end="2023-12-31", period_kind="instant", metric_key="orbis.cash_and_cash_equivalents"),
        period("cash-jun", end="2024-06-30", period_kind="instant", metric_key="orbis.cash_and_cash_equivalents"),
    ])[0]
    assert group["known_periods"] == group["coverage_intervals"] == group["gaps"] == []
    assert group["available_start"] is None and group["available_end"] is None
    assert [item["date"] for item in group["closing_dates"]] == ["2023-12-31", "2024-06-30"]
    assert all("grain" not in item for item in group["instant_periods"])
