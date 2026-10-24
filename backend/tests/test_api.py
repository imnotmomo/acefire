import json
import os
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.main import create_app
from app.schemas import CIRCLE
from app.store import Store

DATA = Path(os.environ.get('DATA_ROOT', str(Path(__file__).resolve().parents[2] / 'data' / 'additional-cases')))


@pytest.fixture
def workspace(tmp_path):
    store = Store(str(tmp_path / 'ledger.duckdb'))
    akta = Path(os.environ.get('AKTA_DATA_ROOT', str(Path(__file__).resolve().parents[2] / 'data' / 'akta')))
    app = create_app(store=store, source_root=DATA, saved_akta_root=akta)
    with TestClient(app) as client:
        response = client.post('/deals/circle-2025-ipo/ingest/local')
        assert response.status_code == 200, response.text
        yield client, store, response.json()


def test_real_local_import_is_idempotent_and_readable(workspace):
    client, store, first = workspace
    assert first['observations_added'] > 95
    second = client.post('/deals/circle-2025-ipo/ingest/local').json()
    assert second['snapshots_added'] == second['observations_added'] == 0
    overview = client.get('/deals/circle-2025-ipo/overview').json()
    assert overview['providers']['pitchbook']['observations'] == 95
    assert overview['providers']['akta']['snapshots'] == 0
    claims = client.get('/deals/circle-2025-ipo/claims?provider=orbis&metric=orbis.operating_revenue').json()
    assert len(claims) == 4
    current = next(c for c in claims if c['period_end'] == '2025-12-31')
    assert Decimal(current['value']) == Decimal('2746642000')
    evidence = client.get(f"/claims/{current['id']}/evidence").json()
    assert evidence['snapshot']['sha256']
    assert evidence['locator']


def test_incompatible_real_sources_do_not_produce_numeric_delta(workspace):
    client, store, _ = workspace
    orbis = store.observations(CIRCLE.deal_id, 'orbis', 'orbis.operating_revenue')[0]
    pitchbook = store.observations(CIRCLE.deal_id, 'pitchbook')[0]
    response = client.post('/deals/circle-2025-ipo/compare', json={'lhs_id': orbis.id, 'rhs_id': pitchbook.id, 'tolerance': '0'})
    assert response.status_code == 200, response.text
    comparison = response.json()
    assert comparison['status'] in {'not_comparable', 'insufficient_evidence'}
    assert comparison['delta'] is None
    assert comparison['reason_codes']


def test_missing_runway_inputs_are_stored_as_a_gap_with_lineage(workspace):
    client, _, _ = workspace
    result = client.post('/deals/circle-2025-ipo/calculate', json={'metric_key': 'runway', 'input_ids': []}).json()
    assert result['status'] == 'insufficient_data'
    assert result['value'] is None
    lineage = client.get(f"/calculations/{result['id']}/lineage").json()
    assert lineage['inputs'] == []
    assert lineage['calculation']['reasons']


def test_missing_deal_is_not_exposed(workspace):
    client, _, _ = workspace
    assert client.get('/deals/another-deal/observations').status_code == 404
    assert client.get('/deals/another-deal/report').status_code == 404


def test_numeric_request_validation(workspace):
    client, store, _ = workspace
    rows = store.observations(CIRCLE.deal_id)[:2]
    for value in ['NaN', '-1', 'Infinity']:
        response = client.post('/deals/circle-2025-ipo/compare', json={'lhs_id': rows[0].id, 'rhs_id': rows[1].id, 'tolerance': value})
        assert response.status_code == 422


def test_user_uploaded_file_is_supplemental_not_a_primary_profile(workspace, tmp_path, monkeypatch):
    client, store, _ = workspace
    monkeypatch.setenv('SOURCE_CACHE_DIR', str(tmp_path / 'uploads'))
    response = client.post('/deals/circle-2025-ipo/files?provider=pitchbook', files={'file': ('financial-note.txt', b'user provided financial note', 'text/plain')})
    assert response.status_code == 200, response.text
    source = response.json()['sources'][0]
    assert source['ingestion_channel'] == 'user_upload'
    assert source['data_role'] == 'supplemental_evidence'
    assert source['visibility'] == 'deal_private'
    assert source['provider'] == 'pitchbook'
    overview = client.get('/deals/circle-2025-ipo/overview').json()
    assert overview['primary_source'] == 'akta'
    assert overview['primary_profile_available'] is False
    assert client.get('/deals/circle-2025-ipo/profiles').json() == []


def test_real_saved_akta_data_is_primary_and_source_bound(workspace):
    client, store, _ = workspace
    response = client.post('/deals/circle-2025-ipo/ingest/akta-saved')
    assert response.status_code == 200, response.text
    assert response.json()['snapshots_added'] == 2
    assert response.json()['observations_added'] == 1
    assert store.company(CIRCLE.deal_id).primary_company_id == '000004j'
    assert len(client.get('/deals/circle-2025-ipo/profiles').json()) == 2
    fields = client.get('/deals/circle-2025-ipo/company-profile')
    assert fields.status_code == 200
    assert 'valuation_estimate' in fields.text and '$25B+' in fields.text
    assert '/response/data/' in fields.text
    second = client.post('/deals/circle-2025-ipo/ingest/akta-saved').json()
    assert second['snapshots_added'] == second['observations_added'] == 0
    # Replaying user-upload fixtures never removes the verified primary source ID.
    assert client.post('/deals/circle-2025-ipo/ingest/local').status_code == 200
    assert store.company(CIRCLE.deal_id).primary_company_id == '000004j'


def test_real_calculation_links_input_numbers_to_exact_file_cells(workspace):
    client, store, _ = workspace
    response = client.post('/deals/circle-2025-ipo/replay/balance-sheet', json={'period_end':'2024-12-31'})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['status'] == 'succeeded'
    assert Decimal(result['value']) == Decimal('45834409000')
    graph = client.get(f"/calculations/{result['id']}/lineage").json()
    assert len(graph['inputs']) == 2
    assert {item['source']['locator']['cell'] for item in graph['inputs']} == {'I49','I53'}
    assert len(graph['sources']) == 1
    assert len(graph['nodes']) == 4
    assert len(graph['edges']) == 4
    preview = client.get(graph['sources'][0]['preview_url'])
    assert preview.status_code == 200
    assert preview.content[:2] == b'PK'


def test_source_file_refuses_changed_bytes(workspace, tmp_path, monkeypatch):
    client, store, _ = workspace
    monkeypatch.setenv('SOURCE_CACHE_DIR', str(tmp_path))
    source = client.post('/deals/circle-2025-ipo/files', files={'file':('note.txt',b'original','text/plain')}).json()['sources'][0]
    Path(source['local_path']).write_bytes(b'changed')
    assert client.get(f"/sources/{source['id']}/file").status_code == 409
