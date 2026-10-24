import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from app.report import build_company_report
from app.schemas import CIRCLE, Calculation, Comparison, Observation, SourceSnapshot


def snapshot(identifier, provider="uploaded", **changes):
    fields = dict(id=identifier, deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
                  provider=provider, source_kind="b_extracted_source", source_uri="file:///room/" + identifier,
                  sha256="a" * 64, original_filename=identifier + ".pdf")
    fields.update(changes)
    return SourceSnapshot(**fields)


def row(identifier, snapshot_id, amount, locator, **changes):
    fields = dict(id=identifier, deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
                  snapshot_id=snapshot_id, provider="uploaded", metric_key="reported." + identifier,
                  raw_label=identifier, raw_value=amount, value=Decimal(amount), unit="USD", currency="USD",
                  normalization_status="confirmed", scale_multiplier=Decimal("1"), normalization_basis="Explicit USD label",
                  scope="consolidated", accounting_basis="US GAAP", period_kind="instant", period_end=date(2025, 12, 31),
                  scenario="actual", verification_status="source_located", locator=locator)
    fields.update(changes)
    return Observation(**fields)


def test_report_keeps_b_pdf_lines_and_every_calculation_and_comparison_source():
    deck = snapshot("deck")
    sheet = snapshot("sheet", source_kind="xlsx", original_filename="Revenue.xlsx")
    primary = snapshot("akta", "akta", source_kind="saved_provider_response", original_filename="Circle.json",
                       ingestion_channel="provider_api", data_role="primary_company_data", context={"json_pointer_base": "/response/data"})
    claimed = row("arr_claim", "deck", "12000000.00", {"kind": "pdf_lines", "page": 18, "line_start": 12, "line_end": 14, "column": "left", "bbox": [1, 2, 3, 4]}, definition_key="arr")
    mrr = row("mrr", "sheet", "800000.00", {"kind": "xlsx_cell", "sheet": "Revenue", "cell": "F4"}, definition_key="active_mrr")
    calc = Calculation(id="arr_run", deal_id=CIRCLE.deal_id, metric_key="arr", function_key="arr_v1", formula="active monthly recurring revenue × 12",
                       status="succeeded", value=Decimal("9600000.00"), unit="USD", input_ids=["mrr"], input_snapshots=["sheet"])
    # This fixture's comparison remains guarded; report must not calculate a new delta.
    comp = Comparison(id="comparison", deal_id=CIRCLE.deal_id, lhs_id="arr_claim", rhs_id="mrr", status="not_comparable", reason_codes=["definition_mismatch"])
    profiles = [{"snapshot_id": "akta", "provider": "akta", "profile": {"firmographic": {"legal_name": CIRCLE.legal_name}}}]
    report = build_company_report(CIRCLE, profiles, [claimed, mrr], [deck, sheet, primary], [calc], [comp])
    binding = next(item for item in report["reported_metrics"] if item["observation"]["id"] == "arr_claim")
    assert binding["source"]["file_name"] == "deck.pdf"
    assert binding["source"]["locator"] == claimed.locator
    assert binding["source"]["location"]["line_start"] == 12
    assert binding["source"]["location"]["line_end"] == 14
    assert binding["source"]["location"]["column"] == "left"
    assert binding["observation"]["value"] == "12000000.00"
    assert report["calculations"][0]["calculation"]["value"] == "9600000.00"
    assert report["calculations"][0]["inputs"][0]["source"]["locator"]["cell"] == "F4"
    assert report["calculations"][0]["inputs"][0]["source"]["location"]["line_start"] is None
    assert report["comparisons"][0]["comparison"]["delta"] is None
    assert report["comparisons"][0]["lhs"]["source"]["snapshot_id"] == "deck"
    assert report["comparisons"][0]["rhs"]["source"]["snapshot_id"] == "sheet"
    profile_field = report["primary_profile"]["field_lineage"]["fields"][0]
    assert profile_field["source"]["locator"]["pointer"] == "/response/data/firmographic/legal_name"
    assert report["summary"]["primary_source_file_count"] == 1
    assert report["summary"]["private_supplemental_file_count"] == 2
    assert report["summary"]["calculation_status_counts"] == {"succeeded": 1}
    assert datetime.fromisoformat(report["generated_at_utc"]).utcoffset().total_seconds() == 0
    repeated = build_company_report(CIRCLE, profiles, [claimed, mrr], [deck, sheet, primary], [calc], [comp])
    assert report["report_id"] == repeated["report_id"]


def test_unknown_locations_and_missing_financial_evidence_remain_explicit():
    observation = row("revenue", "deck", "100.00", {"kind": "pdf_page", "page": 2}, definition_key=None,
                      scenario="unknown", period_kind="unknown", period_end=None, scope=None)
    failed = Calculation(id="missing_arr", deal_id=CIRCLE.deal_id, metric_key="arr", function_key="arr_v1", formula="active monthly recurring revenue × 12",
                         status="insufficient_data", reasons=["active_mrr_missing"])
    report = build_company_report(CIRCLE, [], [observation], [snapshot("deck")], [failed], [])
    assert report["reported_metrics"][0]["source"]["location"]["line_start"] is None
    assert report["reported_metrics"][0]["source"]["location"]["line_end"] is None
    assert report["calculations"][0]["calculation"]["value"] is None
    assert report["calculations"][0]["inputs"] == []
    assert any(gap["code"] == "pdf_line_locations_unknown" for gap in report["gaps"])
    assert report["summary"]["needs_review_count"] == 1
    arr = next(item for item in report["coverage"] if item["metric_key"] == "arr")
    assert arr["missing_definition_keys"] == ["active_mrr"]
    assert "value" not in arr  # Coverage never fills missing financial results.


def test_missing_reference_and_cross_deal_inputs_fail_without_invented_provenance():
    observation = row("value", "absent", "1", {"kind": "pdf_page", "page": 1})
    with pytest.raises(ValueError, match="Missing source snapshot"):
        build_company_report(CIRCLE, [], [observation], [], [], [])
    with pytest.raises(ValueError, match="another deal"):
        build_company_report(CIRCLE, [], [], [snapshot("wrong", deal_id="other")], [], [])
    comparison = Comparison(id="missing", deal_id=CIRCLE.deal_id, lhs_id="absent", rhs_id="other", status="insufficient_evidence")
    with pytest.raises(ValueError, match="Missing comparison observation"):
        build_company_report(CIRCLE, [], [], [], [], [comparison])


def test_real_orbis_inputs_have_exact_source_cell_and_no_inferred_arr():
    from app.local_sources import ingest_local_circle
    root = Path(os.environ.get("DATA_ROOT", "/Users/cc/Downloads/acefire/data/additional-cases"))
    if root.name != "circle-2025-ipo":
        root /= "circle-2025-ipo"
    if not root.is_dir():
        pytest.skip("Local Circle fixture is unavailable")
    imported = ingest_local_circle(root)
    report = build_company_report(imported.company, [], imported.observations, imported.snapshots, [], [])
    revenue = next(item for item in report["reported_metrics"] if item["observation"]["metric_key"] == "orbis.operating_revenue" and item["source"]["locator"].get("cell") == "F81")
    assert revenue["observation"]["value"] == "2746642000"
    assert revenue["observation"]["raw_value"] == "2746642"
    assert revenue["source"]["file_name"].endswith(".xlsx")
    assert revenue["source"]["location"]["sheet"] == "CIRCLE_INTERNET_GROUP__INC"
    assert revenue["source"]["location"]["line_start"] is None
    assert len(revenue["source"]["sha256"]) == 64
    assert not report["calculations"]
    assert all(item["status"] == "no_successful_recorded_calculation" for item in report["coverage"])
