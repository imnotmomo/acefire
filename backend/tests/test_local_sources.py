from __future__ import annotations

import hashlib
import json
import os
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from app.local_sources import _decimal, ingest_local_circle


@pytest.fixture(scope="module")
def circle_root() -> Path:
    root = Path(os.environ.get("DATA_ROOT", str(Path(__file__).resolve().parents[2] / "data" / "additional-cases")))
    if root.name != "circle-2025-ipo":
        root = root / "circle-2025-ipo"
    if not root.is_dir():
        pytest.skip("Local Circle source fixture is unavailable")
    return root


@pytest.fixture(scope="module")
def result(circle_root):
    return ingest_local_circle(circle_root)


def test_native_xml_precision_and_exact_source_locator(result):
    revenue = next(o for o in result.observations if o.metric_key == "orbis.operating_revenue" and o.period_end == date(2025, 12, 31))
    assert revenue.raw_value == "2746642"
    assert revenue.value == Decimal("2746642000")
    assert revenue.period_start == date(2025, 1, 1)
    assert revenue.unit == "USD" and revenue.scale_multiplier == Decimal("1000")
    assert revenue.locator["sheet"] == "CIRCLE_INTERNET_GROUP__INC"
    assert revenue.locator["cell"] == "F81"
    assert revenue.locator["unit_cell"] == "F41"
    assert revenue.locator["period_cell"] == "F40"
    ebit = next(o for o in result.observations if o.locator.get("cell") == "F86")
    assert ebit.raw_value == "-91141.9999999998"
    assert ebit.value == Decimal("-91141999.9999998000")


def test_ratio_and_stock_are_not_scaled_as_monetary_flows(result):
    margin = next(o for o in result.observations if o.locator.get("cell") == "F129")
    assert margin.value == Decimal("-0.03746")
    assert margin.unit == "ratio" and margin.currency is None
    ratio = next(o for o in result.observations if o.locator.get("cell") == "F147")
    assert ratio.value == Decimal("1.033")
    assets = next(o for o in result.observations if o.locator.get("cell") == "F58")
    assert assets.period_kind == "instant" and assets.period_start is None
    assert assets.value == Decimal("78713207000")


def test_missing_cells_and_unknown_definitions_survive(result):
    missing = next(o for o in result.observations if o.locator.get("cell") == "P58")
    assert missing.raw_value == "n.a."
    assert missing.normalization_status == "missing" and missing.value is None
    assert all(o.definition_key is None and o.scenario == "unknown" for o in result.observations)
    cash_flow = next(o for o in result.observations if o.locator.get("cell") == "F106")
    assert cash_flow.metric_key == "orbis.net_income_before_da"
    assert any("not operating cash flow" in n for n in cash_flow.notes)


def test_pitchbook_months_are_not_fabricated_into_dates(result):
    rows = [o for o in result.observations if o.provider == "pitchbook"]
    assert len(rows) == 95
    assert all(o.period_kind == "unknown" and o.period_start is None and o.period_end is None and o.scope is None for o in rows)
    revenue = next(o for o in rows if o.metric_key == "pitchbook.total_revenue" and o.period_label == "Dec 2025")
    assert revenue.value == Decimal("2746642000")
    assert revenue.locator["kind"] == "json_pointer"
    assert "source_png_relative_path" not in revenue.locator  # No TTM income PNG was saved.
    cash_flow = next(o for o in rows if o.metric_key == "pitchbook.cash_flow_operating_indirect")
    assert cash_flow.locator["source_png_relative_path"].startswith("pitchbook/PitchBook_Circle")
    eps = next(o for o in rows if o.metric_key == "pitchbook.eps_analyst_normalized")
    assert eps.value is None and eps.scale_multiplier is None and eps.normalization_status == "unresolved"
    missing_growth = [o for o in rows if o.metric_key == "pitchbook.revenue_growth_percent" and o.normalization_status == "missing"]
    assert len(missing_growth) == 2 and all(o.value is None for o in missing_growth)


def test_native_vs_manual_inventory_and_idempotency(circle_root, result):
    assert len([s for s in result.snapshots if s.local_path.endswith(".pdf")]) == 2
    assert len([s for s in result.snapshots if s.local_path.endswith(".png")]) == 5
    manual = [s for s in result.snapshots if s.source_kind == "manual_capture_snapshot_only"]
    assert len(manual) == 2
    assert not any(o.snapshot_id in {s.id for s in manual} for o in result.observations)
    assert not any(o.provider == "akta" for o in result.observations)
    assert result.model_dump(mode="json") == ingest_local_circle(circle_root).model_dump(mode="json")
    for s in result.snapshots:
        assert hashlib.sha256(Path(s.local_path).read_bytes()).hexdigest() == s.sha256


def test_identity_from_ids_not_workbook_filename(circle_root, tmp_path):
    (tmp_path / "orbis").mkdir()
    original = next((circle_root / "orbis").glob("*.xlsx"))
    renamed = tmp_path / "orbis" / "entirely-unrelated-name.xlsx"
    renamed.write_bytes(original.read_bytes())
    accepted = ingest_local_circle(tmp_path)
    assert any(o.provider == "orbis" for o in accepted.observations)
    bad = tmp_path / "orbis" / "Circle_US_Orbis_Summary_Safari_20261023.xlsx"
    with zipfile.ZipFile(original) as source, zipfile.ZipFile(bad, "w") as destination:
        for member in source.infolist():
            content = source.read(member.filename)
            if member.filename == "xl/sharedStrings.xml":
                content = content.replace(b"US992840247", b"US000000000").replace(b"674047230", b"000000000")
            destination.writestr(member, content)
    renamed.unlink()
    rejected = ingest_local_circle(tmp_path)
    assert not rejected.observations
    assert any("no verified Circle identity" in w for w in rejected.warnings)


def test_raw_decimal_parser_preserves_financial_signs_and_missing():
    assert _decimal("(1,234.500)") == Decimal("-1234.500")
    assert _decimal("-3.75%") == Decimal("-3.75")
    assert _decimal("n.a.") is None
    assert _decimal("n.s.") is None
    assert _decimal("Infinity") is None


def test_invalid_case_is_not_silently_assigned_to_circle(tmp_path):
    (tmp_path / "provenance.json").write_text(json.dumps({"case_id": "other-company"}))
    with pytest.raises(ValueError, match="different case"):
        ingest_local_circle(tmp_path)


def test_conflicting_derived_numeric_field_is_quarantined(circle_root, tmp_path):
    (tmp_path / "pitchbook").mkdir()
    original = circle_root / "pitchbook" / "circle_ttm_financial_observations.json"
    document = json.loads(original.read_text())
    document["observations"][0]["display_numeric_value"] = "999999"
    (tmp_path / "pitchbook" / original.name).write_text(json.dumps(document))
    imported = ingest_local_circle(tmp_path)
    row = next(o for o in imported.observations if o.locator.get("pointer") == "/observations/0")
    assert row.quarantined
    assert row.normalization_status == "unresolved"
    assert row.value is None
