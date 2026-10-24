"""Display-ready narrative snapshots and source-alignment status for C.

The evidence catalog is built from registered, hash-checked local PDFs. A
verified sentence requires both a located quote and a separate semantic review.
It is not independent verification of the company's own assertions.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import Field
from pypdf import PdfReader

from app.schemas import Contract, stable_id
from app.store import Store, _dump, _json
from app.output_language import OutputLanguageError, contains_han

MODULES = [
    ('overview', 'Company overview', ['Company profile', 'Business model', 'Ownership']),
    ('market', 'Market', ['Market size', 'Market growth', 'Consumer trends', 'Customer segments', 'Competition', 'Geographic expansion']),
    ('financials', 'Financials', ['Revenue', 'Gross profit', 'Recurring revenue', 'Cash & runway']),
    ('customers', 'Customers', ['Customer base', 'Concentration', 'Retention']),
    ('product', 'Product', ['Product offering', 'Technology', 'Roadmap']),
    ('competition', 'Competition', ['Competitive landscape', 'Differentiation', 'Switching costs']),
    ('gtm', 'GTM', ['Channels', 'Sales motion', 'Growth strategy']),
    ('economics', 'Unit economics', ['CAC', 'LTV', 'Payback period']),
    ('team', 'Team', ['Leadership', 'Organization', 'Hiring plan']),
    ('legal', 'Legal / IP', ['Corporate structure', 'Contracts', 'Intellectual property']),
    ('clinical', 'Clinical / Regulatory', ['Clinical evidence', 'Regulatory status', 'Compliance']),
    ('questions', 'Open questions', ['Evidence gaps', 'Definition checks', 'Follow-up requests']),
]
TOPICS = {module: topics for module, _, topics in MODULES}


class CitationRequest(Contract):
    page_id: str
    quote: str = Field(min_length=10, max_length=4000)


class Alternative(Contract):
    text: str = Field(min_length=1)
    citations: list[CitationRequest] = Field(min_length=1)
    subject: str
    period: str
    scope: str
    definition: str
    scenario: str


class DraftItem(Contract):
    id: str = Field(min_length=1)
    module_id: str
    topic: str
    kind: Literal['fact', 'gap', 'difference']
    text: str = Field(min_length=1, max_length=3000)
    citations: list[CitationRequest]
    alternatives: list[Alternative]


class Draft(Contract):
    items: list[DraftItem] = Field(max_length=160)


class Review(Contract):
    id: str
    verdict: Literal['supported', 'unsupported', 'uncertain']
    reason: str = Field(min_length=1)
    comparable: bool


class Reviews(Contract):
    reviews: list[Review]


def canonical_hash(value):
    return hashlib.sha256(_dump(value).encode()).hexdigest()


def _normalized(text):
    import re
    import unicodedata
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text))


def build_catalog(store, deal_id, source_ids):
    company = store.company(deal_id)
    if company is None:
        raise ValueError('Unknown deal.')
    pages = {}
    for source_id in source_ids:
        source = store.snapshot(source_id)
        if source is None or (source.deal_id, source.entity_key) != (deal_id, company.entity_key):
            raise ValueError('Source belongs to another deal/entity or is unregistered.')
        if not source.local_path or Path(source.local_path).suffix.lower() != '.pdf':
            raise ValueError('Select registered PDF originals or Office PDF reading views.')
        file = Path(source.local_path)
        if hashlib.sha256(file.read_bytes()).hexdigest() != source.sha256:
            raise ValueError('Source hash changed; report generation is blocked.')
        for index, page in enumerate(PdfReader(file).pages, 1):
            text = page.extract_text() or ''
            if not text.strip():
                continue
            key = stable_id('narrative-source-page-v1', source.id, source.sha256, index)
            pages[key] = {
                'page_id': key, 'snapshot_id': source.id, 'sha256': source.sha256,
                'file_name': source.original_filename or file.name,
                'page': index, 'text': text, 'provider_as_of': str(source.provider_as_of) if source.provider_as_of else None,
                'source_uri': source.source_uri, 'file_url': f'/sources/{source.id}/file',
                'reading_method': 'pypdf physical page; whitespace/NFKC matching',
            }
    if not pages:
        raise ValueError('No readable source pages; visual/OCR review is required.')
    return pages


def resolve_citation(request, catalog):
    page = catalog.get(request.page_id)
    if page is None or _normalized(request.quote) not in _normalized(page['text']):
        raise ValueError('Citation quote is not located on the registered source page.')
    values = {key: page[key] for key in ('snapshot_id', 'sha256', 'file_name', 'page', 'provider_as_of', 'source_uri', 'file_url', 'reading_method')}
    values.update(quote=request.quote, locator={'kind': 'pdf_page', 'page': page['page']},
                  viewer_url=page['file_url'] + f"#page={page['page']}")
    return {'id': stable_id('narrative-citation-v1', page['snapshot_id'], page['sha256'], page['page'], _normalized(request.quote)), **values}


def comparable_alternatives(item, catalog):
    if len(item.alternatives) < 2:
        return False
    keys = ('subject', 'period', 'scope', 'definition', 'scenario')
    contexts = [{key: getattr(a, key).strip().casefold() for key in keys} for a in item.alternatives]
    if any(not value or value in {'unknown', 'null', 'none', '未知', '不详'} for c in contexts for value in c.values()):
        return False
    if any(c != contexts[0] for c in contexts[1:]):
        return False
    # Multiple pages/copies of one source are not independent corroboration.
    hashes = [{catalog[c.page_id]['sha256'] for c in a.citations} for a in item.alternatives]
    return all(left.isdisjoint(right) for n, left in enumerate(hashes) for right in hashes[n + 1:])


def validate_draft(draft, catalog):
    seen = set()
    for item in draft.items:
        if contains_han(item.text) or any(contains_han(alternative.text) for alternative in item.alternatives):
            raise OutputLanguageError('New report prose must be in English; citation quotations remain in their original language.')
        if item.id in seen:
            raise ValueError('Duplicate draft item ID.')
        seen.add(item.id)
        if item.module_id not in TOPICS or item.topic not in TOPICS[item.module_id]:
            raise ValueError('Unknown frontend module/topic.')
        if item.kind == 'gap':
            if item.citations or item.alternatives:
                raise ValueError('A gap is a request/coverage limit, not a sourced factual assertion.')
        elif item.kind == 'fact':
            if not item.citations or item.alternatives:
                raise ValueError('A fact requires citations and no conflicting alternatives.')
        elif not item.citations or len(item.alternatives) < 2:
            raise ValueError('Difference requires cited alternatives.')
        for citation in item.citations + [c for a in item.alternatives for c in a.citations]:
            resolve_citation(citation, catalog)
    return draft


def assemble_report(company, draft, reviews, catalog, provenance, *, scope_label):
    validate_draft(draft, catalog)
    by_id = {review.id: review for review in reviews.reviews}
    if len(by_id) != len(reviews.reviews) or set(by_id) != {item.id for item in draft.items}:
        raise ValueError('Semantic review must cover every draft item exactly once.')
    sources, entries, withheld = {}, {}, list(provenance.get('location_rejections', []))
    for item in draft.items:
        review = by_id[item.id]
        if contains_han(review.reason):
            raise OutputLanguageError('New report review explanations must be in English.')
        # Review applies to gap wording too: do not assert global absence.
        supported = review.verdict == 'supported'
        if item.kind == 'difference':
            supported = supported and review.comparable and comparable_alternatives(item, catalog)
        if not supported:
            withheld.append({'draft_id': item.id, 'module_id': item.module_id, 'topic': item.topic,
                             'reason': review.reason, 'verdict': review.verdict})
            continue
        citations = [resolve_citation(c, catalog) for c in item.citations]
        alternatives = []
        for alternative in item.alternatives:
            refs = [resolve_citation(c, catalog) for c in alternative.citations]
            citations.extend(refs)
            alternatives.append({**alternative.model_dump(exclude={'citations'}), 'evidenceIds': [c['id'] for c in refs]})
        for citation in citations:
            sources[citation['id']] = citation
        refs = list(dict.fromkeys(c['id'] for c in citations))
        status = {'fact': 'verified', 'gap': 'missing', 'difference': 'difference'}[item.kind]
        value = {'id': stable_id('narrative-entry-v1', company.deal_id, item.model_dump(), review.model_dump()),
                 'topic': item.topic, 'text': item.text, 'status': status, 'evidenceIds': refs,
                 'alternatives': alternatives,
                 'review': {'method': 'automated_source_alignment', 'verdict': review.verdict,
                            'reason': review.reason, 'human_reviewed': False}}
        entries.setdefault((item.module_id, item.topic), []).append(value)
    sections = []
    for module_id, title, topics in MODULES:
        values = []
        for topic in topics:
            found = entries.get((module_id, topic), [])
            if not found:
                found = [{'id': stable_id('narrative-gap-v1', company.deal_id, module_id, topic, canonical_hash(catalog)),
                          'topic': topic, 'text': 'The reviewed material does not support a publishable statement on this topic; additional evidence or review is required.',
                          'status': 'missing', 'evidenceIds': [], 'alternatives': [],
                          'review': {'method': 'coverage_check', 'human_reviewed': False}}]
            values.extend(found)
        statuses = [v['status'] for v in values]
        status = 'difference' if 'difference' in statuses else ('missing' if 'missing' in statuses else 'verified')
        sections.append({'id': module_id, 'title': title, 'status': status, 'entries': values,
                         'content': '\n\n'.join(v['text'] + ''.join(f' [{ref}]' for ref in v['evidenceIds']) for v in values),
                         'evidenceIds': list(dict.fromkeys(ref for v in values for ref in v['evidenceIds'])),
                         'config': {'topics': topics, 'depth': 'Standard', 'geography': 'Global',
                                    'horizon': 'Source period', 'scope': 'Internal only', 'focus': ''}})
    report = {'schema_version': 'b-narrative-v1', 'deal_id': company.deal_id, 'entity_key': company.entity_key,
              'company': company.legal_name, 'module_order': [m[0] for m in MODULES], 'language': 'en',
              'source_scope': {'label': scope_label, 'snapshot_ids': sorted({p['snapshot_id'] for p in catalog.values()}),
                               'catalog_sha256': canonical_hash(catalog), 'readable_pages': len(catalog)},
              'status_definitions': {
                  'missing': 'Insufficient reviewed evidence in this report scope, or review incomplete; not proof of global absence.',
                  'verified': 'Wording supported by located source evidence after automated semantic review; not independent factual verification.',
                  'difference': 'Supported differing statements across comparable source contexts; originals retained.'},
              'sections': sections, 'sources': list(sources.values()), 'withheld': withheld, 'provenance': provenance,
              'limitations': ['Historical source-time statements; no present-day company verification.',
                              'Provisional document-workspace identity; legal/Akta entity mapping remains unverified.',
                              'AI drafting and source alignment; no human sign-off or independent corroboration.',
                              'Financial calculations and normalized values remain owned by C; narrative does not calculate them.',
                              'Section status prioritizes difference, then missing; individual entries retain their own statuses.']}
    report['id'] = stable_id('narrative-report-v1', report)
    report['created_at'] = datetime.now(timezone.utc).isoformat()
    report['summary'] = {status: sum(e['status'] == status for section in sections for e in section['entries'])
                         for status in ('missing', 'verified', 'difference')}
    return report


def save_report(store, report):
    company = store.company(report['deal_id'])
    if company is None or company.entity_key != report['entity_key']:
        raise ValueError('Report company is not registered.')
    expected_id = stable_id('narrative-report-v1', {k: v for k, v in report.items() if k not in ('id', 'created_at', 'summary')})
    if report['id'] != expected_id:
        raise ValueError('Report contents changed after source review; create a new reviewed version.')
    catalog = build_catalog(store, report['deal_id'], report['source_scope']['snapshot_ids'])
    if canonical_hash(catalog) != report['source_scope']['catalog_sha256']:
        raise ValueError('Report source catalog differs from the reviewed version.')
    expected_summary = {status: sum(e['status'] == status for section in report['sections'] for e in section['entries'])
                        for status in ('missing', 'verified', 'difference')}
    if report['summary'] != expected_summary:
        raise ValueError('Report status summary is inconsistent.')
    for citation in report['sources']:
        source = store.snapshot(citation['snapshot_id'])
        if source is None or (source.deal_id, source.entity_key, source.sha256) != (company.deal_id, company.entity_key, citation['sha256']):
            raise ValueError('Report citation crosses a deal/entity/source version boundary.')
        page_id = stable_id('narrative-source-page-v1', source.id, source.sha256, citation['page'])
        located = resolve_citation(CitationRequest(page_id=page_id, quote=citation['quote']), catalog)
        if located != citation:
            raise ValueError('Report source details differ from the registered quotation.')
    with store.transaction() as db:
        db.execute((Path(__file__).resolve().parents[2] / 'database-design/narrative.sql').read_text())
        previous = db.execute('SELECT payload FROM narrative_reports WHERE id=?', [report['id']]).fetchone()
        if previous:
            old = _json(previous[0])
            if {k: v for k, v in old.items() if k != 'created_at'} != {k: v for k, v in report.items() if k != 'created_at'}:
                raise ValueError('Immutable narrative report ID collision.')
            return old
        Store._insert(db, 'narrative_reports', {'id': report['id'], 'deal_id': report['deal_id'],
                     'entity_key': report['entity_key'], 'created_at': report['created_at'], 'payload': _dump(report)})
    return report


def get_report(store, deal_id, report_id=None):
    if store.company(deal_id) is None:
        return None
    reports = store.narrative_reports(deal_id)
    if report_id:
        return next((row for row in reports if row['id'] == report_id), None)
    return max(reports, key=lambda row: (row['created_at'], row['id']), default=None)
