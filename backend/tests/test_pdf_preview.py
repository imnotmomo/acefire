"""Actual PDFium page rasterization, immutable originals and API safety boundaries."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import subprocess
from threading import Barrier, Event
from types import SimpleNamespace

from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter
from pypdf.annotations import Rectangle
from pypdf.generic import DecodedStreamObject, NameObject
import pytest

from app.main import create_app
from app.pdf_preview import MAX_FILE_BYTES, PdfPreviewError, render_pdf_preview
from app.schemas import CIRCLE, IngestionResult, SourceSnapshot
from app.store import Store


def pdf_file(path, *, count=2, width=200, height=300, encrypted=False):
    writer = PdfWriter()
    for number in range(count):
        page = writer.add_blank_page(width=width, height=height)
        stream = DecodedStreamObject()
        color = '1 0 0' if number % 2 == 0 else '0 0 1'
        stream.set_data(f'{color} rg 0 0 {width} {height} re f'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    if encrypted:
        writer.encrypt('fixture-only-password')
    with path.open('wb') as target:
        writer.write(target)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_actual_two_page_pdf_has_distinct_inert_previews_and_original_bytes_are_unchanged(tmp_path):
    path = tmp_path/'original.pdf'
    digest = pdf_file(path)
    original = path.read_bytes()
    first = render_pdf_preview(path, 1, digest)
    second = render_pdf_preview(path, 2, digest)
    assert first['page_count'] == second['page_count'] == 2
    assert first['page'] == 1 and second['page'] == 2
    assert first['png_base64'] != second['png_base64']
    for result, expected in ((first, (255,0,0)), (second, (0,0,255))):
        content = base64.b64decode(result['png_base64'], validate=True)
        with Image.open(io.BytesIO(content)) as image:
            assert image.format == 'PNG'
            assert image.size == (result['width'], result['height'])
            assert image.convert('RGB').getpixel((10,10)) == expected
        assert result['width'] <= 1600 and result['height'] <= 8192
        assert result['width'] * result['height'] <= 4_000_000
        assert len(content) <= 8*1024*1024
    assert path.read_bytes() == original and hashlib.sha256(original).hexdigest() == digest


def test_tall_and_large_business_pages_scale_to_pixel_and_height_bounds(tmp_path):
    for number, (width,height) in enumerate(((2000,3000),(1,20000),(5000,5000))):
        path = tmp_path/f'page-{number}.pdf'; digest = pdf_file(path, count=1, width=width, height=height)
        result = render_pdf_preview(path, 1, digest)
        assert 1 <= result['width'] <= 1600 and 1 <= result['height'] <= 8192
        assert result['width'] * result['height'] <= 4_000_000


def test_static_source_annotations_remain_visible_in_the_inert_page_image(tmp_path):
    path = tmp_path/'annotated-source.pdf'
    writer = PdfWriter(); writer.add_blank_page(width=200, height=300)
    writer.add_annotation(page_number=0, annotation=Rectangle((20,20,100,100), interior_color='00ff00'))
    with path.open('wb') as stream:writer.write(stream)
    original = path.read_bytes(); digest = hashlib.sha256(original).hexdigest()
    result = render_pdf_preview(path,1,digest)
    with Image.open(io.BytesIO(base64.b64decode(result['png_base64']))) as image:
        point = (round(60*result['width']/200), round(240*result['height']/300))
        assert image.convert('RGB').getpixel(point) == (0,255,0)
    assert path.read_bytes() == original


def test_invalid_encrypted_huge_out_of_range_and_changed_source_pdfs_fail_actionably(tmp_path):
    path = tmp_path/'original.pdf'; digest = pdf_file(path)
    with pytest.raises(PdfPreviewError, match='outside this PDF'):
        render_pdf_preview(path, 3, digest)
    with pytest.raises(PdfPreviewError, match='Source bytes changed') as changed:
        render_pdf_preview(path, 1, 'f'*64)
    assert changed.value.status_code == 409
    invalid = tmp_path/'invalid.pdf'; invalid.write_bytes(b'not a PDF')
    with pytest.raises(PdfPreviewError, match='cannot be decoded'):
        render_pdf_preview(invalid, 1, hashlib.sha256(invalid.read_bytes()).hexdigest())
    encrypted = tmp_path/'encrypted.pdf'; encrypted_digest = pdf_file(encrypted, encrypted=True)
    with pytest.raises(PdfPreviewError, match='Encrypted or damaged'):
        render_pdf_preview(encrypted, 1, encrypted_digest)
    huge = tmp_path/'huge.pdf'; huge_digest = pdf_file(huge, count=1, width=40000, height=40000)
    with pytest.raises(PdfPreviewError, match='dimensions exceed'):
        render_pdf_preview(huge, 1, huge_digest)
    too_many = tmp_path/'many-pages.pdf'; many_digest = pdf_file(too_many, count=2001)
    with pytest.raises(PdfPreviewError, match='page count exceeds'):
        render_pdf_preview(too_many, 1, many_digest)
    oversized = tmp_path/'oversized.pdf'
    with oversized.open('wb') as stream:stream.truncate(MAX_FILE_BYTES+1)
    with pytest.raises(PdfPreviewError, match='50 MiB'):
        render_pdf_preview(oversized, 1, 'a'*64)


def test_pdf_preview_route_uses_original_source_and_existing_gateway_before_the_renderer(tmp_path, monkeypatch):
    from app import pdf_preview
    path = tmp_path/'original.pdf'; digest = pdf_file(path)
    store = Store(':memory:'); store.initialize()
    snapshot = SourceSnapshot(id='registered-pdf', deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        provider='uploaded', source_kind='pdf', original_filename='original.pdf', source_uri='upload://original.pdf',
        local_path=str(path), sha256=digest)
    store.ingest(IngestionResult(company=CIRCLE, snapshots=[snapshot], observations=[]))
    application = create_app(store=store)
    @application.middleware('http')
    async def existing_gateway(request, call_next):
        if request.url.path.startswith('/sources/') and request.headers.get('Authorization') != 'Bearer fixture-gateway':
            return JSONResponse({'detail':'Authentication required by gateway'}, status_code=401)
        return await call_next(request)
    calls = []
    real_render = pdf_preview.render_pdf_preview
    def tracked(*args):calls.append(args); return real_render(*args)
    monkeypatch.setattr(pdf_preview, 'render_pdf_preview', tracked)
    with TestClient(application) as client:
        endpoint = '/sources/registered-pdf/pdf-preview'
        assert client.get(endpoint).status_code == 401 and calls == []
        headers = {'Authorization':'Bearer fixture-gateway'}
        response = client.get(endpoint+'?page=2', headers=headers)
        assert response.status_code == 200, response.text
        data = response.json()
        assert set(data) == {'snapshot_id','sha256','page','page_count','width','height','png_base64'}
        assert data['snapshot_id'] == snapshot.id and data['sha256'] == digest and data['page'] == 2
        assert client.get('/sources/unknown/pdf-preview', headers=headers).status_code == 404
        before = len(calls)
        for page in ('0','-1','2001','invalid'):
            assert client.get(endpoint+'?page='+page, headers=headers).status_code == 422
        assert len(calls) == before
        assert client.get(endpoint+'?page=3', headers=headers).status_code == 422
        original = client.get('/sources/registered-pdf/file', headers=headers)
        assert hashlib.sha256(original.content).hexdigest() == digest
        before = len(calls); path.write_bytes(b'changed after registration')
        assert client.get(endpoint, headers=headers).status_code == 409 and len(calls) == before


def test_renderer_capacity_environment_and_timeout_recovery_are_bounded(tmp_path, monkeypatch):
    from app import pdf_preview
    path = tmp_path/'original.pdf'; digest = pdf_file(path)
    entered = Barrier(3); release = Event(); invocations = []
    monkeypatch.setenv('NICRRON_API_KEY', 'private-fixture-key-never-forwarded')
    def bounded_worker(arguments, **kwargs):
        invocations.append((arguments, kwargs))
        assert arguments[1:4] == ['-I','-X','utf8'] and Path(arguments[4]).is_absolute()
        assert Path(arguments[4]).name == 'pdf_preview_worker.py'
        expected_keys = {'LANG','LC_ALL','TMPDIR','TEMP','TMP'}
        if pdf_preview.os.name == 'nt' and (pdf_preview.os.environ.get('SystemRoot') or pdf_preview.os.environ.get('SYSTEMROOT')):
            expected_keys.add('SystemRoot')
        assert set(kwargs['env']) == expected_keys
        assert 'NICRRON_API_KEY' not in kwargs['env']
        assert kwargs['timeout'] == 10 and kwargs['stdin'] == subprocess.DEVNULL
        assert kwargs['stdout'] == kwargs['stderr'] == subprocess.DEVNULL
        directory = Path(arguments[-1])
        image = Image.new('RGB',(2,3),'white');image.save(directory/'page.png',format='PNG');image.close()
        (directory/'result.json').write_text(json.dumps({'page':1,'page_count':2,'width':2,'height':3}))
        entered.wait(timeout=5); assert release.wait(timeout=5)
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(pdf_preview.subprocess, 'run', bounded_worker)
    with ThreadPoolExecutor(max_workers=2) as pool:
        running = [pool.submit(render_pdf_preview,path,1,digest) for _ in range(2)]
        try:
            entered.wait(timeout=5)
            with pytest.raises(PdfPreviewError, match='workers are busy') as busy:
                render_pdf_preview(path,1,digest)
            assert busy.value.status_code == 429 and len(invocations) == 2
        finally:release.set()
        assert all(future.result()['page'] == 1 for future in running)
    def timeout(*args, **kwargs):raise subprocess.TimeoutExpired('trusted-render-worker',10)
    monkeypatch.setattr(pdf_preview.subprocess,'run',timeout)
    with pytest.raises(PdfPreviewError, match='exceeded 10 seconds'):
        render_pdf_preview(path,1,digest)
    for spelling in ('SystemRoot','SYSTEMROOT'):
        with monkeypatch.context() as context:
            context.setattr(pdf_preview, 'os', SimpleNamespace(name='nt', environ={
                spelling:r'C:\Windows', 'NICRRON_API_KEY':'must-not-enter-child', 'PATH':'private-path'}))
            environment = pdf_preview._worker_environment(tmp_path)
            assert environment['SystemRoot'] == r'C:\Windows'
            assert set(environment) == {'LANG','LC_ALL','TMPDIR','TEMP','TMP','SystemRoot'}
    # A timeout must release capacity rather than making subsequent pages busy.
    with pytest.raises(PdfPreviewError, match='exceeded 10 seconds'):
        render_pdf_preview(path,1,digest)
