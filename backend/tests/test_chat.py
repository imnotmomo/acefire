import hashlib
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.chat import answer, catalog, chat_router
from app.schemas import Company, IngestionResult, SourceSnapshot
from app.store import Store

@pytest.fixture
def ledger(tmp_path):
    store = Store(':memory:'); store.initialize()
    for deal, text in [('alpha', 'Revenue forecast for 2027 is EUR 120 million.'), ('beta', 'Secret customer is PRIVATECO.')]:
        path = tmp_path / (deal + '.txt'); path.write_text(text)
        company = Company(deal_id=deal, entity_key=deal, legal_name=deal, domain='test.example', country='FI')
        source = SourceSnapshot(id=deal+'-source', deal_id=deal, entity_key=deal, provider='uploaded', source_kind='text', source_uri=path.as_uri(), local_path=str(path), sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        store.ingest(IngestionResult(company=company, snapshots=[source], observations=[]))
    yield store
    store.close()

class Model:
    def __init__(self, forged=False, supported=True):
        self.calls = []; self.forged = forged; self.supported = supported
    def complete(self, messages, **kwargs):
        self.calls.append(messages)
        if len(self.calls) == 1:
            context = json.loads(messages[1]['content'])
            assert 'PRIVATECO' not in messages[1]['content']
            source = 'beta-source' if self.forged else context['evidence'][0]['id']
            payload = {'statements': [{'text': 'Forecast revenue in 2027 is EUR 120 million.', 'source_ids': [source]}], 'gaps': []}
        else:
            payload = {'supported': [self.supported]}
        return {'response': {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(payload)}}]}}

def test_cites_exact_raw_excerpt(ledger):
    model = Model(); result = answer(ledger, 'alpha', 'Revenue forecast?', model)
    assert result['status'] == 'answered' and '[1]' in result['answer']
    source = result['sources'][0]
    assert source['source']['snapshot_id'] == 'alpha-source'
    assert source['source']['locator'] == {'kind': 'text_line', 'line': 1}
    assert source['excerpt'] == 'Revenue forecast for 2027 is EUR 120 million.'
    assert len(model.calls) == 2

def test_unknown_reference_fails_closed(ledger):
    with pytest.raises(ValueError, match='outside'):
        answer(ledger, 'alpha', 'revenue', Model(forged=True))

def test_unsupported_statement_withheld(ledger):
    result = answer(ledger, 'alpha', 'revenue', Model(supported=False))
    assert result['status'] == 'insufficient_evidence'
    assert result['sources'] == result['statements'] == []
    assert result['gaps']

def test_no_evidence_does_not_call_model(ledger):
    model = Model(); result = answer(ledger, 'alpha', 'antimatter', model)
    assert result['status'] == 'insufficient_evidence' and model.calls == []

def test_tampered_original_excluded(ledger):
    Path(ledger.snapshot('alpha-source').local_path).write_text('Revenue invented')
    records, gaps, count = catalog(ledger, 'alpha')
    assert not records and gaps and count == 1

def test_api_deal_and_question_validation(ledger):
    app = FastAPI(); app.include_router(chat_router(ledger, Model))
    with TestClient(app) as client:
        assert client.post('/deals/alpha/chat', json={'question': 'revenue'}).status_code == 200
        assert client.post('/deals/missing/chat', json={'question': 'revenue'}).status_code == 404
        assert client.post('/deals/alpha/chat', json={'question': '  '}).status_code == 422
        assert client.post('/deals/alpha/chat', json={'question': 'x'*4001}).status_code == 422

def test_api_rejects_forged_citations(ledger):
    app = FastAPI(); app.include_router(chat_router(ledger, lambda: Model(forged=True)))
    with TestClient(app) as client:
        assert client.post('/deals/alpha/chat', json={'question': 'revenue'}).status_code == 502

def test_xlsx_and_office_native_locators(ledger, tmp_path):
    from openpyxl import Workbook
    from office_fixtures import write_docx, write_pptx
    for suffix in ['xlsx', 'docx', 'pptx']:
        path = tmp_path / ('raw.' + suffix)
        if suffix == 'xlsx':
            book = Workbook(); book.active.title = 'Forecast'
            book.active.append(['Revenue forecast', '=100+20']); book.save(path)
        elif suffix == 'docx':
            write_docx(path)
        else:
            write_pptx(path)
        source = SourceSnapshot(id=suffix, deal_id='alpha', entity_key='alpha', provider='uploaded', source_kind=suffix, source_uri=path.as_uri(), local_path=str(path), sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        ledger.ingest(IngestionResult(company=ledger.company('alpha'), snapshots=[source], observations=[]))
    records, gaps, _ = catalog(ledger, 'alpha')
    assert {r['source']['locator']['kind'] for r in records} >= {'text_line', 'xlsx_cell', 'docx_paragraph', 'pptx_paragraph'}
    sheet = next(r for r in records if r['source']['snapshot_id'] == 'xlsx')
    assert '=100+20' in sheet['excerpt'] and sheet['source']['locator']['sheet'] == 'Forecast'


def test_model_unavailable_is_sanitized(ledger):
    from integrations.nicrron import NicrronError
    class Broken:
        def complete(self, *args, **kwargs):
            raise NicrronError('private upstream details')
    app = FastAPI(); app.include_router(chat_router(ledger, Broken))
    with TestClient(app) as client:
        response = client.post('/deals/alpha/chat', json={'question': 'revenue'})
        assert response.status_code == 503
        assert 'private upstream' not in response.text

def test_existing_calculation_and_comparison_keep_provenance(ledger):
    from decimal import Decimal
    from app.schemas import Observation, Calculation, Comparison
    rows = [Observation(id=f'obs-{i}', deal_id='alpha', entity_key='alpha', snapshot_id='alpha-source',
                        provider='uploaded', metric_key='revenue', raw_label='Revenue', raw_value=str(i),
                        locator={'kind': 'text_line', 'line': 1}) for i in [1, 2]]
    ledger.ingest(IngestionResult(company=ledger.company('alpha'), snapshots=[], observations=rows))
    ledger.save_calculation(Calculation(id='calc', deal_id='alpha', metric_key='revenue', function_key='existing',
                                       formula='existing stored formula', status='succeeded', value=Decimal('3'),
                                       input_ids=['obs-1','obs-2'], input_snapshots=['alpha-source']))
    ledger.save_comparison(Comparison(id='comparison', deal_id='alpha', lhs_id='obs-1', rhs_id='obs-2',
                                      status='not_comparable', tolerance=Decimal('0')))
    records, _, _ = catalog(ledger, 'alpha')
    assert any(r['kind'] == 'calculation' and 'existing stored formula' in r['excerpt'] for r in records)
    assert any(r['kind'] == 'comparison' and 'not_comparable' in r['excerpt'] for r in records)
