from copy import deepcopy
import json

import pytest

from app.english_presentation import canonical, checked_translation, digest, english_report, prose_values
from app.stored_narratives import draft, source_claims, summaries
from app.schemas import CIRCLE
from types import SimpleNamespace


def example():
    report = {'id': 'imported-report', 'deal_id': CIRCLE.deal_id, 'entity_key': CIRCLE.entity_key,
              'created_at': '2026-10-24T00:00:00Z', 'language': 'zh-CN',
              'sources': [{'id': 'one', 'snapshot_id': 'pdf', 'sha256': 'a' * 64,
                           'quote': '原文：14 customers.', 'locator': {'kind': 'pdf_page', 'page': 4}}],
              'sections': [{'id': 'overview', 'title': '公司概况', 'config': {'focus': '客户范围'},
                            'entries': [{'id': 'claim-one', 'text': '材料称有14个客户。',
                                         'status': 'verified', 'evidenceIds': ['one']},
                                        {'id': 'gap-one', 'text': '缺少客户明细。', 'status': 'missing', 'evidenceIds': []}]}],
              'limitations': ['尚未人工核验。']}
    translations = {'公司概况': 'Company overview', '客户范围': 'Customer scope',
                    '材料称有14个客户。': 'The source reports 14 customers.',
                    '缺少客户明细。': 'Customer-level details are missing.',
                    '尚未人工核验。': 'No human verification has been performed.'}
    return report, translations


def install_manifest(tmp_path, monkeypatch, report, values):
    data = {'schema_version': 1, 'language': 'en', 'model': 'translation-model',
            'translated_at': '2026-10-24T12:00:00Z',
            'reports': {report['id']: {'record_sha256': digest(canonical(report))}},
            'translations': {digest(original): translated for original, translated in values.items()}}
    path = tmp_path / 'english.json'
    path.write_text(json.dumps(data, ensure_ascii=False))
    monkeypatch.setenv('INGENIUM_ENGLISH_TRANSLATIONS', str(path))
    return path, data


def test_saved_draft_is_english_and_retains_source_bytes_claim_ids_and_original_record(tmp_path, monkeypatch):
    report, translations = example()
    original = deepcopy(report)
    install_manifest(tmp_path, monkeypatch, report, translations)
    snapshot = SimpleNamespace(id='pdf', sha256='a' * 64, original_filename='original.pdf')
    claims = source_claims(CIRCLE, [report], [snapshot])
    eid = f"claim:{claims[0]['id']}:evidence:0"
    current = {'report_id': 'current-report', 'narrative_evidence': [
        {'id': eid, 'kind': 'statement', 'title': 'Original source', 'text': report['sources'][0]['quote'],
         'quote_basis': 'source_text', 'source': {'snapshot_id': 'pdf', 'file_name': 'original.pdf',
                                                'provider': 'uploaded', 'sha256': 'a' * 64, 'locator': {'page': 4}}}]}
    output = draft(report, current)
    assert output['id'] == report['id']
    assert output['language'] == 'en' and output['translation']['original_language'] == 'zh-CN'
    assert output['sections'][0]['title'] == 'Company overview'
    assert output['sections'][0]['claims'][0]['id'] == 'claim-one'
    assert output['sections'][0]['claims'][0]['text'] == 'The source reports 14 customers.'
    citation = output['sections'][0]['claims'][0]['citations'][0]
    assert citation['quote'] == '原文：14 customers.'
    assert citation['evidence_id'] == eid and citation['source']['sha256'] == 'a' * 64
    assert output['sections'][0]['gaps'] == ['Customer-level details are missing.']
    assert output['drafting_preferences'][0]['focus'] == 'Customer scope'
    assert report == original
    assert summaries([report])[0]['language'] == 'en'
    assert summaries([report])[0]['original_language'] == 'zh-CN'


def test_stale_source_and_incomplete_translation_fail_without_returning_a_mixed_report(tmp_path, monkeypatch):
    report, translations = example()
    path, data = install_manifest(tmp_path, monkeypatch, report, translations)
    stale = deepcopy(report)
    stale['sections'][0]['entries'][0]['text'] = '材料称有15个客户。'
    with pytest.raises(ValueError, match='source version'):
        english_report(stale)
    data['translations'].pop(digest('缺少客户明细。'))
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match='incomplete'):
        english_report(report)


def test_translations_preserve_numeric_values_across_language_magnitudes():
    assert checked_translation('平台覆盖800万用户。', 'The platform covers 8 million users.')
    assert checked_translation('五位创始人计划两年内将客户增长至四倍。',
                               'The 5 founders plan to grow the customer base to 4 times its size within 2 years.')
    with pytest.raises(ValueError, match='numeric value'):
        checked_translation('材料称有14个客户。', 'The source reports 15 customers.')
    with pytest.raises(ValueError, match='untranslated'):
        checked_translation('材料称有14个客户。', 'The source reports 14个 customers.')


def test_missing_english_manifest_does_not_modify_or_claim_translation(tmp_path, monkeypatch):
    report, _ = example()
    monkeypatch.setenv('INGENIUM_ENGLISH_TRANSLATIONS', str(tmp_path / 'missing.json'))
    with pytest.raises(ValueError, match='not available'):
        english_report(report)
    assert summaries([report])[0]['english_available'] is False
    english = deepcopy(report)
    english['sections'][0]['title'] = 'Company overview'
    english['sections'][0]['config']['focus'] = 'Customer scope'
    english['sections'][0]['entries'] = []
    english['limitations'] = []
    view, metadata = english_report(english)
    assert view == english and metadata is None
    assert view['sources'][0]['quote'] == '原文：14 customers.'
