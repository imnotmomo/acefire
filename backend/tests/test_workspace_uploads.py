import io,json,time,hashlib
from types import SimpleNamespace
from zipfile import ZipFile
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from app.store import Store
from app.schemas import Company
from app.workspace_routes import workspace_router,UploadJobs
from app.workspace_intake import uploaded_source_path,quote_claim
from app.uploads import ingest_upload
from app.firebase_store import FirebaseStore


def wait(client,deal,job):
    for _ in range(300):
        result=client.get(f'/deals/{deal}/uploads/{job}').json()
        if result['status'] in {'completed','failed'}:return result
        time.sleep(.02)
    pytest.fail('Upload did not finish')

@pytest.fixture
def workspace(tmp_path,monkeypatch):
    monkeypatch.setenv('UPLOAD_CACHE_ROOT',str(tmp_path/'uploads'))
    store=Store(':memory:');store.initialize();app=FastAPI();app.include_router(workspace_router(store))
    with TestClient(app) as client:yield client,store
    store.close()


def test_company_csv_exact_decimal_and_idempotent_original(workspace):
    client,store=workspace
    response=client.post('/deals',json={'name':'New Company','sector':'Fintech','geography':'US'})
    assert response.status_code==201
    company=response.json()['company'];deal=company['deal_id']
    assert deal.startswith('deal-') and company['identifiers']['workspace_identity_status']=='user_supplied_unverified'
    assert client.get('/deals').json()['companies'][0]['deal_id']==deal
    data='metric_key,label,raw_value,unit,currency,scale_multiplier,normalization_basis,period_kind,period_start,period_end,scenario\nrevenue,Revenue,100.123400000000000006,USD,USD,1,Source states USD,duration,2024-01-01,2024-02-29,actual\n'
    response=client.post(f'/deals/{deal}/uploads',files={'file':('ledger.csv',data,'text/csv')})
    assert response.status_code==202
    result=wait(client,deal,response.json()['id'])
    assert result['status']=='completed' and result['observations']==1 and result['claims']==1
    row=store.observations(deal)[0]
    assert str(row.value)=='100.123400000000000006' and str(row.period_end)=='2024-02-29'
    assert row.locator['kind']=='csv_row' and row.locator['row']==2
    assert store.document_claims(deal)[0]['evidence'][0]['quote'] in data
    assert uploaded_source_path(store.snapshots(deal)[0]).read_text()==data
    repeated=client.post(f'/deals/{deal}/uploads',files={'file':('ledger.csv',data,'text/csv')})
    assert repeated.json()['id']==response.json()['id']
    assert wait(client,deal,repeated.json()['id'])['status']=='completed'
    assert len(store.observations(deal))==1 and len(store.snapshots(deal))==1


def test_unknown_scale_multiline_quotes_and_failure_scope(workspace):
    client,store=workspace;deal=client.post('/deals',json={'name':'Raw','deal_id':'chosen'}).json()['company']['deal_id']
    assert client.post('/deals',json={'name':'y','deal_id':'chosen'}).status_code==409
    retry=client.post('/deals',json={'name':'Raw','deal_id':'chosen'})
    assert retry.status_code==201 and retry.json()['company']['deal_id']==deal
    assert len(client.get('/deals').json()['companies'])==1
    assert client.post('/deals',json={'name':'x','deal_id':'../bad'}).status_code==422
    assert client.post('/deals/absent/uploads',files={'file':('x.csv','a\n1')}).status_code==404
    assert client.post(f'/deals/{deal}/uploads',files={'file':('x.html','<script>')}).status_code==415
    assert client.post(f'/deals/{deal}/uploads',data={'provider':'akta'},files={'file':('x.csv','a\n1')}).status_code==422
    data='label,amount\n"Revenue\npartial",100.20\n'
    response=client.post(f'/deals/{deal}/uploads',files={'file':('raw.csv',data)})
    done=wait(client,deal,response.json()['id']);assert done['status']=='completed'
    row=store.observations(deal)[0]
    assert row.value is None and row.scale_multiplier is None and row.raw_value=='100.20'
    assert store.document_claims(deal)[0]['evidence'][0]['quote']=='"Revenue\npartial",100.20'
    response=client.post(f'/deals/{deal}/uploads',files={'file':('broken.xlsx',b'not zip')})
    done=wait(client,deal,response.json()['id']);assert done['status']=='failed' and done['snapshot_id'] and 'error' in done
    assert client.get(f'/deals/foreign/uploads/{done["id"]}').status_code==404


def test_restarted_jobs_remain_failed(tmp_path,monkeypatch):
    monkeypatch.setenv('UPLOAD_CACHE_ROOT',str(tmp_path));(tmp_path/'jobs').mkdir()
    (tmp_path/'jobs'/('a'*32+'.json')).write_text(json.dumps({'id':'a'*32,'deal_id':'one','status':'processing'}))
    jobs=UploadJobs(None)
    try:
        jobs.start()
        assert jobs.read('one','a'*32)['status']=='failed'
    finally:jobs.close()


def test_workbook_cached_value_has_native_cell_provenance(workspace):
    client,store=workspace;deal=client.post('/deals',json={'name':'Cells'}).json()['company']['deal_id'];stream=io.BytesIO()
    with ZipFile(stream,'w') as z:
        z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Actuals" r:id="r1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="49"><c r="A49" t="inlineStr"><is><t>Revenue</t></is></c><c r="I49"><f>SUM(I50:I51)</f><v>100.123400</v></c></row></sheetData></worksheet>')
    response=client.post(f'/deals/{deal}/uploads',files={'file':('actuals.xlsx',stream.getvalue())})
    assert wait(client,deal,response.json()['id'])['status']=='completed'
    row=store.observations(deal)[0]
    assert row.raw_value=='100.123400' and row.value is None and row.locator['sheet']=='Actuals' and row.locator['cell']=='I49'

class FakeFirestore:
    def __init__(self):self.rows={}
    def collection(self,name):return FakeCollection(self,name)
    def close(self):pass
class FakeCollection:
    def __init__(self,client,path):self.client=client;self.path=path
    def document(self,key):return FakeDocument(self.client,self.path+'/'+key)
    def stream(self,**kwargs):
        return [SimpleNamespace(exists=True,to_dict=lambda row=row:row) for key,row in self.client.rows.items() if key.startswith(self.path+'/') and '/' not in key[len(self.path)+1:]]
class FakeDocument:
    def __init__(self,client,path):self.client=client;self.path=path
    def collection(self,name):return FakeCollection(self.client,self.path+'/'+name)
    def create(self,record,**kwargs):
        from google.api_core.exceptions import AlreadyExists
        if self.path in self.client.rows:raise AlreadyExists('Exists')
        self.client.rows[self.path]=record
    def get(self,**kwargs):
        row=self.client.rows.get(self.path);return SimpleNamespace(exists=row is not None,to_dict=lambda:row)


def test_firestore_ingestion_integrity_cache_and_private_paths(tmp_path,monkeypatch):
    monkeypatch.setenv('UPLOAD_CACHE_ROOT',str(tmp_path));store=FirebaseStore(client=FakeFirestore(),cache_seconds=300)
    company=Company(deal_id='one',entity_key='one',legal_name='One',domain='',country='Unknown');store.create_company(company)
    assert store.snapshots('one')==[]
    intake=ingest_upload(b'label,amount\nRevenue,100.00\n','source.csv','text/csv','uploaded',company,tmp_path/'files')
    assert store.ingest(intake)['snapshots_added']==1
    source=store.snapshots('one')[0];assert source.local_path is None
    assert all('local_path' not in row['record'] for row in store.client.rows.values())
    assert store.ingest(intake)=={'snapshots_added':0,'observations_added':0}
    bad=intake.model_copy(update={'snapshots':[intake.snapshots[0].model_copy(update={'sha256':'a'*64})]})
    with pytest.raises(ValueError,match='immutable'):store.ingest(bad)
    claim=quote_claim(company,source,'Revenue,100.00',{'kind':'csv_row','row':2},'Source row')
    store.save_document_claims(company,[claim]);assert len(store.document_claims('one'))==1


def test_pdf_upload_runs_unchanged_b_quote_validation_and_numeric_intake(workspace,monkeypatch):
    from reportlab.pdfgen import canvas
    from unittest.mock import patch
    client,store=workspace;deal=client.post('/deals',json={'name':'Example Systems'}).json()['company']['deal_id']
    stream=io.BytesIO();page=canvas.Canvas(stream);quote='Example Systems reports revenue of 100.00 USD.';page.drawString(40,700,quote);page.save()
    numeric={'metric_key':'revenue','label':'Revenue','raw_value':'100.00','unit':'USD','currency':'USD','scale_multiplier':'1','normalization_basis':'Printed USD value','scope':None,'accounting_basis':None,'period_kind':'unknown','period_start':None,'period_end':None,'period_label':None,'scenario':'unknown'}
    payload={'claims':[{'subject_entity_id':None,'subject_entity_name':'Example Systems','claim_type':'financial','statement':quote,'effective_date':None,'limitations':[], 'numeric':numeric,'evidence':[{'physical_page':1,'section':None,'quote':quote}]}],'open_questions':[]}
    record={'request_id':'fixture','response':{'model':'fixture-vision','choices':[{'finish_reason':'stop','message':{'content':json.dumps(payload)}}]}}
    monkeypatch.setenv('NICRRON_API_KEY','test-fixture-key')
    with patch('backend.integrations.nicrron.NicrronClient.complete',return_value=record):
        response=client.post(f'/deals/{deal}/uploads',files={'file':('deck.pdf',stream.getvalue(),'application/pdf')})
        done=wait(client,deal,response.json()['id'])
    assert done['status']=='completed',done
    assert done['claims']==1 and done['observations']==1
    claim=store.document_claims(deal)[0]
    assert claim['evidence'][0]['quote']==quote and claim['evidence'][0]['locator']['page']==1
    assert str(store.observations(deal)[0].value)=='100.00'


def test_image_ocr_produces_hash_distinct_reading_view_without_mutating_original(tmp_path):
    import shutil,hashlib
    from PIL import Image,ImageDraw,ImageFont
    from pypdf import PdfReader
    from app.workspace_intake import ocr_pdf
    if not shutil.which('tesseract'):pytest.skip('Tesseract is not installed')
    image=Image.new('RGB',(1800,180),'white');ImageDraw.Draw(image).text((30,40),'Example Systems provides payment software.',fill='black',font=ImageFont.load_default(size=48))
    source=tmp_path/'original.png';image.save(source);before=hashlib.sha256(source.read_bytes()).hexdigest()
    reading=ocr_pdf(source,tmp_path/'ocr')
    assert 'payment' in PdfReader(reading).pages[0].extract_text().lower()
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before
    assert hashlib.sha256(reading.read_bytes()).hexdigest()!=before


def test_office_upload_keeps_original_and_derived_pdf_with_b_quote_locations(workspace,tmp_path,monkeypatch):
    from unittest.mock import patch
    from office_fixtures import write_docx
    from backend.evidence.prepare_office import resolve_soffice
    try:resolve_soffice()
    except ValueError:pytest.skip('LibreOffice is not installed')
    client,store=workspace;deal=client.post('/deals',json={'name':'Example Systems'}).json()['company']['deal_id']
    source=write_docx(tmp_path/'source.docx');quote='Example Systems provides payment software.'
    payload={'claims':[{'subject_entity_id':None,'subject_entity_name':'Example Systems','claim_type':'business','statement':quote,'effective_date':None,'limitations':[],'numeric':None,'evidence':[{'physical_page':1,'section':None,'quote':quote}]}],'open_questions':[]}
    record={'request_id':'fixture','response':{'model':'fixture-vision','choices':[{'finish_reason':'stop','message':{'content':json.dumps(payload)}}]}}
    monkeypatch.setenv('NICRRON_API_KEY','test-fixture-key')
    with patch('backend.integrations.nicrron.NicrronClient.complete',return_value=record):
        response=client.post(f'/deals/{deal}/uploads',files={'file':('source.docx',source.read_bytes())})
        done=wait(client,deal,response.json()['id'])
    assert done['status']=='completed',done
    snapshots=store.snapshots(deal);assert len(snapshots)==2
    claim=store.document_claims(deal)[0];evidence=claim['evidence'][0]
    assert evidence['snapshot_id']!=evidence['original_snapshot_id'] and evidence['original_locators']
    original=next(s for s in snapshots if s.id==evidence['original_snapshot_id'])
    assert uploaded_source_path(original).read_bytes()==source.read_bytes()


def test_firestore_workspace_upload_feeds_the_company_catalog(tmp_path,monkeypatch):
    from app.report import build_company_report
    from app.evidence_catalog import add_document_claims,build_evidence_catalog
    monkeypatch.setenv('UPLOAD_CACHE_ROOT',str(tmp_path/'cloud-uploads'));store=FirebaseStore(client=FakeFirestore(),cache_seconds=300)
    app=FastAPI();app.include_router(workspace_router(store))
    with TestClient(app) as client:
        deal=client.post('/deals',json={'name':'Cloud Company'}).json()['company']['deal_id']
        response=client.post(f'/deals/{deal}/uploads',files={'file':('ledger.csv','label,amount\nRevenue,123.000000000001\n')})
        done=wait(client,deal,response.json()['id']);assert done['status']=='completed'
        company=store.company(deal)
        report=build_company_report(company,store.profiles(deal),store.observations(deal),store.snapshots(deal),[],[])
        add_document_claims(report,store.document_claims(deal));catalog=build_evidence_catalog(report)
        assert any(item['kind']=='statement' and item['text']=='Revenue,123.000000000001' for item in catalog)
        assert any(item['kind']=='observation' and '123.000000000001' in item['text'] for item in catalog)
        assert store.snapshots(deal)[0].local_path is None
        assert uploaded_source_path(store.snapshots(deal)[0]).is_file()


def test_image_upload_uses_b_ocr_quotes_and_retains_native_original(workspace,monkeypatch):
    import shutil
    from PIL import Image,ImageDraw,ImageFont
    from unittest.mock import patch
    if not shutil.which('tesseract'):pytest.skip('Tesseract is not installed')
    client,store=workspace;deal=client.post('/deals',json={'name':'Example Systems'}).json()['company']['deal_id']
    quote='Example Systems provides payment software.'
    image=Image.new('RGB',(1800,180),'white');ImageDraw.Draw(image).text((30,40),quote,fill='black',font=ImageFont.load_default(size=48));content=io.BytesIO();image.save(content,format='PNG')
    payload={'claims':[{'subject_entity_id':None,'subject_entity_name':'Example Systems','claim_type':'business','statement':quote,'effective_date':None,'limitations':[],'numeric':None,'evidence':[{'physical_page':1,'section':None,'quote':quote}]}],'open_questions':[]}
    record={'request_id':'fixture','response':{'model':'fixture-vision','choices':[{'finish_reason':'stop','message':{'content':json.dumps(payload)}}]}}
    monkeypatch.setenv('NICRRON_API_KEY','test-fixture-key')
    with patch('backend.integrations.nicrron.NicrronClient.complete',return_value=record):
        response=client.post(f'/deals/{deal}/uploads',files={'file':('screen.png',content.getvalue(),'image/png')})
        done=wait(client,deal,response.json()['id'])
    assert done['status']=='completed',done
    claim=store.document_claims(deal)[0];evidence=claim['evidence'][0]
    assert evidence['representation_kind']=='ocr_pdf' and evidence['original_snapshot_id']!=evidence['snapshot_id']
    assert evidence['original_locators']==[{'kind':'image_frame','frame_index':1}]
    original=next(s for s in store.snapshots(deal) if s.id==evidence['original_snapshot_id'])
    assert uploaded_source_path(original).read_bytes()==content.getvalue()


def test_main_api_new_firestore_company_csv_report_source_file_and_chat(tmp_path,monkeypatch):
    monkeypatch.setenv('UPLOAD_CACHE_ROOT',str(tmp_path/'api-uploads'))
    from app.main import create_app
    store=FirebaseStore(client=FakeFirestore(),cache_seconds=300);seen=[]
    class Chat:
        def answer(self,deal,request,catalog,context):
            seen.append(context)
            evidence=next(item for item in catalog if item['kind']=='statement')
            return {'deal_id':deal,'report_id':request.report_id,'answer':'The uploaded source reports revenue.','state':'verify','citations':[{'evidence_id':evidence['id'],'quote':evidence['text']}]}
    with TestClient(create_app(store=store,chat_factory=Chat)) as client:
        creation=client.post('/deals',json={'name':'Generic API Company','deal_id':'deal-generic-api','sector':'Fintech','geography':'USA'})
        assert creation.status_code==201;deal=creation.json()['company']['deal_id']
        assert client.get(f'/deals/{deal}/report').status_code==200
        original=b'label,amount\nRevenue,123.000000000001\n'
        upload=client.post(f'/deals/{deal}/uploads',files={'file':('ledger.csv',original,'text/csv')})
        assert upload.status_code==202
        job=wait(client,deal,upload.json()['id']);assert job['status']=='completed',job
        response=client.get(f'/deals/{deal}/report');assert response.status_code==200,response.text
        report=response.json()
        assert report['company']['deal_id']==deal and len(report['source_files'])==1 and len(report['document_claims'])==1
        assert report['reported_metrics'][0]['observation']['raw_value']=='123.000000000001'
        assert report['reported_metrics'][0]['observation']['value'] is None
        source=report['source_files'][0]
        assert source['preview_available'] is True
        downloaded=client.get(source['preview_url']);assert downloaded.status_code==200 and downloaded.content==original
        assert hashlib.sha256(downloaded.content).hexdigest()==source['sha256']
        reply=client.post(f'/deals/{deal}/chat',json={'question':'What does the source report?','report_id':report['report_id']})
        assert reply.status_code==200 and seen[0]['document_claims'][0]['evidence'][0]['quote']=='Revenue,123.000000000001'
        assert all('local_path' not in item for item in seen[0]['source_snapshots'])


def test_firestore_inflight_old_bundle_cannot_repopulate_cache_after_write():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from app.firebase_store import envelope
    store=FirebaseStore(client=SimpleNamespace(),cache_seconds=300)
    company=Company(deal_id='one',entity_key='one',legal_name='One',domain='',country='Unknown')
    store.company=lambda deal:company
    rows={};captured=Event();release=Event();blocked=[False]
    class Collection:
        def __init__(self,name):self.name=name
        def stream(self,**kwargs):
            old=list(rows.values()) if self.name=='source_observations' else []
            if self.name=='source_observations' and not blocked[0]:
                blocked[0]=True;captured.set();assert release.wait(5)
            return [SimpleNamespace(exists=True,to_dict=lambda value=value:value) for value in old]
        def document(self,record_id):
            class Ref:
                def create(self,data,**kwargs):rows[record_id]=data
            return Ref()
    store._collection=lambda deal,name:Collection(name)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(store.bundle,'one');assert captured.wait(5)
        store.save_record('one','source_observations','new',{'id':'new','deal_id':'one','value':'100.000000000001'})
        release.set();fresh=pending.result(timeout=5)
    assert fresh['source_observations']==[{'id':'new','deal_id':'one','value':'100.000000000001'}]
    assert store.bundle('one')['source_observations']==fresh['source_observations']


def test_duplicate_active_upload_schedules_only_one_processor(tmp_path,monkeypatch):
    from threading import Event
    monkeypatch.setenv('UPLOAD_CACHE_ROOT',str(tmp_path/'duplicate-uploads'))
    store=Store(':memory:');store.initialize();entered=Event();release=Event();calls=[]
    def processor(store,company,source,folder):
        calls.append(source.id);entered.set();assert release.wait(5)
        return {'snapshot_id':source.id,'observations':0,'claims':0,'warnings':[]}
    app=FastAPI();router=workspace_router(store,processor=processor);app.include_router(router)
    try:
        with TestClient(app) as client:
            deal=client.post('/deals',json={'name':'Duplicate'}).json()['company']['deal_id']
            first=client.post(f'/deals/{deal}/uploads',files={'file':('same.pdf',b'%PDF-original')})
            assert first.status_code==202 and entered.wait(5)
            again=client.post(f'/deals/{deal}/uploads',files={'file':('same.pdf',b'%PDF-original')})
            assert again.status_code==202 and again.json()['id']==first.json()['id']
            assert calls==[first.json()['snapshot_id']]
            release.set();assert wait(client,deal,first.json()['id'])['status']=='completed'
            # All eight queue slots remain available after completion/replay.
            for _ in range(8):assert router.upload_jobs.capacity.acquire(blocking=False)
            for _ in range(8):router.upload_jobs.capacity.release()
    finally:release.set();store.close()


def test_xlsm_preserves_cached_values_and_never_reads_macros_or_executes_formulas(workspace):
    from unittest.mock import patch
    client,store=workspace;deal=client.post('/deals',json={'name':'Macro cells'}).json()['company']['deal_id'];stream=io.BytesIO()
    with ZipFile(stream,'w') as z:
        z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cached" r:id="r1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="49"><c r="A49" t="inlineStr"><is><t>Revenue</t></is></c><c r="I49"><f>2+2</f><v>100.123400</v></c></row></sheetData></worksheet>')
        z.writestr('xl/vbaProject.bin',b'MACROS_MUST_REMAIN_INERT')
    original=stream.getvalue();read=ZipFile.read
    def inert_read(archive,name,*args,**kwargs):
        assert str(name)!='xl/vbaProject.bin','VBA must not be loaded'
        return read(archive,name,*args,**kwargs)
    with patch('subprocess.run',side_effect=AssertionError('No spreadsheet engine may run')),patch.object(ZipFile,'read',inert_read):
        response=client.post(f'/deals/{deal}/uploads',files={'file':('cached.xlsm',original)})
        done=wait(client,deal,response.json()['id'])
    assert done['status']=='completed',done
    row=store.observations(deal)[0]
    assert row.raw_value=='100.123400' and row.value is None and row.locator['cell']=='I49'
    assert len(store.snapshots(deal))==1 and uploaded_source_path(store.snapshots(deal)[0]).read_bytes()==original


def test_legacy_xls_reads_cached_native_binary_cells_without_a_calculation_engine(workspace):
    import base64,zlib
    from unittest.mock import patch
    from decimal import Decimal
    # Synthetic 5632-byte BIFF workbook: A49=Revenue, I49=binary0.1,
    # I50=formula1+1 with no cached result. Generated once with xlwt;
    # tests and production do not depend on that writer.
    original=zlib.decompress(base64.b64decode("eJztWE1IVFEU/u6b/0HHNzYGGg2DkJW6yNq00VdBuSkxN0UEOeojQhljqMAWZdksg6BV4kZw08Zqk0UtatciMGoRBMFMLVsFCS50Xuec9x6NVuBbaAb3e3PPvff83HPfnHMv7953i+ny7JOWCtahByFUnQSiNTxFJeF3TJDccbjp13EqjsZ/hUScAhmN4EX92xjHkONdgYHH4ddEgS9UzuMy+sYLdm4LcUzmkFc8h26iCjPESaFZZtUodFjoDqGPRPOl0CPCuSu0m3TL6hwWrb72w14WnzVaRZYCj7sgNp+E04UmvOEsvnlPuboRHC1eyo9tT0E2XIc5UNx67YJdzI+VkaEAzmHJyQE//JX6Kqf5W8tXIP7yWn7sD/z7RhiYhDMoCV6ihFwIsSSKk/bF/PDECiUvR5wLRXnAvmYXrtpJ6rnL1lyzbOslneuIjqBB2mlJapM25pWH39+fGuq3LghnUrZqd9w9PAc4uMUWZJzCAeofFDlv9u1i0SH0toy6S9otQjOUilS39Td5jRNTonNHpG3k55Dgg7W3pr2P2qVvp59lS1+t/dSe761cz8x/tGbRSj5HyJ6fKXSqTjX9gPHc8mvlLf7PQpt/2wjihilvkIDj/s2qAatICi8tjBsG9+LU6/D0u9bpR7GbeKwh4YDjiWLIKv6FeoxGPGVvtNf8QhIaGhoaGhoaGhoa2xt8BOAPWf7Q5YNABO5hgk8VfK+zSqX6ry8pNDYNAxin5wodTI+jQHURE4HyZyciyh9LbdDGvy9knCHvRYxiSOYxGsg3gw6DqvZ9NmxoBnb1NwT2Xw0yz032/xMcuMBg"))
    client,store=workspace;deal=client.post('/deals',json={'name':'Legacy cells'}).json()['company']['deal_id']
    with patch('subprocess.run',side_effect=AssertionError('No spreadsheet engine may run')):
        response=client.post(f'/deals/{deal}/uploads',files={'file':('legacy.xls',original)})
        done=wait(client,deal,response.json()['id'])
    assert done['status']=='completed',done
    rows=store.observations(deal);assert len(rows)==1
    row=rows[0]
    assert row.raw_value==str(Decimal.from_float(0.1)) and row.value is None and row.scale_multiplier is None
    assert row.locator['sheet']=='Legacy' and row.locator['cell']=='I49'
    assert any('binary' in note for note in row.notes)
    assert len(store.snapshots(deal))==1 and uploaded_source_path(store.snapshots(deal)[0]).read_bytes()==original
