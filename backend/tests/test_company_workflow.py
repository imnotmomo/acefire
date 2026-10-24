"""Offline Member B → DuckDB → Member C report workflows with real sources."""
from __future__ import annotations

import hashlib
import os
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.intake import ExtractedClaim
from app.main import create_app
from app.schemas import CIRCLE
from app.store import Store


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    repository = Path(__file__).resolve().parents[2]
    data = Path(os.environ.get("DATA_ROOT", str(repository / "data" / "additional-cases")))
    if data.name == CIRCLE.deal_id:
        data = data.parent
    akta = Path(os.environ.get("AKTA_DATA_ROOT", str(repository / "data" / "akta")))
    if not (data / CIRCLE.deal_id).is_dir() or not akta.is_dir():
        pytest.skip("Set DATA_ROOT and AKTA_DATA_ROOT to the existing offline company fixtures")
    monkeypatch.setenv("SOURCE_CACHE_DIR", str(tmp_path / "private-source-cache"))
    database = tmp_path / "workspace.duckdb"
    store = Store(str(database))

    def no_network_client():
        raise AssertionError("The saved-data company workflow must not contact Akta")

    app = create_app(store=store, source_root=data, saved_akta_root=akta, akta_factory=no_network_client)
    with TestClient(app) as client:
        for endpoint in ("akta-saved", "local"):
            response = client.post(f"/deals/{CIRCLE.deal_id}/ingest/{endpoint}")
            assert response.status_code == 200, response.text
        yield client, store, database


def _report(client):
    response = client.get(f"/deals/{CIRCLE.deal_id}/report")
    assert response.status_code == 200, response.text
    return response.json()


def _pdf_fixture() -> bytes:
    """A real one-page PDF, with two deterministic fixture text lines."""
    stream = b"BT /F1 12 Tf 72 720 Td (ARR reached $12M.) Tj 0 -18 Td (Synthetic fixture; explicit source units: million USD.) Tj ET\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    content = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, value in enumerate(objects, start=1):
        offsets.append(len(content))
        content.extend(f"{number} 0 obj\n".encode() + value + b"\nendobj\n")
    xref = len(content)
    content.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        content.extend(f"{offset:010d} 00000 n \n".encode())
    content.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(content)


def test_offline_company_report_and_exact_orbis_arithmetic_in_duckdb(workspace):
    client, store, database = workspace
    assert database.is_file()
    # Both imports are replays of existing offline bytes, not provider requests.
    for endpoint in ("akta-saved", "local"):
        replay = client.post(f"/deals/{CIRCLE.deal_id}/ingest/{endpoint}")
        assert replay.status_code == 200, replay.text
        assert replay.json()["snapshots_added"] == 0
        assert replay.json()["observations_added"] == 0

    response = client.post(f"/deals/{CIRCLE.deal_id}/replay/balance-sheet", json={"period_end": "2024-12-31"})
    assert response.status_code == 200, response.text
    calculation = response.json()
    assert calculation["status"] == "succeeded"
    assert calculation["value"] == "45834409000"

    report = _report(client)
    assert report["company"]["primary_provider"] == "akta"
    assert report["company"]["primary_company_id"] == "000004j"
    assert len(report["primary_profile"]["records"]) == 2
    fields = report["primary_profile"]["field_lineage"]["fields"]
    assert fields and all(field["source"]["locator"]["pointer"].startswith("/response/data/") for field in fields)
    assert len(report["reported_metrics"]) == report["summary"]["reported_metric_count"] == 436
    sources = {source["snapshot_id"]: source for source in report["source_files"]}
    for record in report["reported_metrics"]:
        observation, binding = record["observation"], record["source"]
        assert binding["snapshot_id"] == observation["snapshot_id"]
        assert binding["sha256"] == sources[binding["snapshot_id"]]["sha256"]
        assert binding["file_name"]
        assert binding["locator"] == observation["locator"]
        assert binding["preview_url"] == f"/sources/{binding['snapshot_id']}/file"
    estimates = [record["observation"] for record in report["reported_metrics"] if record["observation"]["provider"] == "akta"]
    assert len(estimates) == 1 and estimates[0]["value"] is None

    assert len(report["calculations"]) == 1
    graph = report["calculations"][0]
    assert graph["calculation"]["id"] == calculation["id"]
    assert len(graph["nodes"]) == 4 and len(graph["edges"]) == 4
    assert len(graph["sources"]) == 1
    steps = {step["source"]["locator"]["cell"]: step for step in graph["explanation_steps"] if step["kind"] == "source_normalization"}
    assert set(steps) == {"I49", "I53"}
    expected = {"I49": ("669460", "669460000"), "I53": ("45164949", "45164949000")}
    for cell, (raw, normalized) in expected.items():
        step = steps[cell]
        assert step["raw_value"] == raw
        assert step["scale_multiplier"] == "1000"
        assert step["normalized_value"] == normalized
        assert step["source"]["locator"]["unit_cell"] == "I41"
        assert step["source"]["locator"]["period_cell"] == "I40"
    preview = client.get(graph["sources"][0]["preview_url"])
    assert preview.status_code == 200
    assert hashlib.sha256(preview.content).hexdigest() == graph["sources"][0]["sha256"]
    assert preview.content.startswith(b"PK")
    assert store.company(CIRCLE.deal_id).primary_company_id == "000004j"


def test_b_pdf_upload_and_extracted_claim_reaches_frontend_report_with_lines(workspace):
    client, _, _ = workspace
    pdf = _pdf_fixture()
    uploaded = client.post(f"/deals/{CIRCLE.deal_id}/files?provider=pitchbook",
                           files={"file": ("B-provided-deck.pdf", pdf, "application/pdf")})
    assert uploaded.status_code == 200, uploaded.text
    source = uploaded.json()["sources"][0]
    quote = "ARR reached $12M.\nSynthetic fixture; explicit source units: million USD."
    packet = ExtractedClaim(
        source_id=source["id"], metric_key="deck.reported_arr", label="Reported ARR",
        raw_value="12", unit="USD", currency="USD", scale_multiplier=Decimal("1000000"),
        normalization_basis="Synthetic PDF explicitly states million USD; normalize its reported 12 by 1000000.",
        locator={"kind": "pdf_page", "page": 1, "line_start": 1, "line_end": 2,
                 "extraction_basis": "fixture: deterministic two-line PDF text stream v1",
                 "extracted_line_count": 2, "quote": quote},
        extractor_version="b-workflow-fixture-v1", verification_status="source_located",
    )
    response = client.post(f"/deals/{CIRCLE.deal_id}/claims/batch", json={"claims": [packet.model_dump(mode="json")]})
    assert response.status_code == 200, response.text
    observation = response.json()["observations"][0]
    assert observation["raw_value"] == "12"
    assert observation["value"] == "12000000"
    assert observation["scale_multiplier"] == "1000000"
    assert observation["provider"] == source["provider"] == "pitchbook"
    assert observation["snapshot_id"] == source["id"]
    assert observation["definition_key"] is None
    assert observation["locator"]["quote"] == quote
    repeated = client.post(f"/deals/{CIRCLE.deal_id}/claims/batch", json={"claims": [packet.model_dump(mode="json")]})
    assert repeated.status_code == 200 and repeated.json()["observations_added"] == 0

    report = _report(client)
    record = next(record for record in report["reported_metrics"] if record["observation"]["id"] == observation["id"])
    assert record["observation"]["value"] == "12000000"
    binding = record["source"]
    assert binding["file_name"] == "B-provided-deck.pdf"
    assert binding["sha256"] == hashlib.sha256(pdf).hexdigest()
    assert binding["ingestion_channel"] == "user_upload"
    assert binding["data_role"] == "supplemental_evidence" and binding["visibility"] == "deal_private"
    assert binding["location"]["page"] == 1
    assert binding["location"]["line_start"] == 1 and binding["location"]["line_end"] == 2
    assert binding["locator"]["quote"] == quote
    assert binding["locator"]["extraction_basis"] == packet.locator["extraction_basis"]
    assert client.get(binding["preview_url"]).content == pdf
    assert report["company"]["primary_company_id"] == "000004j"
