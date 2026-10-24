import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from app.chat import catalog,answer,MAX_CHUNKS
from app.document_intake import DocumentClaim,initialize_documents,save_document_claims
from app.schemas import Company,SourceSnapshot,IngestionResult
from app.store import Store

@pytest.fixture
def ledger(tmp_path):
    store=Store(':memory:');store.initialize()
    company=Company(deal_id='one',entity_key='one',legal_name='One',domain='',country='Unknown')
    store.ingest(IngestionResult(company=company,snapshots=[],observations=[]))
    yield store,company,tmp_path
    store.close()


def add(store,company,path,key):
    source=SourceSnapshot(id=key,deal_id=company.deal_id,entity_key=company.entity_key,provider='uploaded',source_kind=path.suffix,source_uri='upload://'+key,local_path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    store.ingest(IngestionResult(company=company,snapshots=[source],observations=[]));return source


def test_document_claim_uses_native_evidence_source_quote_and_locator(ledger):
    store,company,tmp=ledger
    first=tmp/'claim.txt';first.write_text('A source that is not the evidence target.')
    second=tmp/'evidence.txt';second.write_text('Exact original revenue sentence is 120 USD.')
    source=add(store,company,first,'claim-source');target=add(store,company,second,'quote-source')
    claim=DocumentClaim(id='claim',deal_id='one',entity_key='one',snapshot_id=source.id,claim_type='financial',statement='A model paraphrase that must not be quoted.',model='fixture',extractor_version='fixture',evidence=[{'snapshot_id':target.id,'quote':second.read_text(),'locator':{'kind':'text_lines','line_start':1,'line_end':1,'extraction_basis':'original splitlines'}}])
    initialize_documents(store);save_document_claims(store,company,[claim])
    records,_,_=catalog(store,'one');entry=next(r for r in records if r['kind']=='document_claim')
    assert entry['source']['snapshot_id']=='quote-source' and entry['source']['locator']['line_start']==1
    assert entry['excerpt']==second.read_text() and 'paraphrase' not in entry['excerpt']
    second.unlink();records,_,_=catalog(store,'one')
    assert not any(r['kind']=='document_claim' for r in records)


def test_firestore_style_manifest_resolver_works_without_stored_local_paths(ledger):
    store,company,tmp=ledger;path=tmp/'original.txt';path.write_text('Original verified file bytes remain available.')
    source=add(store,company,path,'original')
    real=store.snapshots
    store.snapshots=lambda deal:[s.model_copy(update={'local_path':None}) for s in real(deal)]
    store.local_source_file=lambda s:path if s.id=='original' else None
    records,gaps,count=catalog(store,'one')
    assert count==1 and not gaps and records[0]['excerpt']==path.read_text()
    path.write_text('changed')
    assert catalog(store,'one')[0]==[]


def test_index_chunk_and_json_depth_limits_are_explicit(ledger):
    store,company,tmp=ledger
    path=tmp/'many.json';path.write_text(json.dumps([f'field {i}' for i in range(MAX_CHUNKS+1000)]));add(store,company,path,'many')
    records,gaps,_=catalog(store,'one')
    assert len(records)==MAX_CHUNKS and any('bound' in g['reason'] or '5000' in g['reason'] for g in gaps)
    path2=tmp/'deep.json';value='deep secret'
    for _ in range(40):value={'nested':value}
    path2.write_text(json.dumps(value))
    # Isolate this second catalog from the first source so its depth bound runs.
    other=Store(':memory:');other.initialize();other.ingest(IngestionResult(company=company,snapshots=[],observations=[]))
    try:
        add(other,company,path2,'deep');records,gaps,_=catalog(other,'one')
        assert records==[] and any('depth' in g['reason'] for g in gaps)
    finally:other.close()


def test_workbook_bounds_keep_formula_as_text_without_iterating_huge_dimensions(ledger):
    from openpyxl import Workbook
    store,company,tmp=ledger;path=tmp/'wide.xlsx';book=Workbook();book.active['A1']='Revenue';book.active['B1']='=100+20';book.active['ZZZ100000']='Outside retrieval';book.save(path);add(store,company,path,'wide')
    records,gaps,_=catalog(store,'one')
    assert records and any('=100+20' in r['excerpt'] for r in records)
    assert 'Outside retrieval' not in json.dumps(records)
    assert any('2000 rows and 300 columns' in g['reason'] for g in gaps)


def test_archive_limit_excludes_compressed_oversized_workbook_before_parser(ledger):
    from zipfile import ZipFile,ZIP_DEFLATED
    store,company,tmp=ledger;path=tmp/'oversized.xlsx'
    with ZipFile(path,'w',ZIP_DEFLATED) as archive:archive.writestr('xl/huge.xml',b'0'*50_000_001)
    add(store,company,path,'oversized')
    with patch('openpyxl.load_workbook',side_effect=AssertionError('Must not parse oversized archive')):
        records,gaps,_=catalog(store,'one')
    assert records==[] and gaps


def test_pdf_page_bound_reports_excluded_coverage(ledger):
    from pypdf import PdfWriter
    store,company,tmp=ledger;path=tmp/'long.pdf';writer=PdfWriter()
    for _ in range(81):writer.add_blank_page(width=100,height=100)
    with path.open('wb') as stream:writer.write(stream)
    add(store,company,path,'long');records,gaps,_=catalog(store,'one')
    assert any('first 80 of 81' in g['reason'] for g in gaps)
    assert not any(g.get('reason','').startswith('Page 81 ') for g in gaps)


@pytest.mark.parametrize('text',['Revenue is 999 USD.','Revenue is 120 billion USD.','收入为120美元。'])
def test_generated_language_and_numeric_fabrications_fail_before_semantic_review(ledger,text):
    store,company,tmp=ledger;path=tmp/'source.txt';path.write_text('Revenue forecast is 120 million USD.');add(store,company,path,'source')
    class Model:
        calls=0
        def complete(self,messages,**kwargs):
            self.calls+=1;context=json.loads(messages[1]['content']);payload={'statements':[{'text':text,'source_ids':[context['evidence'][0]['id']]}],'gaps':[]}
            return {'response':{'choices':[{'finish_reason':'stop','message':{'content':json.dumps(payload)}}]}}
    model=Model()
    with pytest.raises(ValueError):answer(store,'one','Revenue forecast',model)
    assert model.calls==1


def test_foreign_company_source_cannot_enter_query_context(ledger):
    store,company,tmp=ledger;path=tmp/'foreign.txt';path.write_text('PRIVATE_FOREIGN_CO secret revenue 999.')
    foreign=SourceSnapshot(id='foreign',deal_id='foreign',entity_key=company.entity_key,provider='uploaded',source_kind='text',source_uri='upload://foreign',local_path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    store.snapshots=lambda deal:[foreign]
    class Never:
        def complete(self,*args,**kwargs):raise AssertionError('No foreign data may reach model')
    result=answer(store,'one','PRIVATE_FOREIGN_CO revenue',Never())
    assert result['status']=='insufficient_evidence' and result['coverage']['registered_sources']==0


def test_reading_view_is_not_a_substitute_for_missing_registered_original(ledger):
    store,company,tmp=ledger
    original=tmp/'original.txt';original.write_text('Original source bytes.')
    reading=tmp/'reading.txt';reading.write_text('OCR reading revenue is 120 USD.')
    native=add(store,company,original,'original');derived=add(store,company,reading,'reading')
    claim=DocumentClaim(id='derived-claim',deal_id='one',entity_key='one',snapshot_id=derived.id,claim_type='financial',statement='Located OCR wording.',model='fixture',extractor_version='fixture',evidence=[{'snapshot_id':derived.id,'original_snapshot_id':native.id,'quote':reading.read_text(),'locator':{'kind':'text_lines','line_start':1,'line_end':1,'extraction_basis':'OCR reading lines'}}])
    initialize_documents(store);save_document_claims(store,company,[claim]);original.unlink()
    records,gaps,_=catalog(store,'one')
    assert not records and any('registered original' in gap['reason'] for gap in gaps)
