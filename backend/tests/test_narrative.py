import json
from types import SimpleNamespace

import httpx
import pytest
from pydantic import ValidationError

from app.narrative import NarrativeDraftRequest, NarrativeError, NarrativeGenerator


def settings(key='private-model-key'):
    return SimpleNamespace(model_key=key, nicrron_base_url='https://api.nicrron.ai/v1', model='openai/gpt-6.1-sol')


def source(snapshot='profile-file', **patch):
    return {'snapshot_id': snapshot, 'file_name': 'profile.json' if snapshot == 'profile-file' else 'financial.xlsx',
            'sha256': 'a' * 64 if snapshot == 'profile-file' else 'b' * 64, 'provider': 'akta' if snapshot == 'profile-file' else 'orbis',
            'locator': {'kind': 'json_pointer', 'pointer': '/response/data/description'} if snapshot == 'profile-file' else {'kind': 'xlsx_cell', 'sheet': 'Assets', 'cell': 'I49'},
            'location': {'pointer': '/response/data/description'} if snapshot == 'profile-file' else {'sheet': 'Assets', 'cell': 'I49'},
            'preview_url': f'/sources/{snapshot}/file', 'local_path': '/must/not/send/to/model', **patch}


@pytest.fixture
def catalog():
    return [
        {'id': 'statement-1', 'deal_id': 'circle', 'kind': 'statement', 'title': 'Company description',
         'text': 'Circle was founded in 2013. It provides payment infrastructure.',
         'quote_basis': 'source_text', 'source': source(), 'profile_snapshot_id': 'profile-file', 'profile_pointer': '/response/data/description'},
        {'id': 'observation-1', 'deal_id': 'circle', 'kind': 'observation', 'title': 'Reported assets',
         'text': 'Reported assets: 1,000.00 USD. Source period: 2024-12-31. Definition is unreviewed.',
         'quote_basis': 'structured_record', 'source': source('financial-file')},
        {'id': 'calculation-1', 'deal_id': 'circle', 'kind': 'calculation', 'title': 'Stored calculation',
         'text': 'Stored source-component sum: 1,100 USD. Model-generated interpretation is unverified.',
         'quote_basis': 'structured_record', 'sources': [source('financial-file')]},
    ]


def draft_request(**patch):
    return NarrativeDraftRequest.model_validate({
        'based_on_report_id': 'report-version-1',
        'sections': [{'id': 'overview', 'title': 'Company overview', 'topics': ['Company profile']},
                     {'id': 'financials', 'title': 'Financials', 'topics': ['Assets']},
                     {'id': 'market', 'title': 'Market', 'topics': ['Market size']}],
        **patch,
    })


def output():
    return {'sections': [
        {'id': 'overview', 'claims': [{'text': 'Circle was founded in 2013.',
                                     'citations': [{'evidence_id': 'statement-1', 'quote': 'Circle was founded in 2013.'}]}], 'gaps': []},
        {'id': 'financials', 'claims': [{'text': 'Reported assets are 1000.00 USD; the definition remains unreviewed.',
                                       'kind': 'reported_summary', 'citations': [{'evidence_id': 'observation-1', 'quote': 'Reported assets: 1,000.00 USD.'}]}], 'gaps': []},
        {'id': 'market', 'claims': [], 'gaps': ['No market-size evidence was supplied.']},
    ]}


def client(outputs, seen):
    def respond(request):
        seen.append(json.loads(request.content))
        value = outputs[min(len(seen) - 1, len(outputs) - 1)]
        if isinstance(value, Exception): raise value
        if isinstance(value, httpx.Response): return value
        text = value if isinstance(value, str) else json.dumps(value)
        return httpx.Response(200, json={'choices': [{'message': {'content': text}}]})
    return httpx.Client(transport=httpx.MockTransport(respond))


def test_company_draft_binds_exact_quotes_hashes_and_structured_record_basis(catalog):
    seen = []
    with client([output()], seen) as model:
        draft = NarrativeGenerator(settings(), model).generate('circle', draft_request(), catalog)
    assert draft['deal_id'] == 'circle' and draft['based_on_report_id'] == 'report-version-1'
    assert draft['status'] == 'model_generated_unverified'
    assert draft['model'] == 'openai/gpt-6.1-sol' and len(seen) == 1
    assert '/must/not/send/to/model' not in json.dumps(seen)
    assert 'private-model-key' not in json.dumps(seen)
    first, financial = draft['sections'][0]['claims'][0], draft['sections'][1]['claims'][0]
    assert first['kind'] == 'reported_summary' and first['citations'][0]['quote_basis'] == 'source_text'
    assert first['citations'][0]['source']['locator']['pointer'] == '/response/data/description'
    assert first['citations'][0]['source']['sha256'] == 'a' * 64
    assert first['citations'][0]['profile_snapshot_id'] == 'profile-file'
    assert first['citations'][0]['profile_pointer'] == '/response/data/description'
    assert 'local_path' not in first['citations'][0]['source']
    assert financial['citations'][0]['kind'] == 'observation' and financial['citations'][0]['quote_basis'] == 'structured_record'
    assert draft['sections'][2]['claims'] == [] and draft['sections'][2]['gaps']
    assert all(edge['type'] == 'cited_support' and edge['data']['verification'] == 'unverified' for edge in draft['source_graph']['edges'])
    assert len(draft['source_graph']['nodes']) == 7 and len(draft['source_graph']['edges']) == 6
    assert draft['evidence_manifest'][0]['text'] == catalog[0]['text']


@pytest.mark.parametrize('problem,error_code', [
    ('invented_id', 'invalid_citation'), ('invented_quote', 'invalid_quote'),
    ('invented_number', 'unsupported_number'), ('uncited_number', 'unsupported_number'),
    ('no_citation', 'unsupported_claim'), ('model_source', 'invalid_citation'),
])
def test_factual_claims_cannot_invent_evidence_quotes_numbers_or_source_bindings(catalog, problem, error_code):
    value = output(); claim = value['sections'][0]['claims'][0]
    if problem == 'invented_id': claim['citations'][0]['evidence_id'] = 'invented'
    elif problem == 'invented_quote': claim['citations'][0]['quote'] = 'Circle was founded in 1999.'
    elif problem == 'invented_number': claim['text'] = 'Circle was founded in 1999.'
    elif problem == 'uncited_number': claim['text'] = 'Circle has 1,100 USD in assets.'
    elif problem == 'no_citation': claim['citations'] = []
    elif problem == 'model_source': claim['citations'][0]['source'] = {'file_name': 'invented.pdf'}
    seen = []
    with client([value], seen) as model, pytest.raises(NarrativeError) as caught:
        NarrativeGenerator(settings(), model).generate('circle', draft_request(), catalog)
    assert caught.value.code == error_code and len(seen) == 2
    assert 'single permitted repair' in str(caught.value)


def test_model_does_not_calculate_a_growth_rate_from_supplied_values(catalog):
    value = output(); value['sections'][1]['claims'][0].update(text='Assets grew by 10%.', citations=[
        {'evidence_id': 'observation-1', 'quote': 'Reported assets: 1,000.00 USD.'},
        {'evidence_id': 'calculation-1', 'quote': 'Stored source-component sum: 1,100 USD.'},
    ])
    with client([value], []) as model, pytest.raises(NarrativeError) as caught:
        NarrativeGenerator(settings(), model).generate('circle', draft_request(), catalog)
    assert caught.value.code == 'unsupported_number'


def test_inference_is_explicitly_labeled_and_keeps_its_actual_premise(catalog):
    value = output(); value['sections'][0]['claims'][0].update(
        text='The payment-infrastructure description suggests payments are relevant to its business.', kind='inference',
        citations=[{'evidence_id': 'statement-1', 'quote': 'It provides payment infrastructure.'}])
    with client([value], []) as model:
        draft = NarrativeGenerator(settings(), model).generate('circle', draft_request(), catalog)
    assert draft['sections'][0]['claims'][0]['kind'] == 'inference'


def test_bad_json_or_citation_can_be_repaired_once_with_sanitized_bounded_feedback(catalog):
    invalid = output(); invalid['sections'][0]['claims'][0]['citations'][0]['quote'] = 'Invented sentence.'
    seen = []
    with client([invalid, output()], seen) as model:
        draft = NarrativeGenerator(settings(), model).generate('circle', draft_request(), catalog)
    assert len(seen) == 2
    assert [item['status'] for item in draft['generation_attempts']] == ['rejected', 'accepted']
    feedback = json.loads(seen[1]['messages'][-1]['content'])
    assert feedback['previous_attempt']['error_code'] == 'invalid_quote'
    assert draft['sections'][0]['claims'][0]['citations'][0]['quote'] == 'Circle was founded in 2013.'


@pytest.mark.parametrize('field', ['claim', 'gap'])
def test_chinese_generated_prose_is_repaired_to_english(catalog, field):
    invalid = output()
    if field == 'claim':
        invalid['sections'][0]['claims'][0]['text'] = '公司成立于2013年。'
    else:
        invalid['sections'][2]['gaps'] = ['未提供市场规模证据。']
    seen = []
    with client([invalid, output()], seen) as model:
        draft = NarrativeGenerator(settings(), model).generate('circle', draft_request(), catalog)
    assert len(seen) == 2 and draft['language'] == 'en'
    assert draft['generation_attempts'][0]['error_code'] == 'invalid_output_language'
    assert 'English' in seen[1]['messages'][-1]['content']


def test_english_narrative_keeps_original_chinese_quote_and_source_binding(catalog):
    catalog[0]['text'] = '公司成立于2013年。'
    value = output()
    value['sections'][0]['claims'][0]['text'] = 'The company was founded in 2013.'
    value['sections'][0]['claims'][0]['citations'][0]['quote'] = catalog[0]['text']
    with client([value], []) as model:
        draft = NarrativeGenerator(settings(), model).generate('circle', draft_request(), catalog)
    citation = draft['sections'][0]['claims'][0]['citations'][0]
    assert draft['language'] == 'en' and citation['quote'] == '公司成立于2013年。'
    assert citation['source']['sha256'] == catalog[0]['source']['sha256']
    assert draft['evidence_manifest'][0]['text'] == catalog[0]['text']


@pytest.mark.parametrize('failure', ['missing_key', 'http', 'timeout'])
def test_configuration_and_provider_failures_do_not_retry_or_echo_credentials(catalog, failure):
    seen = []
    response = httpx.Response(401, text='private-model-key') if failure == 'http' else httpx.ReadTimeout('private-model-key')
    with client([response], seen) as model, pytest.raises(NarrativeError) as caught:
        NarrativeGenerator(settings('' if failure == 'missing_key' else 'private-model-key'), model).generate('circle', draft_request(), catalog)
    assert len(seen) == (0 if failure == 'missing_key' else 1)
    assert 'private-model-key' not in str(caught.value)
    assert caught.value.status_code == (503 if failure == 'missing_key' else 504 if failure == 'timeout' else 502)


def test_wrong_company_or_unknown_catalog_evidence_fails_before_provider(catalog):
    seen = []
    with client([output()], seen) as model, pytest.raises(NarrativeError) as caught:
        NarrativeGenerator(settings(), model).generate('another-company', draft_request(), catalog)
    assert caught.value.code == 'foreign_evidence' and seen == []
    with client([output()], seen) as model, pytest.raises(NarrativeError) as caught:
        NarrativeGenerator(settings(), model).generate('circle', draft_request(evidence_ids=['unknown']), catalog)
    assert caught.value.code == 'unknown_evidence' and seen == []


def test_section_preferences_remain_a_brief_and_duplicate_or_unsupported_shapes_fail(catalog):
    with pytest.raises(ValidationError):
        draft_request(sections=[{'id': 'overview', 'title': 'One'}, {'id': 'overview', 'title': 'Two'}])
    value = output(); value['sections'].pop()
    with client([value], []) as model, pytest.raises(NarrativeError) as caught:
        NarrativeGenerator(settings(), model).generate('circle', draft_request(), catalog)
    assert caught.value.code == 'invalid_narrative'
    value = output(); value['sections'][2]['gaps'] = []
    with client([value], []) as model, pytest.raises(NarrativeError) as caught:
        NarrativeGenerator(settings(), model).generate('circle', draft_request(), catalog)
    assert caught.value.code == 'invalid_narrative'


def test_unknown_file_locations_remain_unknown_instead_of_being_invented(catalog):
    catalog[0]['source']['locator'] = None
    with client([output()], []) as model:
        draft = NarrativeGenerator(settings(), model).generate('circle', draft_request(), catalog)
    assert draft['sections'][0]['claims'][0]['citations'][0]['source']['locator'] is None


def test_existing_b_document_claim_quotes_keep_the_claim_fk_and_extraction_match_rule():
    record = {'id': 'claim:claim-17:evidence:0', 'deal_id': 'enfuce-2020', 'kind': 'statement',
              'title': 'Business description', 'text': 'Enfuce supplies payment services.',
              'document_claim_id': 'claim-17', 'evidence_index': 0, 'quote_match_rule': 'normalized_whitespace',
              'quote_basis': 'source_text', 'source': source('financial-file', provider='uploaded', file_name='Enfuce.pdf', locator={'kind': 'pdf_page', 'page': 2})}
    response = {'sections': [{'id': 'overview', 'claims': [{'text': 'Enfuce supplies payment services.',
                    'citations': [{'evidence_id': record['id'], 'quote': record['text']}]}], 'gaps': []}]}
    req = draft_request(sections=[{'id': 'overview', 'title': 'Company overview'}])
    with client([response], []) as model:
        draft = NarrativeGenerator(settings(), model).generate('enfuce-2020', req, [record])
    citation = draft['sections'][0]['claims'][0]['citations'][0]
    assert draft['deal_id'] == 'enfuce-2020'
    assert citation['document_claim_id'] == 'claim-17' and citation['evidence_index'] == 0
    assert citation['quote_match_rule'] == 'normalized_whitespace'
    assert citation['source']['file_name'] == 'Enfuce.pdf' and citation['source']['locator']['page'] == 2
    assert 'profile_snapshot_id' not in citation
