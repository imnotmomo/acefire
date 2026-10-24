from decimal import Decimal

import pytest

from app.lineage import build_calculation_lineage, build_profile_lineage
from app.schemas import CIRCLE, Calculation, Observation, SourceSnapshot


def source(snapshot_id="sheet", **overrides):
    fields = dict(
        id=snapshot_id, deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        provider="orbis", source_kind="user_uploaded_xlsx",
        source_uri="file:///private/financials.xlsx", local_path="/private/financials.xlsx",
        sha256="a" * 64, original_filename="Circle financials.xlsx",
        ingestion_channel="user_upload", data_role="supplemental_evidence",
    )
    fields.update(overrides)
    return SourceSnapshot(**fields)


def observation(identifier, value, cell, definition=None):
    return Observation(
        id=identifier, deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        snapshot_id="sheet", provider="orbis", metric_key="orbis." + identifier,
        raw_label=identifier, raw_value=value, value=Decimal(value), unit="USD",
        definition_key=definition, normalization_status="confirmed",
        locator={"kind": "xlsx_cell", "sheet": "Summary", "cell": cell,
                 "formula": "SUM(F1:F3)" if identifier == "a" else None},
    )


def calculation(**overrides):
    fields = dict(
        id="calc", deal_id=CIRCLE.deal_id, metric_key="sum", function_key="sum",
        formula="a + b", status="succeeded", value=Decimal("3.3000"), unit="USD",
        input_ids=["a", "b"], input_snapshots=["sheet"],
    )
    fields.update(overrides)
    return Calculation(**fields)


def test_calculation_graph_binds_exact_values_locators_and_file_once():
    a = observation("a", "1.1000", "F81", "reviewed.revenue")
    b = observation("b", "2.2000", "F82")
    result = build_calculation_lineage(calculation(), [a, b], [source()])
    assert result["calculation"]["value"] == "3.3000"
    assert result["calculation"]["formula"] == "a + b"
    assert len(result["nodes"]) == 4  # one file, two inputs, one calculation
    assert len(result["edges"]) == 4
    assert len(result["sources"]) == 1
    first, second = result["inputs"]
    assert first["observation"]["value"] == "1.1000"
    assert first["observation"]["raw_value"] == "1.1000"
    assert first["source"]["locator"]["cell"] == "F81"
    assert first["source"]["locator"]["formula"] == "SUM(F1:F3)"
    assert first["source"]["file_name"] == "Circle financials.xlsx"
    assert first["source"]["sha256"] == "a" * 64
    assert first["source"]["ingestion_channel"] == "user_upload"
    assert first["source"]["preview_url"] == "/sources/sheet/file"
    assert first["input_role"] == "reviewed.revenue"
    assert second["input_role"] == "input_2"
    graph_ids = {node["id"] for node in result["nodes"]}
    assert all(edge["source"] in graph_ids and edge["target"] in graph_ids for edge in result["edges"])
    # Presentation never recalculates or mutates stored values.
    assert a.value == Decimal("1.1000") and a.locator["cell"] == "F81"


def test_absent_references_fail_explicitly_and_empty_failure_keeps_reasons():
    with pytest.raises(ValueError, match="Missing calculation input"):
        build_calculation_lineage(calculation(input_snapshots=[]), [], [])
    with pytest.raises(ValueError, match="Missing source snapshot"):
        build_calculation_lineage(calculation(input_ids=["a"], input_snapshots=[]), [observation("a", "1", "F1")], [])
    result = build_calculation_lineage(calculation(status="insufficient_data", value=None, input_ids=[], input_snapshots=[], reasons=["missing_revenue"]), [], [])
    assert result["inputs"] == result["nodes"] == result["edges"] == []
    assert result["reasons"] == ["missing_revenue"]


def test_lineage_rejects_cross_deal_source_and_conflicting_snapshot_identity():
    row = observation("a", "1", "F1")
    calc = calculation(input_ids=["a"], input_snapshots=[])
    with pytest.raises(ValueError, match="another deal"):
        build_calculation_lineage(calc, [row], [source(deal_id="other")])
    with pytest.raises(ValueError, match="Conflicting snapshot"):
        build_calculation_lineage(calc, [row], [source(), source(sha256="b" * 64)])


def test_profile_fields_preserve_conflicts_and_actual_wrapper_pointers():
    first = source("first", provider="akta", source_kind="saved_provider_response", original_filename="Circle.json",
                   ingestion_channel="provider_api", data_role="primary_company_data", context={"json_pointer_base": "/response/data"})
    second = source("second", provider="akta", source_kind="saved_provider_response", original_filename="Circle_financial.json",
                    ingestion_channel="provider_api", data_role="primary_company_data", context={"json_pointer_base": "/response/data"})
    result = build_profile_lineage([
        {"snapshot_id": "first", "provider": "akta", "profile": {"firmographic": {"legal_name": "Circle"}, "a/b~c": None}},
        {"snapshot_id": "second", "provider": "akta", "profile": {"firmographic": {"legal_name": "Circle Internet Group, Inc."}}},
    ], [first, second])
    legal_names = [field for field in result["fields"] if field["field_path"] == "/firmographic/legal_name"]
    assert [field["value"] for field in legal_names] == ["Circle", "Circle Internet Group, Inc."]
    assert all(field["source"]["locator"]["pointer"] == "/response/data/firmographic/legal_name" for field in legal_names)
    escaped = next(field for field in result["fields"] if field["field_path"] == "/a~1b~0c")
    assert escaped["value"] is None
    assert escaped["source"]["locator"]["pointer"] == "/response/data/a~1b~0c"
    assert len(result["sources"]) == 2


def test_profile_lineage_requires_snapshot_and_wrapper_evidence():
    with pytest.raises(ValueError, match="Missing profile source"):
        build_profile_lineage([{"snapshot_id": "absent", "profile": {}}], [])
    with pytest.raises(ValueError, match="explicit JSON pointer base"):
        build_profile_lineage([{"snapshot_id": "sheet", "profile": {"name": "Circle"}}], [source()])
