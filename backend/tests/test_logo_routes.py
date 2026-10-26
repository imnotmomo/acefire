"""Actual creation/intake hooks cache artwork once without changing evidence."""
import io
import time

from fastapi.testclient import TestClient
from PIL import Image

from app.company_logos import CompanyLogoService
from app.main import create_app
from app.store import Store


def png():
    output = io.BytesIO()
    Image.new('RGB', (32, 32), '#526db5').save(output, format='PNG')
    return output.getvalue()


def await_ready(client, deal):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        state = client.get(f'/deals/{deal}/logo').json()['logo']
        if state and state['status'] == 'ready':
            return state
        time.sleep(.02)
    raise AssertionError(f'Logo did not become ready: {state}')


def test_creation_caches_only_once_and_asset_scope_hash_and_etag_survive_reads(tmp_path, monkeypatch):
    monkeypatch.setenv('UPLOAD_CACHE_ROOT', str(tmp_path / 'uploads'))
    calls = []
    logos = CompanyLogoService(tmp_path / 'logos', fetcher=lambda domain: (calls.append(domain), png())[1])
    store = Store(tmp_path / 'data.duckdb')
    body = {'deal_id': 'new-logo', 'name': 'Synthetic logo fixture', 'website': 'https://example.com/company'}
    with TestClient(create_app(store=store, logo_service=logos)) as client:
        created = client.post('/deals', json=body)
        assert created.status_code == 201, created.text
        company = created.json()['company']
        assert company['domain'] == 'example.com'
        state = await_ready(client, 'new-logo')
        for _ in range(3):
            assert client.post('/deals', json=body).status_code == 201
            assert client.get('/deals').status_code == 200
            assert client.get('/deals/new-logo/logo').json()['logo'] == state
        assert calls == ['example.com']
        image = client.get(state['asset_path'])
        assert image.status_code == 200 and image.headers['content-type'] == 'image/png'
        assert image.content.startswith(b'\x89PNG\r\n\x1a\n')
        assert client.get(state['asset_path'], headers={'If-None-Match': image.headers['etag']}).status_code == 304
        assert client.get('/deals/new-logo/logo/image/' + '0' * 64).status_code == 404
        assert client.get('/deals/foreign/logo/image/' + state['sha256']).status_code == 404
        assert client.post('/deals/new-logo/logo/website', json={'website': 'changed.example.com'}).status_code == 409
        assert client.get('/deals/new-logo/report').json()['source_files'] == []
    reopened = Store(tmp_path / 'data.duckdb')
    cached = CompanyLogoService(tmp_path / 'logos', fetcher=lambda domain: (_ for _ in ()).throw(AssertionError('No second lookup')))
    with TestClient(create_app(store=reopened, logo_service=cached)) as client:
        assert client.get('/deals/new-logo/logo').json()['logo'] == state
        assert client.get(state['asset_path']).content == image.content
    assert calls == ['example.com']


def test_first_processed_identity_file_triggers_only_its_eligible_company(tmp_path, monkeypatch):
    monkeypatch.setenv('UPLOAD_CACHE_ROOT', str(tmp_path / 'uploads'))
    calls = []
    logos = CompanyLogoService(tmp_path / 'logos', fetcher=lambda domain: (calls.append(domain), png())[1])
    store = Store(tmp_path / 'data.duckdb')
    app = create_app(store=store, logo_service=logos)
    # Reuse the actual upload worker with a deterministic local extraction result.
    from app.workspace_routes import UploadJobs
    original = UploadJobs.run
    def deterministic_run(self, path, job, company, source, adapter_observations):
        self.processor = lambda *args: {'snapshot_id': source.id, 'observations': 0, 'claims': 0, 'warnings': []}
        return original(self, path, job, company, source, adapter_observations)
    monkeypatch.setattr(UploadJobs, 'run', deterministic_run)
    with TestClient(app) as client:
        assert client.post('/deals', json={'deal_id': 'first-file', 'name': 'Synthetic identity fixture'}).status_code == 201
        assert client.get('/deals/first-file/logo').json()['logo']['status'] == 'awaiting_website'
        assert calls == []
        data = b'Company: Synthetic identity fixture\nWebsite: https://example.com\n'
        receipt = client.post('/deals/first-file/uploads', files={'file': ('identity.txt', data, 'text/plain')})
        assert receipt.status_code == 202, receipt.text
        state = await_ready(client, 'first-file')
        assert calls == ['example.com']
        assert client.get(state['asset_path']).status_code == 200
        report = client.get('/deals/first-file/report').json()
        assert len(report['source_files']) == 1 and report['company']['domain'] == ''


def test_failed_durable_reservation_keeps_creation_retryable_without_partial_company(tmp_path, monkeypatch):
    monkeypatch.setenv('UPLOAD_CACHE_ROOT', str(tmp_path / 'uploads'))
    class UnavailableLogoCache:
        def prepare(self, company): raise PermissionError('private cache unavailable')
        def commit(self, company): return None
        def public(self, company): return None
        def close(self): pass
    with TestClient(create_app(store=Store(tmp_path / 'data.duckdb'), logo_service=UnavailableLogoCache())) as client:
        created = client.post('/deals', json={'deal_id': 'saved-company', 'name': 'Synthetic cache fallback'})
        assert created.status_code == 503
        assert all(row['deal_id'] != 'saved-company' for row in client.get('/deals').json()['companies'])
        assert client.post('/deals', json={'name': 'Private address', 'website': 'http://127.0.0.1'}).status_code == 422
