import json
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest
from reportlab.pdfgen import canvas

from app.document_intake import (DocumentClaim, document_claims, initialize_documents,
                                 save_document_claims)
from app.main import create_app
from app.schemas import Company
from app.store import Store
from backend.evidence.import_claims import validate_claims
from backend.evidence.prepare_pdf import prepare_pdf
from backend.evidence.save_to_db import save_prepared
from backend.evidence.prepare_office import prepare_office
from office_fixtures import write_docx, write_pptx


@pytest.fixture
def prepared(tmp_path):
    pdf = tmp_path / 'deck.pdf'
    doc = canvas.Canvas(str(pdf))
    doc.drawString(40, 750, 'Revenue forecast for 2021: EUR 1,234.56789 million.')
    doc.drawString(40, 730, 'The company provides payment processing services.')
    doc.save()
    run = tmp_path / 'run'
    prepare_pdf(pdf, 'test-deal', run, entities=[], context_pages=0)
    registry = json.loads((run / 'registry.json').read_text())
    packet = json.loads((run / 'packet.json').read_text())
    fact = dict(metric_key='reported.revenue', label='Revenue', raw_value='1,234.56789',
                unit='EUR', currency='EUR', scale_multiplier='1000000',
                normalization_basis='Source explicitly states EUR million', scope=None,
                accounting_basis=None, period_kind='unknown', period_start=None, period_end=None,
                period_label='2021', scenario='forecast')
    numeric = dict(subject_entity_id=None, subject_entity_name='Source company', claim_type='financial',
                   statement='Forecast revenue of EUR 1,234.56789 million in 2021.', effective_date=None,
                   limitations=['Reported forecast; not actual results.'], numeric=fact,
                   evidence=[dict(physical_page=1, section=None, quote='Revenue forecast for 2021: EUR 1,234.56789 million.')])
    text = dict(subject_entity_id=None, subject_entity_name='Source company', claim_type='business',
                statement='The company provides payment processing services.', effective_date=None,
                limitations=[], evidence=[dict(physical_page=1, section=None,
                                             quote='The company provides payment processing services.')])
    bundle = validate_claims({'claims': [numeric, text], 'open_questions': []}, registry, packet, 'test-fixture-model')
    handoff = tmp_path / 'handoff.json'
    handoff.write_text(json.dumps(bundle))
    company = Company(deal_id='test-deal', entity_key='test-entity', legal_name='Test Company',
                      domain='example.test', country='FIN')
    return run, handoff, company, numeric, registry, packet


def test_real_pdf_numbers_and_text_survive_reopen_and_c_normalization(prepared, tmp_path):
    run, handoff, company, *_ = prepared
    database = tmp_path / 'shared.duckdb'
    with Store(database) as store:
        receipt = save_prepared(store, run, handoff, company, tmp_path / 'cache', submit_numbers=True)
        assert receipt['document_claims_added'] == 2
        assert receipt['numeric_candidates'] == 1
        assert receipt['numeric_intake']['observations_added'] == 1
        number = store.observations(company.deal_id)[0]
        assert number.raw_value == '1,234.56789'
        assert number.value == Decimal('1234567890.00000')
        assert number.scenario == 'forecast'
        assert number.period_kind == 'unknown'
        assert number.definition_key is None and number.verification_status == 'needs_review'
        repeat = save_prepared(store, run, handoff, company, tmp_path / 'cache', submit_numbers=True)
        assert repeat['document_claims_added'] == repeat['numeric_intake']['observations_added'] == 0
    with Store(database) as store:
        rows = document_claims(store, company.deal_id)
        assert len(rows) == 2
        assert {c.claim_type for c in rows} == {'financial', 'business'}
        assert all(c.verification_status == 'needs_review' for c in rows)
        assert all(store.snapshot(c.snapshot_id) is not None for c in rows)
        assert document_claims(store, 'other-deal') == []


def test_c_api_reads_text_and_accepts_exported_numeric_packet(prepared, tmp_path):
    run, handoff, company, *_ = prepared
    store = Store(':memory:')
    store.initialize()
    save_prepared(store, run, handoff, company, tmp_path / 'cache')
    with TestClient(create_app(store)) as client:
        response = client.get('/deals/test-deal/document-claims?limit=1')
        assert response.status_code == 200 and len(response.json()['claims']) == 1
        packet = client.get('/deals/test-deal/document-numeric-packet').json()
        assert len(packet['claims']) == 1
        assert client.post('/deals/test-deal/claims/batch', json=packet).status_code == 200
        assert client.get('/deals/missing/document-claims').status_code == 404
        assert client.get('/deals/test-deal/document-claims?offset=-1').status_code == 422


@pytest.mark.parametrize('change', ['quote', 'number', 'deal', 'company'])
def test_invalid_handoff_rejected_before_data_writes(prepared, tmp_path, change):
    run, handoff, company, *_ = prepared
    bundle = json.loads(handoff.read_text())
    if change == 'quote':
        bundle['evidence'][0]['quote'] = 'This fabricated quotation never appeared in the source.'
    elif change == 'number':
        bundle['claims'][0]['numeric']['raw_value'] = '999.999'
    elif change == 'deal':
        bundle['deal']['deal_id'] = 'another-deal'
    else:
        company = company.model_copy(update={'deal_id': 'another-deal'})
    handoff.write_text(json.dumps(bundle))
    with Store(':memory:') as store:
        with pytest.raises((ValueError, ValidationError)):
            save_prepared(store, run, handoff, company, tmp_path / 'cache', submit_numbers=True)
        assert store.company('test-deal') is None
        assert store.snapshots('test-deal') == []


def test_incomplete_period_and_scale_remain_unknown_with_raw_metadata(prepared, tmp_path):
    run, handoff, company, *_ = prepared
    bundle = json.loads(handoff.read_text())
    bundle['claims'][0]['numeric'].update(period_kind='duration', scale_multiplier='million')
    handoff.write_text(json.dumps(bundle))
    with Store(':memory:') as store:
        save_prepared(store, run, handoff, company, tmp_path / 'cache', submit_numbers=True)
        row = next(c for c in document_claims(store, company.deal_id) if c.numeric)
        assert row.numeric.period_kind == 'unknown'
        assert row.numeric.period_label == '2021'
        assert row.numeric_source['period_kind'] == 'duration'
        assert row.numeric_source['scale_multiplier'] == 'million'
        assert row.numeric.scale_multiplier is None
        number = store.observations(company.deal_id)[0]
        assert number.raw_value == '1,234.56789' and number.value is None


def test_immutable_batch_rolls_back_and_rejects_cross_deal_evidence(prepared, tmp_path):
    run, handoff, company, *_ = prepared
    with Store(':memory:') as store:
        save_prepared(store, run, handoff, company, tmp_path / 'cache')
        rows = document_claims(store, company.deal_id)
        first = rows[0].model_copy(update={'id': 'new-id'})
        conflict = rows[1].model_copy(update={'statement': 'Changed without new ID'})
        with pytest.raises(ValueError, match='immutable'):
            save_document_claims(store, company, [first, conflict])
        assert len(document_claims(store, company.deal_id)) == 2
        hostile = deepcopy(rows[0].model_dump(mode='json'))
        hostile['id'] = 'foreign-evidence'
        hostile['evidence'][0]['snapshot_id'] = 'unregistered'
        with pytest.raises(ValueError, match='not registered'):
            save_document_claims(store, company, [DocumentClaim.model_validate(hostile)])


def test_modified_original_is_rejected(prepared, tmp_path):
    run, handoff, company, *_ = prepared
    original = run / 'sources/original.pdf'
    original.write_bytes(original.read_bytes() + b'changed')
    with Store(':memory:') as store:
        with pytest.raises(ValueError, match='hash mismatch'):
            save_prepared(store, run, handoff, company, tmp_path / 'cache')
        assert store.snapshots(company.deal_id) == []


def test_raw_numeric_cannot_match_substring_of_another_number(prepared):
    _, _, _, numeric, registry, packet = prepared
    numeric['numeric']['raw_value'] = '234.56789'
    with pytest.raises(ValueError, match='complete token'):
        validate_claims({'claims': [numeric], 'open_questions': []}, registry, packet, 'test')


def test_existing_c_database_needs_no_extension_until_document_ingestion():
    with Store(':memory:') as store:
        assert document_claims(store, 'absent') == []
        initialize_documents(store)
        store.initialize()
        assert document_claims(store, 'absent') == []


@pytest.mark.parametrize('suffix,writer', [('.docx', write_docx), ('.pptx', write_pptx)])
def test_office_original_and_pdf_view_remain_distinct_in_database(tmp_path, suffix, writer):
    source = writer(tmp_path / ('office' + suffix))
    output = tmp_path / 'office-run'
    summary = prepare_office(source, 'office-deal', output, entities=[], context_pages=0)
    run = Path(summary['prepared_run'])
    registry = json.loads((run / 'registry.json').read_text())
    packet = json.loads((run / 'packet.json').read_text())
    # Use actual native text also present on a rendered page; the model is mocked.
    native = json.loads((output / 'native-blocks.json').read_text())
    quote = next(b['text'] for b in native['blocks'] if len(b['text']) >= 10
                 and any(b['text'] in p['text'] for p in packet['pages']))
    page = next(p['physical_page'] for p in packet['pages'] if quote in p['text'])
    payload = dict(subject_entity_id=None, subject_entity_name='Office example', claim_type='business',
                   statement=quote, effective_date=None, limitations=[],
                   evidence=[dict(physical_page=page, section=None, quote=quote)])
    bundle = validate_claims({'claims': [payload], 'open_questions': []}, registry, packet, 'mock-office')
    handoff = tmp_path / 'office-handoff.json'
    handoff.write_text(json.dumps(bundle))
    company = Company(deal_id='office-deal', entity_key='office-entity', legal_name='Office company',
                      domain='example.test', country='FIN')
    with Store(':memory:') as store:
        receipt = save_prepared(store, run, handoff, company, tmp_path / 'cache')
        assert receipt['original_snapshot_id'] != receipt['reading_snapshot_id']
        evidence = document_claims(store, company.deal_id)[0].evidence[0]
        assert evidence['representation_kind'] == 'converted_pdf'
        assert evidence['original_locators']
        assert store.snapshot(evidence['snapshot_id']).original_filename == 'reading-view.pdf'
        assert store.snapshot(evidence['original_snapshot_id']).original_filename.endswith(suffix)
        store.initialize()
