from copy import deepcopy
from decimal import Decimal
from hashlib import sha256
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient
import httpx
import pytest

from app.company_chat import CompanyChat, CompanyChatRequest, validate_answer
from app.evidence_catalog import add_document_claims, build_evidence_catalog
from app.main import create_app
from app.narrative import NarrativeError
from app.schemas import CIRCLE, IngestionResult, Observation, SourceSnapshot
from app.store import Store


@pytest.fixture
def workspace(tmp_path):
    source = SourceSnapshot(id='financial-file', deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        provider='uploaded', source_kind='csv', original_filename='finance.csv',
        source_uri='upload://finance.csv', sha256='a'*64)
    rows = [Observation(id=f'row-{i}', deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        snapshot_id=source.id, provider='uploaded', metric_key=f'uploaded.metric_{i}', raw_label=f'Metric {i}',
        raw_value=str(i), value=Decimal(i), unit='USD', currency='USD', normalization_status='confirmed',
        scale_multiplier=Decimal(1), normalization_basis='source unit', locator={'kind':'csv_row','row':i+1})
        for i in range(1,26)]
    store = Store(str(tmp_path/'company.duckdb')); store.initialize()
    store.ingest(IngestionResult(company=CIRCLE, snapshots=[source], observations=rows))
    claim = {'id':'document-claim', 'deal_id':CIRCLE.deal_id, 'entity_key':CIRCLE.entity_key,
        'snapshot_id':source.id, 'statement':'Extractor paraphrase, not the original sentence.',
        'claim_type':'company_description','extractor_version':'fixture-v1','limitations':[],
        'evidence':[{'snapshot_id':source.id,'quote':'The company provides payment infrastructure.',
            'locator':{'kind':'csv_row','row':1},'quote_match_rule':'fixture_rule'}]}
    # Simulate B's existing extension; application code never creates this table.
    store._connect().execute('CREATE TABLE document_claims (id VARCHAR, deal_id VARCHAR, payload JSON)')
    store._connect().execute('INSERT INTO document_claims VALUES (?, ?, ?)',[claim['id'],CIRCLE.deal_id,json.dumps(claim)])
    yield store, claim
    store.close()


def test_report_quotes_use_B_evidence_and_change_report_identity_when_the_quote_changes(workspace):
    store,claim=workspace
    with TestClient(create_app(store=store)) as client:
        report=client.get(f'/deals/{CIRCLE.deal_id}/report').json()
        quoted=next(e for e in report['narrative_evidence'] if e['id'].startswith('claim:'))
        assert quoted['text']==claim['evidence'][0]['quote']
        assert quoted['text']!=claim['statement']
        assert quoted['source']['sha256']=='a'*64 and quoted['source']['locator']['row']==1
        assert quoted['quote_match_rule']=='fixture_rule'
        assert report['source_files'][0]['preview_available'] is False
        before=report['report_id']
        claim['evidence'][0]['quote']='The company provides a different reported service.'
        store._connect().execute('UPDATE document_claims SET payload=?',[json.dumps(claim)])
        assert client.get(f'/deals/{CIRCLE.deal_id}/report').json()['report_id']!=before


def test_foreign_document_claims_fail_before_they_reach_the_frontend_or_model(workspace):
    store,claim=workspace
    claim['entity_key']='foreign-entity'
    store._connect().execute('UPDATE document_claims SET payload=?',[json.dumps(claim)])
    with TestClient(create_app(store=store)) as client:
        assert client.get(f'/deals/{CIRCLE.deal_id}/report').status_code==409


def test_chat_receives_all_company_records_including_offscreen_values_and_claims(workspace):
    store,claim=workspace; seen=[]
    class FakeChat:
        def answer(self,deal,request,catalog,context):
            seen.append(context)
            item=next(e for e in catalog if e['id']=='row-25')
            return {'deal_id':deal,'report_id':request.report_id,'answer':'Metric 25 is recorded as 25 USD.',
                'state':'verify','citations':[{'evidence_id':item['id'],'quote':item['text']}]}
    with TestClient(create_app(store=store,chat_factory=FakeChat)) as client:
        report=client.get(f'/deals/{CIRCLE.deal_id}/report').json()
        response=client.post(f'/deals/{CIRCLE.deal_id}/chat',json={'question':'Explain the last metric.',
            'report_id':report['report_id'],'page':'Report','context_scope':'entire_company',
            'history':[],'working_draft':{'sections':[{'content':'Human interpretation is not evidence.'}]}})
        assert response.status_code==200,response.text
        assert len(seen)==1 and len(seen[0]['observations'])==25
        assert seen[0]['document_claims']==[claim]
        assert 'local_path' not in seen[0]['source_snapshots'][0]
        assert seen[0]['profiles']==[] and seen[0]['calculations']==[]
        assert response.json()['citations'][0]['evidence_id']=='row-25'
        assert client.post(f'/deals/{CIRCLE.deal_id}/chat',json={'question':'Ask','report_id':'stale'}).status_code==409
        assert len(seen)==1
        assert client.post('/deals/foreign/chat',json={'question':'Ask','report_id':report['report_id']}).status_code==404


def test_narrative_endpoint_uses_the_current_report_and_original_quotations(workspace):
    store,claim=workspace; seen=[]
    class FakeNarrative:
        def generate(self,deal,request,catalog):
            seen.extend(catalog);return {'id':'draft','deal_id':deal,'based_on_report_id':request.based_on_report_id}
    with TestClient(create_app(store=store,narrative_factory=FakeNarrative)) as client:
        report=client.get(f'/deals/{CIRCLE.deal_id}/report').json()
        body={'based_on_report_id':report['report_id'],'sections':[{'id':'overview','title':'Overview'}]}
        assert client.post(f'/deals/{CIRCLE.deal_id}/report/draft',json=body).status_code==200
        assert any(e['text']==claim['evidence'][0]['quote'] for e in seen)
        body['based_on_report_id']='stale'
        assert client.post(f'/deals/{CIRCLE.deal_id}/report/draft',json=body).status_code==409


def catalog():
    return [{'id':'claim:one:evidence:0','deal_id':'circle','kind':'statement','title':'Claim',
        'text':'Circle reports 14 customers.','quote_basis':'source_text',
        'source':{'snapshot_id':'pdf','file_name':'company.pdf','sha256':'a'*64,'provider':'uploaded',
                  'locator':{'kind':'pdf_page','page':5},'preview_url':'/sources/pdf/file'}}]


@pytest.mark.parametrize('patch',[
    {'citations':[{'evidence_id':'foreign','quote':'Circle reports 14 customers.'}]},
    {'citations':[{'evidence_id':'claim:one:evidence:0','quote':'Circle reports 16 customers.'}]},
    {'answer':'Circle reports 16 customers.'}, {'state':'verified'}, {'citations':[]},
    {'state':'conflict','citations':[]}, {'extra':'untrusted'},
])
def test_chat_rejects_unknown_sources_invented_quotes_numbers_and_verified_state(patch):
    payload={'answer':'Circle reports 14 customers.','state':'verify',
        'citations':[{'evidence_id':'claim:one:evidence:0','quote':'Circle reports 14 customers.'}]}
    with pytest.raises(ValueError):validate_answer({**payload,**patch},catalog())


def test_chat_preserves_source_binding_and_missing_answer_requires_no_invented_facts():
    payload={'answer':'Circle reports 14 customers.','state':'verify',
        'citations':[{'evidence_id':'claim:one:evidence:0','quote':'14 customers'}]}
    result=validate_answer(payload,catalog())
    assert result['citations'][0]['source']['locator']['page']==5
    assert result['citations'][0]['quote_basis']=='source_text'
    assert validate_answer({'answer':'Runway cannot be determined from the available records.','state':'missing','citations':[]},catalog())['state']=='missing'


def test_chat_has_one_bounded_repair_and_sends_full_context_without_credentials():
    seen=[]
    def provider(request):
        seen.append(json.loads(request.content))
        answer={'answer':'Circle reports 14 customers.','state':'verify',
            'citations':[{'evidence_id':'invented' if len(seen)==1 else 'claim:one:evidence:0','quote':'14 customers'}]}
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(answer)}}]})
    settings=SimpleNamespace(model_key='private-key',nicrron_base_url='https://api.nicrron.ai/v1',model='openai/gpt-6.1-sol')
    with httpx.Client(transport=httpx.MockTransport(provider)) as model:
        result=CompanyChat(settings,model).answer('circle',CompanyChatRequest(question='How many customers?',report_id='report'),catalog(),{'all_records':['offscreen']})
    assert len(seen)==2 and result['context_scope']=='entire_company'
    assert json.loads(seen[0]['messages'][1]['content'])['company_context']['all_records']==['offscreen']
    assert 'private-key' not in json.dumps(seen)
    assert result['citations'][0]['source']['sha256']=='a'*64
