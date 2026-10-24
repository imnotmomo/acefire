"""Numeric conflicts are frontend flags, not approval/selection workflows."""
from __future__ import annotations

import calendar
import csv
from datetime import date
from decimal import Decimal
import io
import json
import os
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.intake import ExtractedClaim
from app.main import create_app
from app.schemas import CIRCLE
from app.store import Store


@pytest.fixture
def client(tmp_path, monkeypatch):
    repository = Path(__file__).resolve().parents[2]
    data = Path(os.environ.get("DATA_ROOT", str(repository / "data" / "additional-cases")))
    if data.name == CIRCLE.deal_id:
        data = data.parent
    akta = Path(os.environ.get("AKTA_DATA_ROOT", str(repository / "data" / "akta")))
    if not (data / CIRCLE.deal_id).is_dir() or not akta.is_dir():
        pytest.skip("Set DATA_ROOT and AKTA_DATA_ROOT to the existing offline fixtures")
    monkeypatch.setenv("SOURCE_CACHE_DIR", str(tmp_path / "private-files"))

    def no_network():
        raise AssertionError("Conflict tests use saved data only")

    store = Store(str(tmp_path / "conflicts.duckdb"))
    app = create_app(store=store, source_root=data, saved_akta_root=akta, akta_factory=no_network)
    try:
        with TestClient(app) as value:
            for endpoint in ("akta-saved", "local"):
                response = value.post(f"/deals/{CIRCLE.deal_id}/ingest/{endpoint}")
                assert response.status_code == 200, response.text
            yield value
    finally:
        store.close()


def _upload_revenue_claims(client, annual):
    rows = [("annual", date(2024, 1, 1), date(2024, 12, 31), str(annual))]
    rows.extend((f"month-{month:02d}", date(2024, month, 1), date(2024, month, calendar.monthrange(2024, month)[1]), "100") for month in range(1, 13))
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(["period_label", "period_start", "period_end", "recognized_revenue_usd"])
    for label, start, end, amount in rows:
        writer.writerow([label, start.isoformat(), end.isoformat(), amount])
    content = stream.getvalue().encode()
    response = client.post(f"/deals/{CIRCLE.deal_id}/files?provider=uploaded", files={"file": ("revenue-source.csv", content, "text/csv")})
    assert response.status_code == 200, response.text
    source = response.json()["sources"][0]
    claims = []
    for row_number, (label, start, end, amount) in enumerate(rows, start=2):
        packet = ExtractedClaim(
            source_id=source["id"], metric_key="uploaded.recognized_revenue", label="Recognized revenue",
            raw_value=amount, unit="USD", currency="USD", scale_multiplier=Decimal("1"),
            normalization_basis="The recognized_revenue_usd column explicitly stores USD, with scale one.",
            definition_key="recognized_revenue", scope="consolidated", accounting_basis="US_GAAP", scenario="actual",
            period_kind="duration", period_start=start, period_end=end, period_label=label,
            locator={"kind": "csv_row", "row": row_number, "column": "recognized_revenue_usd",
                     "quote": f"{label},{start.isoformat()},{end.isoformat()},{amount}"},
            verification_status="source_located", extractor_version="b-csv-conflict-fixture-v1",
        )
        claims.append(packet.model_dump(mode="json"))
    response = client.post(f"/deals/{CIRCLE.deal_id}/claims/batch", json={"claims": claims})
    assert response.status_code == 200, response.text
    observations = response.json()["observations"]
    assert len(observations) == 13
    return source, observations


def _dictionaries(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from _dictionaries(item)
    elif isinstance(value, list):
        for item in value:
            yield from _dictionaries(item)


@pytest.mark.parametrize("annual, expected_flag", [(1300, True), (1200, False)])
def test_dynamic_total_returns_conflict_flag_without_blocking_or_overwriting(client, annual, expected_flag):
    source, originals = _upload_revenue_claims(client, annual)
    annual_row = next(row for row in originals if row["period_label"] == "annual")
    monthly_rows = [row for row in originals if row["period_label"].startswith("month-")]
    response = client.post(f"/deals/{CIRCLE.deal_id}/calculate/revenue-dynamic", json={
        "input_ids": [row["id"] for row in originals], "target_start": "2024-01-01", "target_end": "2024-12-31",
    })
    # A numeric conflict must not turn a valid calculation into a 409 or require approval.
    assert response.status_code == 200, response.text
    calculated = response.json()
    assert calculated["status"] == "succeeded" and calculated["value"] == "1200"
    assert set(calculated["input_ids"]) == {row["id"] for row in monthly_rows}
    assert annual_row["id"] not in calculated["input_ids"]
    assert calculated["conflict_numbers"] is expected_flag
    assert isinstance(calculated["conflicts"], list)
    if expected_flag:
        assert calculated["conflicts"]
        serialized = json.dumps(calculated["conflicts"], sort_keys=True)
        assert '"1300"' in serialized and '"1200"' in serialized
        assert source["id"] in serialized
        assert annual_row["id"] in serialized
        references = [item for item in _dictionaries(calculated["conflicts"]) if item.get("snapshot_id") == source["id"] and "sha256" in item]
        assert references
        assert all(item["sha256"] == source["sha256"] for item in references)
        assert any(item.get("file_name") == "revenue-source.csv" for item in references)
        assert any(item.get("locator", {}).get("kind") == "csv_row" for item in references)
    else:
        assert calculated["conflicts"] == []

    runs = client.get(f"/deals/{CIRCLE.deal_id}/calculations")
    assert runs.status_code == 200
    stored = next(run for run in runs.json() if run["id"] == calculated["id"])
    assert stored["conflict_numbers"] is expected_flag
    graph_response = client.get(f"/calculations/{calculated['id']}/lineage")
    assert graph_response.status_code == 200, graph_response.text
    graph = graph_response.json()
    assert graph["conflict_numbers"] is expected_flag
    assert len(graph["inputs"]) == 12

    report_response = client.get(f"/deals/{CIRCLE.deal_id}/report")
    assert report_response.status_code == 200, report_response.text
    report = report_response.json()
    assert report["conflict_numbers"] is expected_flag
    report_run = next(run for run in report["calculations"] if run["calculation"]["id"] == calculated["id"])
    assert report_run["conflict_numbers"] is expected_flag
    assert {item["source"]["snapshot_id"] for item in report_run["inputs"]} == {source["id"]}

    # Keep both reported and calculated alternatives; do not replace stored source facts.
    current = client.get(f"/deals/{CIRCLE.deal_id}/observations?provider=uploaded")
    assert current.status_code == 200
    current_rows = [row for row in current.json() if row["snapshot_id"] == source["id"]]
    assert len(current_rows) == 13
    assert {row["id"]: row for row in current_rows} == {row["id"]: row for row in originals}
    assert next(row for row in current_rows if row["id"] == annual_row["id"])["value"] == str(annual)
    paths = client.get("/openapi.json").json()["paths"]
    assert not any("resolution" in path or "/resolve" in path for path in paths)
