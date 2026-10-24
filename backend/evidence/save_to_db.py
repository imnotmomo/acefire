"""Revalidate a prepared document result and save numbers/text in C's DuckDB.

Run with the API stopped (DuckDB permits one writer process). If the source is
Office, retain both the original upload and its PDF reading representation.
"""
import argparse
import json
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from app.document_intake import (DocumentClaim, claim_id, initialize_documents,
                                 save_document_claims, submit_document_numbers)
from app.intake import ExtractedClaim as NumericPacket
from app.schemas import Company, IngestionResult
from app.store import Store
from app.uploads import ingest_upload
from .import_claims import normalize, validate_claims
from .prepare_circle import ROOT, sha256, write_json
from .source import source_metadata, verify_original_representation

EXTRACTOR = 'b-document-extraction-v3'


def conservative_numeric_metadata(fact):
    """Narrow incomplete model metadata to unknown; retain original separately.

    No date, unit, decimal value or scale is inferred. Invalid scales become
    null, and incomplete period ranges become unknown with their printed label.
    """
    candidate = dict(fact)
    warnings = []
    kind, start, end = fact['period_kind'], fact['period_start'], fact['period_end']
    try:
        valid_dates = all(v is None or date.fromisoformat(v).isoformat() == v for v in (start, end))
    except (ValueError, TypeError):
        valid_dates = False
    valid = valid_dates and ((kind == 'unknown' and start is None and end is None)
                            or (kind == 'instant' and start is None and end is not None)
                            or (kind == 'duration' and start is not None and end is not None and start <= end))
    if not valid:
        candidate.update(period_kind='unknown', period_start=None, period_end=None)
        warnings.append('Incomplete/invalid model period metadata retained in numeric_source; exact period left unknown.')
    if fact['scale_multiplier'] is not None:
        try:
            scale = Decimal(fact['scale_multiplier'])
            valid_scale = scale.is_finite() and scale > 0
        except (ValueError, InvalidOperation):
            valid_scale = False
        if not valid_scale:
            candidate['scale_multiplier'] = None
            warnings.append('Invalid model scale retained in numeric_source; scale left unknown without guessing.')
    return candidate, warnings


def revalidate_bundle(bundle, registry, packet):
    evidence = {e['evidence_id']: e for e in bundle['evidence']}
    if len(evidence) != len(bundle['evidence']):
        raise ValueError('Duplicate evidence IDs in handoff.')
    if bundle['deal']['deal_id'] != registry['deal']['deal_id']:
        raise ValueError('Handoff and prepared source deal differ.')
    claims = []
    for item in bundle['claims']:
        payload = {key: item[key] for key in ('subject_entity_id', 'claim_type', 'statement', 'effective_date', 'limitations')}
        payload.update(subject_entity_name=item.get('subject_entity_name'), numeric=item.get('numeric'))
        payload['evidence'] = [{'physical_page': evidence[eid]['locator']['physical_page'],
                                'section': evidence[eid]['locator'].get('section'),
                                'quote': evidence[eid]['quote']} for eid in item['evidence_ids']]
        checked = validate_claims({'claims': [payload], 'open_questions': []}, registry, packet, item['model'])
        claims.append((checked['claims'][0], checked['evidence']))
    return claims


def save_prepared(store, run, handoff, company, cache, *, submit_numbers=False):
    run = Path(run).resolve()
    registry = json.loads((run / 'registry.json').read_text())
    packet = json.loads((run / 'packet.json').read_text())
    bundle = json.loads(Path(handoff).read_text())
    if company.deal_id != registry['deal']['deal_id']:
        raise ValueError('Explicit company mapping does not match the prepared deal.')
    existing = store.company(company.deal_id)
    if existing is not None and existing.model_dump(mode='json') != company.model_dump(mode='json'):
        raise ValueError('Company mapping conflicts with C\'s registered company; use the existing mapping.')
    source = source_metadata(registry)
    verify_original_representation(source)
    checked = revalidate_bundle(bundle, registry, packet)
    reading_path = (ROOT / source['file_path']).resolve()
    original_path = Path(source.get('original_file_path', reading_path)).resolve()
    if sha256(reading_path) != source['sha256'] or sha256(original_path) != source.get('original_sha256', source['sha256']):
        raise ValueError('Document hash mismatch.')
    original = ingest_upload(original_path.read_bytes(), source.get('original_filename', original_path.name),
                             None, 'uploaded', company, Path(cache))
    original_snapshot = original.snapshots[0]
    if original_path == reading_path:
        reading = original
    else:
        reading = ingest_upload(reading_path.read_bytes(), 'reading-view.pdf', 'application/pdf',
                                'uploaded', company, Path(cache))
    reading_snapshot = reading.snapshots[0]
    snapshots = {s.id: s for s in original.snapshots + reading.snapshots}
    claims = []
    for item, evidence in checked:
        supports = []
        for e in evidence:
            supports.append({
                'snapshot_id': reading_snapshot.id, 'original_snapshot_id': original_snapshot.id,
                'quote': e['quote'],
                'locator': {'kind': 'pdf_page', 'page': e['locator']['physical_page'],
                            'section': e['locator'].get('section'), 'quote': e['quote'],
                            'extractor_version': EXTRACTOR},
                'representation_kind': 'original_pdf' if original_path == reading_path else 'converted_pdf',
                'original_locators': e.get('original_locators', []),
                'original_locator_status': e.get('original_locator_status'),
                'original_locator_origin': e.get('original_locator_origin'),
                'quote_match_rule': e['quote_match_rule'],
            })
        numeric = None
        if item.get('numeric'):
            fact = item['numeric']
            raw = normalize(fact['raw_value'])
            # validate_claims already checked the full token. Prefer its supporting page.
            support = next(e for e in supports if raw in normalize(e['quote']))
            candidate, metadata_warnings = conservative_numeric_metadata(fact)
            numeric = NumericPacket.model_validate({
                **candidate, 'source_id': reading_snapshot.id, 'locator': support['locator'],
                'extractor_version': EXTRACTOR, 'verification_status': 'needs_review',
                'notes': ['B located source quotations; numeric interpretation and metadata require semantic review.',
                          'Other supporting quotes: ' + json.dumps(supports, ensure_ascii=False)] + metadata_warnings,
            })
        values = dict(deal_id=company.deal_id, entity_key=company.entity_key,
                      snapshot_id=reading_snapshot.id, claim_type=item['claim_type'],
                      statement=item['statement'], subject_entity_id=item['subject_entity_id'],
                      subject_entity_name=item.get('subject_entity_name'), effective_date=item['effective_date'],
                      evidence=supports, numeric=numeric.model_dump(mode='json') if numeric else None,
                      numeric_source=item.get('numeric'),
                      model=item['model'], extractor_version=EXTRACTOR,
                      limitations=item['limitations'])
        claims.append(DocumentClaim(id=claim_id(values), **values))
    # All PDF/quote/contract validations precede registration or claim writes.
    registered = store.ingest(IngestionResult(company=company, snapshots=list(snapshots.values()), observations=[]))
    initialize_documents(store)
    saved = save_document_claims(store, company, claims)
    numeric_result = submit_document_numbers(store, company, claims) if submit_numbers else None
    return {**registered, **saved, 'numeric_candidates': sum(c.numeric is not None for c in claims),
            'numeric_intake': numeric_result,
            'original_snapshot_id': original_snapshot.id, 'reading_snapshot_id': reading_snapshot.id,
            'coverage': bundle.get('coverage'), 'verification_status': 'needs_review',
            'document_claim_ids': [c.id for c in claims],
            'limitations': ['Stored facts are source-reported, not independent verification.',
                            'Registration, document batch and optional numeric intake are separate idempotent transactions.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--handoff', type=Path, required=True)
    parser.add_argument('--company', type=Path, required=True, help='Explicit C Company JSON; never inferred from the document')
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--submit-numbers', action='store_true')
    args = parser.parse_args()
    if args.receipt.exists():
        raise ValueError('Receipt exists; choose a new receipt path.')
    company = Company.model_validate_json(args.company.read_text())
    with Store(args.database) as store:
        receipt = save_prepared(store, args.run, args.handoff, company, args.cache, submit_numbers=args.submit_numbers)
    write_json(args.receipt, receipt)
    print(json.dumps({k: v for k, v in receipt.items() if k not in ('document_claim_ids', 'coverage')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
