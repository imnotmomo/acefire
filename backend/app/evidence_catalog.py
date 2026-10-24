"""Bind company narrative evidence to stored records, without extracting new data."""
from copy import deepcopy
import json

from app.schemas import stable_id


def scalar(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def add_document_claims(report, claims):
    sources = {s['snapshot_id']: s for s in report['source_files']}
    seen = set()
    for claim in claims:
        if (not isinstance(claim, dict) or claim.get('deal_id') != report['company']['deal_id']
                or claim.get('entity_key') != report['company']['entity_key']
                or not isinstance(claim.get('id'), str) or claim['id'] in seen
                or claim.get('snapshot_id') not in sources
                or not isinstance(claim.get('statement'), str) or not claim['statement'].strip()
                or not isinstance(claim.get('evidence'), list) or not claim['evidence']):
            raise ValueError('Document claim has invalid company or source bindings.')
        seen.add(claim['id'])
        for evidence in claim['evidence']:
            if (not isinstance(evidence, dict) or evidence.get('snapshot_id') not in sources
                    or not isinstance(evidence.get('quote'), str) or not evidence['quote'].strip()
                    or not isinstance(evidence.get('locator'), dict)
                    or evidence.get('original_snapshot_id') not in (None, *sources)):
                raise ValueError('Document quotation is missing its registered source or locator.')
    report['document_claims'] = deepcopy(sorted(claims, key=lambda item: item['id']))
    if claims:
        report['report_id'] = stable_id('company-report-with-document-claims', report['report_id'], report['document_claims'])


def build_evidence_catalog(report):
    deal = report['company']['deal_id']
    result = []
    def add(record_id, kind, title, text, **binding):
        if isinstance(text, str) and text.strip():
            result.append({'id': record_id, 'deal_id': deal, 'kind': kind, 'title': title,
                           'text': text, 'quote_basis': 'source_text' if kind == 'statement' else 'structured_record', **binding})
    for entry in report['reported_metrics']:
        o = entry['observation']
        text = (f"{o['raw_label']} | raw value: {o['raw_value'] if o['raw_value'] is not None else 'unavailable'}; "
                f"normalized value: {o['value'] if o['value'] is not None else 'unavailable'} {o['unit'] or '(unit unknown)'}; "
                f"currency: {o['currency'] or 'unknown'}; definition: {o['definition_key'] or 'unreviewed'}; "
                f"scope: {o['scope'] or 'unknown'}; scenario: {o['scenario']}; "
                f"source period: {o['period_label'] or 'unknown'}; start: {o['period_start'] or 'unknown'}; "
                f"end: {o['period_end'] or 'unknown'}; normalization: {o['normalization_status']}; "
                f"verification: {o['verification_status']}.")
        add(o['id'], 'observation', o['raw_label'], text, source=entry['source'])
    for entry in report['calculations']:
        c = entry['calculation']
        text = (f"Stored {c['metric_key']}: {c['value'] if c['value'] is not None else 'unavailable'} {c['unit'] or '(unit unknown)'}. "
                f"Status: {c['status']}. Formula: {c['formula']}. Function: {c['function_key']} v{c['function_version']}. "
                f"Input observation IDs: {', '.join(c['input_ids'])}. Reasons: {'; '.join(c['reasons']) or 'none recorded'}.")
        # Keep each original cell/page binding even when inputs share one file.
        add(c['id'], 'calculation', c['metric_key'], text, sources=[i['source'] for i in entry['inputs']])
    for field in report['primary_profile']['field_lineage']['fields']:
        if field['value'] is None:
            continue
        source = field['source']
        add(f"field:{source['snapshot_id']}:{field['field_path']}", 'statement', field['field_path'] or 'Company profile',
            scalar(field['value']), source=source, profile_snapshot_id=source['snapshot_id'], profile_pointer=field['field_path'])
    sources = {s['snapshot_id']: s for s in report['source_files']}
    for claim in report.get('document_claims', []):
        for index, evidence in enumerate(claim['evidence']):
            source = deepcopy(sources[evidence['snapshot_id']])
            source['locator'] = deepcopy(evidence['locator'])
            source['location'] = {key: evidence['locator'].get(key) for key in
                                  ('page', 'line_start', 'line_end', 'column', 'row', 'sheet', 'cell', 'pointer', 'paragraph')}
            binding = {'source': source, 'document_claim_id': claim['id'], 'evidence_index': index}
            if evidence.get('quote_match_rule'):
                binding['quote_match_rule'] = evidence['quote_match_rule']
            add(f"claim:{claim['id']}:evidence:{index}", 'statement', claim['statement'], evidence['quote'], **binding)
    return result


def compact_catalog(catalog):
    """The model chooses IDs/quotes; canonical file bindings are attached server-side."""
    return [{key: item[key] for key in ('id', 'kind', 'title', 'text', 'quote_basis')} for item in catalog]
