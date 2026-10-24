from copy import deepcopy
import json

from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas
import pytest

from app.main import create_app
from app.document_narrative import (Draft, DraftItem, MODULES, Reviews, assemble_report, build_catalog,
                           comparable_alternatives, get_report, resolve_citation, save_report,
                           validate_draft)
from app.schemas import Company
from app.store import Store
from app.uploads import ingest_upload
from backend.evidence.generate_narrative import generate, locate_draft


@pytest.fixture
def workspace(tmp_path):
    company = Company(deal_id='report-deal', entity_key='entity', legal_name='Example',
                      domain='example.test', country='FIN')
    pdf = tmp_path / 'example.pdf'
    doc = canvas.Canvas(str(pdf))
    doc.drawString(30, 700, 'The company provides payment processing services.')
    doc.drawString(30, 680, 'It plans to obtain a regulatory license in April.')
    doc.save()
    store = Store(':memory:')
    store.initialize()
    result = ingest_upload(pdf.read_bytes(), pdf.name, 'application/pdf', 'uploaded', company, tmp_path / 'cache')
    store.ingest(result)
    source = result.snapshots[0]
    catalog = build_catalog(store, company.deal_id, [source.id])
    page_id = next(iter(catalog))
    item = dict(id='draft-1', module_id='overview', topic='Company profile', kind='fact',
                text='The source states that the company provides payment processing services.',
                citations=[dict(page_id=page_id, quote='The company provides payment processing services.')], alternatives=[])
    yield store, company, source, catalog, item
    store.close()


def reviewed(item, verdict='supported', comparable=False):
    return Reviews(reviews=[dict(id=item['id'], verdict=verdict, comparable=comparable, reason='Checked the source wording and planned status.')])


def report_for(workspace, verdict='supported'):
    store, company, source, catalog, item = workspace
    return assemble_report(company, Draft(items=[DraftItem(**item)]), reviewed(item, verdict), catalog,
                           {'gateway': 'mock'}, scope_label='Historical test PDF only')


def test_all_frontend_modules_topics_and_citation_links(workspace):
    report = report_for(workspace)
    assert [s['id'] for s in report['sections']] == [m[0] for m in MODULES]
    assert len(report['sections']) == 12
    assert report['summary']['verified'] == 1 and report['summary']['difference'] == 0
    for section, (_, _, topics) in zip(report['sections'], MODULES):
        assert {e['topic'] for e in section['entries']} == set(topics)
        assert all(e['status'] in {'missing', 'verified', 'difference'} for e in section['entries'])
    assert report['sections'][0]['status'] == 'missing'  # profile supported, ownership/business model gaps
    citation = report['sources'][0]
    assert citation['viewer_url'].endswith('#page=1')
    assert citation['quote'] == 'The company provides payment processing services.'
    assert citation['id'] in report['sections'][0]['content']


@pytest.mark.parametrize('verdict', ['unsupported', 'uncertain'])
def test_unreviewed_or_unsupported_text_is_withheld_not_verified(workspace, verdict):
    report = report_for(workspace, verdict)
    assert report['summary']['verified'] == 0
    assert not report['sources'] and len(report['withheld']) == 1
    assert all(e['status'] == 'missing' for s in report['sections'] for e in s['entries'])


def test_missing_review_cannot_publish(workspace):
    _, company, _, catalog, item = workspace
    with pytest.raises(ValueError, match='exactly once'):
        assemble_report(company, Draft(items=[DraftItem(**item)]), Reviews(reviews=[]), catalog, {}, scope_label='test')


def test_ellipsis_is_split_only_when_every_span_is_located_on_declared_page(workspace):
    _, _, _, catalog, item = workspace
    item['citations'][0]['quote'] += '...It plans to obtain a regulatory license in April.'
    part, rejected, splits = locate_draft(Draft(items=[DraftItem(**item)]), catalog)
    assert len(part.items) == 1 and len(part.items[0].citations) == 2 and splits and not rejected
    item['citations'][0]['quote'] += '...The company already holds the license.'
    part, rejected, _ = locate_draft(Draft(items=[DraftItem(**item)]), catalog)
    assert not part.items and len(rejected) == 1


@pytest.mark.parametrize('change', ['quote', 'page', 'module', 'topic', 'uncited'])
def test_fabricated_quotes_and_unsupported_shape_are_rejected(workspace, change):
    _, _, _, catalog, item = workspace
    if change == 'quote':
        item['citations'][0]['quote'] = 'The company already holds all regulatory licenses.'
    elif change == 'page':
        item['citations'][0]['page_id'] = 'invented-source'
    elif change == 'module':
        item['module_id'] = 'invented-module'
    elif change == 'topic':
        item['topic'] = 'invented-topic'
    else:
        item['citations'] = []
    with pytest.raises(ValueError):
        validate_draft(Draft(items=[DraftItem(**item)]), catalog)


def test_difference_requires_comparable_context_and_distinct_sources(workspace):
    _, company, _, catalog, item = workspace
    page1 = next(iter(catalog))
    catalog['second'] = {**catalog[page1], 'page_id': 'second', 'sha256': 'b' * 64,
                         'snapshot_id': 'second-source', 'text': 'The company provides lending services.'}
    item.update(kind='difference', text='The sources describe different primary businesses for the same period.', alternatives=[
        dict(text='Payment processing services', citations=item['citations'], subject='Example', period='2020',
             scope='group', definition='primary business', scenario='actual'),
        dict(text='Lending services', citations=[dict(page_id='second', quote='The company provides lending services.')],
             subject='Example', period='2020', scope='group', definition='primary business', scenario='actual')])
    draft = Draft(items=[DraftItem(**item)])
    assert comparable_alternatives(draft.items[0], catalog)
    result = assemble_report(company, draft, reviewed(item, comparable=True), catalog, {}, scope_label='test')
    assert result['summary']['difference'] == 1 and len(result['sources']) == 2
    for change in ('period', 'scope', 'scenario'):
        variant = deepcopy(item)
        variant['alternatives'][1][change] = 'different'
        result = assemble_report(company, Draft(items=[DraftItem(**variant)]), reviewed(variant, comparable=True), catalog, {}, scope_label='test')
        assert result['summary']['difference'] == 0 and result['withheld']
    catalog['second']['sha256'] = catalog[page1]['sha256']
    assert not comparable_alternatives(draft.items[0], catalog)


def test_report_persistence_idempotency_and_api_deal_version_isolation(workspace):
    store, company, _, _, _ = workspace
    report = report_for(workspace)
    assert save_report(store, report) == report
    assert save_report(store, deepcopy(report)) == report
    assert get_report(store, 'other-deal', report['id']) is None
    store.initialize()  # additive table does not break C's version check
    with TestClient(create_app(store)) as client:
        response = client.get(f'/deals/{company.deal_id}/narrative-report')
        assert response.status_code == 200 and response.json()['id'] == report['id']
        ref = report['sources'][0]['id']
        url = f'/deals/{company.deal_id}/narrative-evidence/{ref}?report_id={report["id"]}'
        assert client.get(url).status_code == 200
        assert client.get(url.replace(company.deal_id, 'other-deal')).status_code == 404
        assert client.get(url.replace(report['id'], 'wrong-version')).status_code == 404
        assert client.get(f'/deals/{company.deal_id}/narrative-report?report_id=wrong').status_code == 404


def test_read_routes_delegate_to_c_storage_contract_without_sql(workspace):
    store, company, _, _, _ = workspace
    report = report_for(workspace)

    class ImportedStore:
        backend = 'firestore'

        def company(self, deal_id):
            return company if deal_id == company.deal_id else None

        def narrative_reports(self, deal_id):
            return [report] if deal_id == company.deal_id else []

        def document_claims(self, deal_id):
            return []

    # The imported-record path deliberately has no transaction/_connect method.
    imported = ImportedStore()
    assert get_report(imported, company.deal_id)['id'] == report['id']
    assert get_report(imported, 'other-company') is None
    from app.document_intake import document_claims
    assert document_claims(imported, company.deal_id) == []


def test_modified_content_and_modified_source_are_rejected(workspace):
    store, _, source, _, _ = workspace
    report = report_for(workspace)
    changed = deepcopy(report)
    changed['sections'][0]['content'] = 'Unreviewed replacement'
    with pytest.raises(ValueError, match='changed after source review'):
        save_report(store, changed)
    from pathlib import Path
    path = Path(source.local_path)
    path.write_bytes(path.read_bytes() + b'changed')
    with pytest.raises(ValueError, match='Source hash changed'):
        save_report(store, report)


def test_generation_resume_reuses_responses_and_exports_complete_handoff(workspace, tmp_path):
    store, company, source, _, item = workspace

    class FakeClient:
        def __init__(self):
            self.calls = 0

        def complete(self, messages, model, max_tokens):
            self.calls += 1
            request = json.loads(messages[1]['content'])
            if 'modules' in request:
                payload = {'items': [item] if any(m['id'] == 'overview' for m in request['modules']) else []}
            else:
                payload = {'reviews': [dict(id=i['id'], verdict='supported', comparable=False,
                                           reason='Checked against the source wording.') for i in request['items']]}
            return {'request_id': f'mock-{self.calls}', 'response': {'model': 'mock-test', 'choices': [
                {'finish_reason': 'stop', 'message': {'content': json.dumps(payload)}}]}}

    client = FakeClient()
    out = tmp_path / 'output'
    report = generate(store, company.deal_id, [source.id], out, scope_label='test', client=client)
    assert client.calls == 7
    assert len(report['sections']) == 12
    from app.output_language import contains_han
    assert report['language'] == 'en'
    assert not contains_han((out / 'frontend-text.md').read_text())
    assert not contains_han((out / 'C_README.md').read_text())
    assert json.loads((out / 'c-handoff.json').read_text())['id'] == report['id']
    import zipfile
    with zipfile.ZipFile(out / 'c-package.zip') as archive:
        snapshots = json.loads(archive.read('source-snapshots.json'))
        assert snapshots[0]['snapshot']['local_path'] is None
        assert archive.read(snapshots[0]['asset_path']).startswith(b'%PDF')
        assert not any('response' in name or 'key' in name for name in archive.namelist())
    repeat = generate(store, company.deal_id, [source.id], out, scope_label='test', client=client, resume=True)
    assert repeat['id'] == report['id'] and client.calls == 7
    with pytest.raises(ValueError, match='manifest differs'):
        generate(store, company.deal_id, [source.id], out, scope_label='changed scope', client=client, resume=True)
    # Edits reuse immutable draft responses, but require fresh review calls and
    # a new manifest/version. No unreviewed replacement can inherit old review.
    import shutil
    edits = tmp_path / 'edits.json'
    edits.write_text(json.dumps({'draft-000:draft-1': {'text': 'The historical source states that the company provides payment processing services.'}}))
    revised_dir = tmp_path / 'revised'
    revised_dir.mkdir()
    for raw in out.glob('draft-response-*.json'):
        shutil.copyfile(raw, revised_dir / raw.name)
    revised = generate(store, company.deal_id, [source.id], revised_dir, scope_label='test',
                       client=client, resume=True, edits_file=edits)
    assert client.calls == 8 and revised['id'] != report['id']
    assert revised['provenance']['editorial_review']['edited_draft_ids'] == ['draft-000:draft-1']
    assert 'The historical source states' in revised['sections'][0]['content']
    assert get_report(store, company.deal_id)['id'] == revised['id']
    edits.write_text(json.dumps({'draft-000:draft-1': {'text': 'Another unreviewed replacement'}}))
    with pytest.raises(ValueError, match='manifest differs'):
        generate(store, company.deal_id, [source.id], revised_dir, scope_label='test',
                 client=client, resume=True, edits_file=edits)


def test_new_reports_have_english_fallbacks_and_language_metadata(workspace):
    from app.output_language import contains_han
    report = report_for(workspace)
    assert report['language'] == 'en'
    assert all(not contains_han(entry['text']) for section in report['sections'] for entry in section['entries'])
    assert all(not contains_han(entry['review'].get('reason', '')) for section in report['sections'] for entry in section['entries'])


def test_new_report_prose_and_review_reasons_must_be_english(workspace):
    _, company, _, catalog, item = workspace
    translated = {**item, 'text': '公司提供支付处理服务。'}
    with pytest.raises(ValueError, match='English'):
        validate_draft(Draft(items=[DraftItem(**translated)]), catalog)
    with pytest.raises(ValueError, match='English'):
        locate_draft(Draft(items=[DraftItem(**translated)]), catalog)
    reviews = Reviews(reviews=[dict(id=item['id'], verdict='supported', comparable=False, reason='已核对。')])
    with pytest.raises(ValueError, match='English'):
        assemble_report(company, Draft(items=[DraftItem(**item)]), reviews, catalog, {}, scope_label='test')


def test_english_report_can_retain_an_original_chinese_citation(workspace):
    _, _, _, catalog, item = workspace
    page = next(iter(catalog))
    catalog[page] = {**catalog[page], 'text': '公司提供支付处理服务。'}
    item['citations'][0]['quote'] = catalog[page]['text']
    draft = validate_draft(Draft(items=[DraftItem(**item)]), catalog)
    citation = resolve_citation(draft.items[0].citations[0], catalog)
    assert citation['quote'] == '公司提供支付处理服务。'
