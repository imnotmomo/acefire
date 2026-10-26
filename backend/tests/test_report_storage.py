"""Large, fully sourced reports survive storage without dropping human history."""
import base64
from copy import deepcopy
import hashlib
import json
import os
from types import SimpleNamespace
import zlib

from fastapi.testclient import TestClient
from google.api_core.exceptions import AlreadyExists, FailedPrecondition
import pytest

from app.firebase_store import FirebaseStore, canonical, envelope
from app.main import create_app
from app.narrative import _source_graph
from app.report_drafts import DraftVersionConflict, new_record
from app.report_storage import (ENCODING, MAX_LOGICAL_BYTES, MAX_STORED_BYTES, MAX_WORKSPACE_BYTES,
                                canonical_bytes, decode_record, encode_record)
from app.schemas import CIRCLE, IngestionResult
from app.store import Store


def realistic_draft():
    catalog = []
    for index in range(663):
        quote = (f'Synthetic row {index}: reported amount 9007199254740993.0123456789; '
                 'source-time evidence and accounting context require review. ') * 5
        catalog.append({'id':f'evidence-{index}', 'deal_id':CIRCLE.deal_id,
            'kind':'observation' if index < 436 else 'statement' if index < 660 else 'calculation',
            'title':f'Synthetic source {index}', 'text':quote, 'quote_basis':'source_text',
            'source':{'snapshot_id':f'file-{index%16}', 'file_name':'财务说明.csv', 'sha256':hashlib.sha256(str(index%16).encode()).hexdigest(),
                      'provider':'uploaded', 'locator':{'kind':'csv_row','row':index+1,'quote':quote}}})
    sections=[]
    for number, module in enumerate(('overview','market','financials','customers','team','questions')):
        claims=[]
        for index, item in enumerate(catalog[number*8:number*8+8]):
            citation={key:item[key] for key in ('source','quote_basis')}
            citation.update(evidence_id=item['id'],kind=item['kind'],quote=item['text'])
            claims.append({'id':f'claim-{number}-{index}', 'text':item['text'], 'kind':'reported_summary','citations':[citation]})
        sections.append({'id':module,'title':module,'claims':claims,'gaps':[]})
    return {'id':'large-draft','deal_id':CIRCLE.deal_id,'based_on_report_id':'evidence-version','model':'fixture-only',
        'status':'model_generated_unverified','generated_at':'2026-10-26T12:00:00Z','sections':sections,
        'evidence_manifest':catalog,'source_graph':_source_graph('large-draft',sections,catalog)}


def edited_workspace():
    config={'topics':[],'depth':'Standard','scope':'Internal only','geography':'Global','horizon':'Source period','focus':''}
    text='Human revision retains exact amount 9007199254740993.0123456789 and citation [evidence-0].\n' * 500
    return {'order':['overview'],'configs':{'overview':config},'generatedAt':'2026-10-26T12:00:00Z',
        'sections':[{'id':'overview','title':'Overview','content':text,'config':config,'evidenceIds':['evidence-0']}],
        'revisions':[{'id':f'revision-{number}','at':'2026-10-26T12:00:00Z','section':'overview',
            'title':'Overview','before':text+f'Before {number}','after':text+f'After {number}','author':'Human editor'} for number in range(12)]}


def test_realistic_catalog_graph_quotes_and_all_human_revisions_round_trip_losslessly():
    draft=realistic_draft(); workspace=edited_workspace()
    record=new_record(CIRCLE.deal_id,'evidence-version',draft=draft,workspace=workspace)
    assert len(canonical_bytes(record)) > 1_000_000
    assert len(canonical_bytes(workspace)) > 450_000
    stored=encode_record(record)
    assert stored['storage_encoding']==ENCODING and len(canonical_bytes(stored)) < MAX_STORED_BYTES
    assert decode_record(json.loads(json.dumps(stored)))==record
    restored=decode_record(stored)
    assert len(restored['draft']['evidence_manifest'])==663
    assert restored['draft']['source_graph']==draft['source_graph']
    assert restored['workspace']['revisions']==workspace['revisions']
    assert restored['draft']['sections'][0]['claims'][0]['citations'][0]['source']==draft['sections'][0]['claims'][0]['citations'][0]['source']


def test_duckdb_large_create_edit_reopen_and_legacy_plain_record_compatibility(tmp_path):
    path=tmp_path/'reports.duckdb';store=Store(path);store.initialize()
    store.ingest(IngestionResult(company=CIRCLE,snapshots=[],observations=[]))
    legacy=new_record(CIRCLE.deal_id,'evidence-version',draft={'id':'legacy','sections':[]})
    store.create_report_draft(legacy)
    large=new_record(CIRCLE.deal_id,'evidence-version',draft=realistic_draft())
    store.create_report_draft(large)
    edited=store.update_report_draft(CIRCLE.deal_id,large['id'],1,edited_workspace())
    assert edited['version']==2 and edited['draft']==large['draft']
    with pytest.raises(DraftVersionConflict):store.update_report_draft(CIRCLE.deal_id,large['id'],1,edited_workspace())
    stored=json.loads(store._connect().execute('SELECT payload FROM report_drafts WHERE id=?',[large['id']]).fetchone()[0])
    assert stored['storage_encoding']==ENCODING
    assert len(canonical_bytes(stored))<=MAX_STORED_BYTES
    store.close();reopened=Store(path);reopened.initialize()
    assert reopened.report_draft(CIRCLE.deal_id,large['id'])==edited
    assert reopened.report_draft(CIRCLE.deal_id,'legacy')==legacy
    listing=reopened.report_drafts(CIRCLE.deal_id)
    assert len(listing)==2
    assert next(row for row in listing if row['id']==large['id'])['section_count']==1
    reopened.close()


def test_firestore_compressed_envelope_update_keeps_cas_and_every_original_field():
    class Ref:
        value=None;updated=1
        def create(self,value,**kwargs):
            if self.value is not None:raise AlreadyExists('exists')
            self.value=deepcopy(value)
        def get(self,**kwargs):
            value=deepcopy(self.value)
            return SimpleNamespace(exists=value is not None,to_dict=lambda:value,update_time=self.updated)
        def update(self,value,option,**kwargs):
            if option._last_update_time!=self.updated:raise FailedPrecondition('changed')
            self.value=deepcopy(value);self.updated+=1
    ref=Ref();store=FirebaseStore(client=SimpleNamespace())
    store.company=lambda deal:CIRCLE if deal==CIRCLE.deal_id else None
    store._collection=lambda *args:SimpleNamespace(document=lambda key:ref,stream=lambda **kwargs:[ref.get()])
    record=new_record(CIRCLE.deal_id,'evidence-version',draft=realistic_draft())
    store.create_report_draft(record)
    assert ref.value['record']['storage_encoding']==ENCODING
    # Equal logical records may have different valid zlib byte streams.
    alternate=deepcopy(ref.value['record'])
    alternate['payload_base64']=base64.b64encode(zlib.compress(canonical_bytes(record),1)).decode()
    ref.value=envelope(alternate)
    assert store.create_report_draft(record)==record
    assert len(canonical(ref.value).encode())<800_000
    saved=store.update_report_draft(CIRCLE.deal_id,record['id'],1,edited_workspace())
    assert store.report_draft(CIRCLE.deal_id,record['id'])==saved
    assert saved['draft']==record['draft'] and saved['workspace']['revisions']==edited_workspace()['revisions']
    assert len(canonical(ref.value).encode())<800_000
    assert envelope(ref.value['record'])==ref.value
    with pytest.raises(DraftVersionConflict):store.update_report_draft(CIRCLE.deal_id,record['id'],1,edited_workspace())


@pytest.mark.parametrize('storage',['duckdb','firestore'])
def test_generation_auto_save_accepts_full_catalog_and_lists_correct_counts_before_and_after_edit(tmp_path,monkeypatch,storage):
    monkeypatch.setenv('UPLOAD_CACHE_ROOT',str(tmp_path/'uploads'))
    if storage=='duckdb':
        store=Store(tmp_path/'api.duckdb');store.initialize()
        store.ingest(IngestionResult(company=CIRCLE,snapshots=[],observations=[]))
    else:
        class Ref:
            id='large-draft';value=None;version=1
            def create(self,value,**kwargs):
                if self.value is not None:raise AlreadyExists('exists')
                self.value=deepcopy(value)
            def get(self,**kwargs):
                value=deepcopy(self.value)
                return SimpleNamespace(exists=value is not None,to_dict=lambda:value,update_time=self.version)
            def update(self,value,option,**kwargs):
                if option._last_update_time!=self.version:raise FailedPrecondition('changed')
                self.value=deepcopy(value);self.version+=1
        ref=Ref();store=FirebaseStore(client=SimpleNamespace())
        store.company=lambda deal:CIRCLE if deal==CIRCLE.deal_id else None
        store.companies=lambda:[CIRCLE]
        store.initialize=lambda:None;store.close=lambda:None
        for method in ('snapshots','observations','profiles','calculations','comparisons','document_claims','narrative_reports'):
            setattr(store,method,lambda *args:[])
        store._collection=lambda *args:SimpleNamespace(document=lambda key:ref,
            stream=lambda **kwargs:[] if ref.value is None else [SimpleNamespace(id=ref.id,exists=True,to_dict=lambda:deepcopy(ref.value))])
    draft=realistic_draft()
    class Generator:
        def generate(self,deal,request,catalog):
            return {**draft,'based_on_report_id':request.based_on_report_id}
    with TestClient(create_app(store=store,narrative_factory=Generator)) as client:
        report_id=client.get(f'/deals/{CIRCLE.deal_id}/report').json()['report_id']
        response=client.post(f'/deals/{CIRCLE.deal_id}/report/draft',json={'based_on_report_id':report_id,'sections':[{'id':'overview','title':'Overview'}]})
        assert response.status_code==200,response.text
        assert response.json()['persisted_version']==1 and response.json()['evidence_manifest']==draft['evidence_manifest']
        listing=client.get(f'/deals/{CIRCLE.deal_id}/report-drafts').json()
        assert listing['drafts'][0]['section_count']==6
        loaded=client.get(f'/deals/{CIRCLE.deal_id}/report-drafts/large-draft').json()
        assert loaded['draft']['source_graph']==draft['source_graph']
        saved=client.put(f'/deals/{CIRCLE.deal_id}/report-drafts/large-draft',json={'expected_version':1,'workspace':edited_workspace()})
        assert saved.status_code==200,saved.text
        assert saved.json()['section_count']==1
        listing=client.get(f'/deals/{CIRCLE.deal_id}/report-drafts').json()
        assert listing['drafts'][0]['section_count']==1


def test_compression_bombs_malformed_envelopes_and_incompressible_content_are_rejected():
    original=encode_record(new_record(CIRCLE.deal_id,'evidence-version',draft=realistic_draft()))
    for change in ({'payload_base64':'not-base64'}, {'storage_encoding':'unknown-format'},
                   {'decoded_bytes':MAX_LOGICAL_BYTES+1}, {'decoded_sha256':'f'*64}, {'version':99}, {'version':True}, {'section_count':True}):
        with pytest.raises(ValueError,match='integrity|size'):decode_record({**original,**change})
    huge=b'x'*(MAX_LOGICAL_BYTES+1)
    bomb={**original,'payload_base64':base64.b64encode(zlib.compress(huge,9)).decode(),'decoded_bytes':MAX_LOGICAL_BYTES}
    with pytest.raises(ValueError,match='integrity|size'):decode_record(bomb)
    trailing={**original,'payload_base64':base64.b64encode(base64.b64decode(original['payload_base64'])+b'trailing').decode()}
    with pytest.raises(ValueError,match='integrity|size'):decode_record(trailing)
    nested=b'['*20000+b'0'+b']'*20000
    malformed={**original,'payload_base64':base64.b64encode(zlib.compress(nested)).decode(),
               'decoded_bytes':len(nested),'decoded_sha256':hashlib.sha256(nested).hexdigest()}
    with pytest.raises(ValueError,match='integrity|size'):decode_record(malformed)
    incompressible=new_record(CIRCLE.deal_id,'evidence-version',draft={'id':'random','opaque':base64.b64encode(os.urandom(900000)).decode()})
    with pytest.raises(ValueError,match='lossless compression'):encode_record(incompressible)
    with pytest.raises(ValueError,match='5 MB'):new_record(CIRCLE.deal_id,'evidence-version',draft={'id':'too-large','data':'x'*MAX_LOGICAL_BYTES})
    oversized=edited_workspace();oversized['sections'][0]['content']='x'*MAX_WORKSPACE_BYTES
    with pytest.raises(ValueError,match='5 MB'):new_record(CIRCLE.deal_id,'evidence-version',workspace=oversized)


def test_corrupt_payload_is_unavailable_without_breaking_other_shared_reports(tmp_path):
    store=Store(tmp_path/'corrupt.duckdb');store.initialize()
    store.ingest(IngestionResult(company=CIRCLE,snapshots=[],observations=[]))
    bad=encode_record(new_record(CIRCLE.deal_id,'evidence-version',draft=realistic_draft()))
    bad['payload_base64']='malformed'
    store._connect().execute('INSERT INTO report_drafts VALUES (?,?,?,?)',[bad['id'],CIRCLE.deal_id,1,json.dumps(bad)])
    good=new_record(CIRCLE.deal_id,'evidence-version',draft={'id':'good','sections':[]})
    store.create_report_draft(good)
    with TestClient(create_app(store=store)) as client:
        listed=client.get(f'/deals/{CIRCLE.deal_id}/report-drafts')
        assert listed.status_code==200
        rows={row['id']:row for row in listed.json()['drafts']}
        assert rows[bad['id']]['unavailable'] is True and rows['good']['id']=='good'
        detail=client.get(f'/deals/{CIRCLE.deal_id}/report-drafts/{bad["id"]}')
        assert detail.status_code==409 and detail.json()['detail']['code']=='draft_storage_integrity'
        assert client.get(f'/deals/{CIRCLE.deal_id}/report-drafts/good').status_code==200
        assert client.get('/deals').status_code==200


def test_missing_headers_outer_envelope_failures_and_foreign_records_stay_isolated(tmp_path):
    from app.report_storage import record_for_listing
    record=new_record(CIRCLE.deal_id,'evidence-version',draft=realistic_draft())
    stored=encode_record(record)
    for key,value in (('version',None),('version',True),('id',None),('updated_at',None),
                      ('model','x'*2049),('based_on_report_id','x'*2049),('id','x'*2049),
                      ('created_at','x'*101),('version',9007199254740992)):
        broken={**record,key:value}
        with pytest.raises(ValueError):decode_record(broken)
        listed=record_for_listing(broken,deal_id=CIRCLE.deal_id,draft_id='known-row',version=1)
        assert listed['unavailable'] is True and listed['id']=='known-row'
    missing=deepcopy(stored);del missing['created_at'];del missing['updated_at'];del missing['version']
    class Document:
        id='known-document'
        exists=True
        def to_dict(self):return {'schema_version':1,'record':missing,'record_sha256':'invalid-outer-hash'}
    cloud=FirebaseStore(client=SimpleNamespace())
    cloud._collection=lambda *args:SimpleNamespace(stream=lambda **kwargs:[Document()])
    damaged=cloud.report_drafts(CIRCLE.deal_id)[0]
    assert damaged['unavailable'] is True and damaged['id']=='known-document'
    assert damaged['created_at']==damaged['updated_at']=='' and damaged['version']==0
    path=tmp_path/'scope.duckdb';store=Store(path);store.initialize()
    store.ingest(IngestionResult(company=CIRCLE,snapshots=[],observations=[]))
    foreign={**record,'id':'foreign-report','deal_id':'foreign-company'}
    store._connect().execute('INSERT INTO report_drafts VALUES (?,?,?,?)',
        ['selected-row',CIRCLE.deal_id,1,json.dumps(encode_record(foreign))])
    assert store.report_drafts(CIRCLE.deal_id)[0]['unavailable'] is True
    with pytest.raises(ValueError,match='scope'):store.report_draft(CIRCLE.deal_id,'selected-row')
    with pytest.raises(ValueError,match='scope'):store.update_report_draft(CIRCLE.deal_id,'selected-row',1,edited_workspace())
    store.close()


def test_an_uncompressible_edit_does_not_overwrite_the_existing_shared_version(tmp_path):
    store=Store(tmp_path/'failed-edit.duckdb');store.initialize()
    store.ingest(IngestionResult(company=CIRCLE,snapshots=[],observations=[]))
    record=new_record(CIRCLE.deal_id,'evidence-version',draft=realistic_draft())
    store.create_report_draft(record)
    workspace=edited_workspace()
    workspace['revisions'][0]['before']=base64.b64encode(os.urandom(900000)).decode()
    with pytest.raises(ValueError,match='lossless compression'):
        store.update_report_draft(CIRCLE.deal_id,record['id'],1,workspace)
    assert store.report_draft(CIRCLE.deal_id,record['id'])==record
    store.close()


def test_exact_five_megabyte_utf8_boundary_and_combined_record_are_authoritative():
    record=new_record(CIRCLE.deal_id,'evidence-version',draft={'id':'boundary','sections':[],'padding':''})
    remaining=5_000_000-len(canonical_bytes(record))
    record['draft']['padding']='财'*(remaining//3)+'x'*(remaining%3)
    assert len(canonical_bytes(record))==5_000_000
    assert decode_record(encode_record(record))==record
    record['draft']['padding']+='x'
    with pytest.raises(ValueError,match='5 MB'):encode_record(record)
    workspace=edited_workspace()
    workspace['revisions']=[{**revision,'id':f'{number}-{revision["id"]}'}
        for number in range(4) for revision in workspace['revisions']]
    assert len(canonical_bytes(workspace))<5_000_000
    with pytest.raises(ValueError,match='complete shared report'):
        new_record(CIRCLE.deal_id,'evidence-version',draft=realistic_draft(),workspace=workspace)
