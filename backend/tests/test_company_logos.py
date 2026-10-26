"""One-time logo privacy, durable claims and bounded raster cache workflows."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import io
import json
from threading import Event
from types import SimpleNamespace

from PIL import Image,PngImagePlugin
import pytest

from app.company_logos import CompanyLogoService,MAX_BYTES,_download,normalize_public_domain
from app.schemas import Company,SourceSnapshot


def company(domain=''):
    return Company(deal_id='deal-logo',entity_key='workspace-deal-logo',legal_name='Example Systems',domain=domain,country='USA',
        identifiers={'workspace_identity_status':'user_supplied_unverified','workspace_created_at':'2026-10-26T12:00:00Z'})


def icon(width=64,height=32):
    image=Image.new('RGBA',(width,height),(25,90,180,255));output=io.BytesIO()
    info=PngImagePlugin.PngInfo();info.add_text('Private metadata','must not survive normalization')
    image.save(output,format='PNG',pnginfo=info);image.close();return output.getvalue()


def finish(service):service.executor.shutdown(wait=True)


def source(tmp_path,text,*,suffix='.txt',deal=None):
    selected=deal or company();path=tmp_path/('first'+suffix);path.write_text(text,encoding='utf-8')
    return SourceSnapshot(id='first',deal_id=selected.deal_id,entity_key=selected.entity_key,provider='uploaded',
        source_kind='user_upload',source_uri='upload://first'+suffix,local_path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest())


@pytest.mark.parametrize('value',['localhost','http://127.0.0.1','https://[::1]','https://10.0.0.1','example.local','example.internal',
    'https://user:secret@example.com','https://example.com:443','https://linkedin.com/company/acme','data:image/png,abc','example.com\nPrivate sentence',
    'private.example','router.home.arpa'])
def test_only_public_explicit_company_domains_are_accepted(value):
    with pytest.raises(ValueError):normalize_public_domain(value)


def test_domain_normalization_strips_private_url_parts_without_name_guessing():
    assert normalize_public_domain('HTTPS://Example.COM/private/path?token=not-forwarded#fragment')=='example.com'
    assert normalize_public_domain('münich.example.com')=='xn--mnich-kva.example.com'


def test_preparation_reads_and_legacy_workspaces_never_contact_a_provider(tmp_path):
    calls=[];service=CompanyLogoService(tmp_path/'logos',lambda domain:calls.append(domain) or icon())
    legacy=company('example.com').model_copy(update={'identifiers':{}})
    assert service.public(legacy) is None and service.commit(legacy) is None
    assert service.prepare(legacy) is None
    selected=company('example.com');assert service.prepare(selected)['status']=='awaiting_website'
    assert service.public(selected)['domain']=='example.com' and calls==[]
    service.discard(selected);assert service.public(selected) is None
    service.close()


def test_committed_logo_is_fetched_once_normalized_cached_and_hash_verified(tmp_path):
    calls=[];service=CompanyLogoService(tmp_path/'logos',lambda domain:calls.append(domain) or icon(512,256))
    selected=company('https://example.com/private?secret=never-outbound')
    service.prepare(selected);service.commit(selected);finish(service)
    metadata=service.public(selected)
    assert calls==['example.com'] and metadata['status']=='ready'
    assert metadata['asset_path']==f'/deals/deal-logo/logo/image/{metadata["sha256"]}'
    content=service.asset(selected,metadata['sha256'])
    assert hashlib.sha256(content).hexdigest()==metadata['sha256'] and len(content)<=MAX_BYTES
    with Image.open(io.BytesIO(content)) as image:
        assert image.format=='PNG' and image.size==(256,128) and image.info=={}
    service.commit(selected);service.public(selected.deal_id)
    with pytest.raises(ValueError):service.set_website(selected,'another-company.com')
    assert calls==['example.com']
    path=service._paths(selected)[1]/f'{metadata["sha256"]}.png';path.write_bytes(b'tampered')
    with pytest.raises(ValueError,match='unavailable'):service.asset(selected,metadata['sha256'])
    assert service.public(selected)['error_code']=='cache_unavailable' and calls==['example.com']
    service.close()


def test_conflicting_reservations_and_discard_cannot_change_another_identity(tmp_path):
    service=CompanyLogoService(tmp_path/'logos',lambda domain:icon())
    first=company();other=first.model_copy(update={'legal_name':'Different Systems'})
    service.prepare(first);before=service._paths(first)[2].read_bytes()
    with pytest.raises(ValueError,match='identity'):service.prepare(other)
    service.discard(other);assert service._paths(first)[2].read_bytes()==before
    service.commit(first);service.discard(first)
    assert service.public(first)['status']=='awaiting_website'
    service.close()


def test_same_identity_retry_recovers_a_prepared_marker_with_a_new_server_timestamp(tmp_path):
    calls=[];service=CompanyLogoService(tmp_path/'logos',lambda domain:calls.append(domain) or icon())
    original=company('example.com');service.prepare(original)
    retry=original.model_copy(update={'identifiers':{**original.identifiers,'workspace_created_at':'2026-10-26T12:01:00Z'}})
    assert service.prepare(retry)['status']=='awaiting_website'
    service.commit(retry);finish(service)
    assert calls==['example.com'] and service.public(retry)['status']=='ready'
    service.close()


def test_two_process_services_share_one_durable_attempt_claim(tmp_path):
    calls=[];entered=Event();release=Event();selected=company('example.com')
    def fetch(domain):
        calls.append(domain);entered.set();assert release.wait(5);return icon()
    first=CompanyLogoService(tmp_path/'logos',fetch);second=CompanyLogoService(tmp_path/'logos',fetch)
    first.prepare(selected)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda service:service.commit(selected),(first,second)))
        assert entered.wait(3)
        state=json.loads(first._paths(selected)[2].read_text())
        assert state['attempted'] is True and state['status']=='fetching'
        before=first._paths(selected)[2].read_bytes()
        assert second.public(selected)['status']=='fetching'
        assert first._paths(selected)[2].read_bytes()==before and calls==['example.com']
    finally:release.set();finish(first);finish(second)
    assert second.public(selected)['status']=='ready' and calls==['example.com']
    first.close();second.close()


def test_interrupted_attempt_never_refetches_or_mutates_from_a_read(tmp_path):
    calls=[];selected=company('example.com');first=CompanyLogoService(tmp_path/'logos',lambda domain:icon())
    first.prepare(selected);state=first._read(selected)
    state.update(stage='committed',attempted=True,status='fetching');first._write(selected,state);first.close()
    second=CompanyLogoService(tmp_path/'logos',lambda domain:calls.append(domain) or icon())
    before=second._paths(selected)[2].read_bytes()
    assert second.public(selected)['error_code']=='interrupted'
    assert second._paths(selected)[2].read_bytes()==before
    second.commit(selected);finish(second)
    assert calls==[] and second.public(selected)['status']=='unavailable'
    second.close()


def test_first_local_source_requires_explicit_matching_identity_and_never_sends_sentences(tmp_path):
    calls=[];selected=company();service=CompanyLogoService(tmp_path/'logos',lambda domain:calls.append(domain) or icon())
    service.prepare(selected);service.commit(selected)
    private='Company: Example Systems\nWebsite: https://example.com/private?token=never-send\nPrivate financial sentence: confidential.'
    service.after_source(selected,source(tmp_path,private));finish(service)
    assert calls==['example.com'] and service.public(selected)['status']=='ready'
    service.after_source(selected,source(tmp_path,'Company: Example Systems\nWebsite: https://other-company.com'))
    assert calls==['example.com'];service.close()


def test_unrelated_auditor_or_mismatched_json_does_not_consume_a_network_attempt(tmp_path):
    calls=[];selected=company();service=CompanyLogoService(tmp_path/'logos',lambda domain:calls.append(domain) or icon())
    service.prepare(selected);service.commit(selected)
    service.after_source(selected,source(tmp_path,'Company: Example Systems\nAuditor details\nWebsite: https://auditor.com'))
    assert calls==[] and service.public(selected)['status']=='awaiting_website'
    service.after_source(selected,source(tmp_path,json.dumps({'company':'Example Systems','website':'https://later.com'}),suffix='.json'))
    assert calls==[]  # The first durable file was already inspected; no later automatic retry.
    service.set_website(selected,'example.com');finish(service)
    assert calls==['example.com'];service.close()


@pytest.mark.parametrize('name,expected',[('Example Systems',['example.com']),('Different Company',[])])
def test_local_json_requires_its_explicit_legal_name_and_website_to_match(tmp_path,name,expected):
    calls=[];selected=company();service=CompanyLogoService(tmp_path/'logos',lambda domain:calls.append(domain) or icon())
    service.prepare(selected);service.commit(selected)
    payload=json.dumps({'company':{'legal_name':name,'website':'https://example.com'},'bank_url':'https://bank.com'})
    service.after_source(selected,source(tmp_path,payload,suffix='.json'));finish(service)
    assert calls==expected;service.close()


def test_foreign_source_cannot_consume_the_selected_company_first_file(tmp_path):
    calls=[];selected=company();service=CompanyLogoService(tmp_path/'logos',lambda domain:calls.append(domain) or icon())
    service.prepare(selected);service.commit(selected)
    other=selected.model_copy(update={'deal_id':'foreign','entity_key':'foreign'})
    service.after_source(selected,source(tmp_path,'Company: Example Systems\nWebsite: https://foreign.com',deal=other))
    assert service._read(selected)['first_source_seen'] is False
    service.after_source(selected,source(tmp_path,'Company: Example Systems\nWebsite: https://example.com'));finish(service)
    assert calls==['example.com'];service.close()


@pytest.mark.parametrize('payload',[b'<svg onload="alert(1)"/>',b'x'*(MAX_BYTES+1),icon(4097,1),icon(2000,2100)])
def test_invalid_oversized_and_excessive_pixel_images_fail_once_without_core_errors(tmp_path,payload):
    calls=[];selected=company('example.com');service=CompanyLogoService(tmp_path/'logos',lambda domain:calls.append(domain) or payload)
    service.prepare(selected);service.commit(selected);finish(service)
    assert service.public(selected)['status']=='unavailable'
    assert service.public(selected)['error_code']=='invalid_image'
    service.commit(selected);assert calls==['example.com'];service.close()


def test_default_lookup_uses_only_the_fixed_https_host_and_refuses_redirects_or_proxies(monkeypatch):
    requests=[]
    class Response:
        status_code=302;headers={'Location':'http://127.0.0.1/private'}
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
    class Client:
        def __init__(self,**kwargs):
            assert kwargs=={'timeout':6,'follow_redirects':False,'trust_env':False}
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def stream(self,method,url,**kwargs):requests.append((method,url));return Response()
    monkeypatch.setenv('HTTPS_PROXY','http://secret-proxy.invalid')
    monkeypatch.setattr('app.company_logos.httpx.AsyncClient',Client)
    with pytest.raises(ValueError,match='lookup_failed'):_download('example.com')
    assert requests==[('GET','https://icons.duckduckgo.com/ip3/example.com.ico')]


def test_default_lookup_bounds_both_declared_and_streamed_body_sizes(monkeypatch):
    chunks=[]
    class Response:
        status_code=200;headers={}
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def aiter_bytes(self,chunk_size):
            assert chunk_size==16384
            chunks.append(1);yield b'x'*MAX_BYTES
            chunks.append(2);yield b'x'
            raise AssertionError('The stream must stop as soon as its bound is crossed.')
    response=Response()
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        def stream(self,*args,**kwargs):return response
    monkeypatch.setattr('app.company_logos.httpx.AsyncClient',Client)
    response.headers={'Content-Length':str(MAX_BYTES+1)}
    with pytest.raises(ValueError,match='lookup_failed'):_download('example.com')
    assert chunks==[]
    response.headers={}
    with pytest.raises(ValueError,match='lookup_failed'):_download('example.com')
    assert chunks==[1,2]


def test_optional_cache_failures_never_reverse_company_or_upload_success(tmp_path,monkeypatch):
    service=CompanyLogoService(tmp_path/'logos',lambda domain:icon());selected=company()
    service.prepare(selected)
    def failed(*args):raise OSError('private path must not escape')
    monkeypatch.setattr(service,'_write',failed)
    service.commit(selected)
    service.after_source(selected,source(tmp_path,'Company: Example Systems\nWebsite: example.com'))
    service.discard(selected)
    service.close()
