"""Adapt B's stored reports without treating generated summaries as source quotes."""


def quotation_id(report_id, source_id):
    return f'report:{report_id}:source:{source_id}'


def source_claims(company, reports, snapshots):
    sources = {s.id: s for s in snapshots}
    result = []
    for report in reports:
        if report.get('deal_id') != company.deal_id or report.get('entity_key') != company.entity_key:
            raise ValueError('Stored report belongs to another company.')
        seen = set()
        for evidence in report.get('sources', []):
            snapshot = sources.get(evidence.get('snapshot_id'))
            if (not snapshot or evidence.get('sha256') != snapshot.sha256
                    or not isinstance(evidence.get('id'), str) or evidence['id'] in seen
                    or not isinstance(evidence.get('quote'), str) or not evidence['quote'].strip()
                    or not isinstance(evidence.get('locator'), dict)):
                raise ValueError('Stored report quotation has invalid source bindings.')
            seen.add(evidence['id'])
            item = {'snapshot_id': snapshot.id, 'quote': evidence['quote'], 'locator': evidence['locator'],
                    'representation_kind': 'stored_source_excerpt',
                    'quote_match_rule': evidence.get('reading_method') or 'upstream_quote_matching_unspecified'}
            result.append({'id': quotation_id(report['id'], evidence['id']), 'deal_id': company.deal_id,
                           'entity_key': company.entity_key, 'snapshot_id': snapshot.id,
                           'statement': f"Stored report source excerpt · {snapshot.original_filename or snapshot.id}",
                           'claim_type': 'report_source_quotation', 'extractor_version': 'stored-report-binding-v1',
                           'evidence': [item], 'verification_status': 'needs_review',
                           'limitations': ['Imported upstream source quotation; model review does not constitute human verification.']})
    return result


def summaries(reports):
    return [{'id': r['id'], 'created_at': r['created_at'], 'language': r.get('language', 'unknown'),
             'section_count': len(r.get('sections', [])), 'model': r.get('provenance', {}).get('requested_model', 'upstream model'),
             'status': 'model_generated_unverified'} for r in reports]


def draft(report, current_report):
    from app.narrative import _source_graph
    evidence = {e['id']: e for e in current_report['narrative_evidence']}
    sections, preferences = [], []
    for section in report['sections']:
        claims, gaps = [], []
        for entry in section.get('entries', []):
            if entry.get('status') == 'missing' or not entry.get('evidenceIds'):
                if entry.get('text'):
                    gaps.append(entry['text'])
                continue
            citations = []
            for source_id in entry['evidenceIds']:
                eid = f"claim:{quotation_id(report['id'], source_id)}:evidence:0"
                if eid not in evidence:
                    raise ValueError('A stored report claim references unavailable original source evidence.')
                item = evidence[eid]
                citations.append({'evidence_id': eid, 'kind': 'statement', 'quote': item['text'],
                                  'quote_basis': 'source_text', 'source': item['source']})
            claims.append({'id': entry['id'], 'text': entry['text'], 'kind': 'reported_summary',
                           'citations': citations, 'review_state': 'conflict' if entry.get('status') == 'difference' else 'verify',
                           'upstream_status': entry.get('status'), 'human_reviewed': False})
        if not claims and not gaps:
            gaps.append('No source-supported claims were supplied for this section.')
        sections.append({'id': section['id'], 'title': section['title'], 'claims': claims, 'gaps': gaps})
        preferences.append({'id': section['id'], 'title': section['title'], **section.get('config', {})})
    selected = list({c['evidence_id']: evidence[c['evidence_id']] for s in sections for claim in s['claims'] for c in claim['citations']}.values())
    return {'id': report['id'], 'deal_id': report['deal_id'], 'based_on_report_id': current_report['report_id'],
            'model': report.get('provenance', {}).get('requested_model', 'upstream model'),
            'generated_at': report['created_at'], 'status': 'model_generated_unverified',
            'sections': sections, 'drafting_preferences': preferences, 'evidence_manifest': selected,
            'source_graph': _source_graph(report['id'], sections, selected),
            'origin': 'imported_stored_narrative_report', 'human_reviewed': False,
            'limitations': report.get('limitations', [])}
