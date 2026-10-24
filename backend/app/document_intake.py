"""B's source-bound textual facts and numeric candidates in C's existing DuckDB.

This adds one evidence table; it does not alter C's financial schema/version or
calculate values. Numbers are optionally submitted through C's existing intake.
"""
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, model_validator

from app.intake import ExtractedClaim, ingest_b_claims
from app.schemas import Company, Contract, stable_id
from app.store import Store, _dump, _json


class DocumentClaim(Contract):
    id: str
    deal_id: str
    entity_key: str
    snapshot_id: str
    claim_type: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    subject_entity_id: str | None = None
    subject_entity_name: str | None = None
    effective_date: str | None = None
    evidence: list[dict[str, Any]] = Field(min_length=1)
    numeric: ExtractedClaim | None = None
    numeric_source: dict[str, Any] | None = None
    model: str = Field(min_length=1)
    extractor_version: str = Field(min_length=1)
    verification_status: Literal['needs_review'] = 'needs_review'
    limitations: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def bound_numeric(self):
        if self.numeric and self.numeric.source_id != self.snapshot_id:
            raise ValueError('Numeric candidate must reference the document reading source.')
        return self


def initialize_documents(store: Store):
    store.initialize()
    sql = Path(__file__).resolve().parents[2] / 'database-design/document-intake.sql'
    with store.transaction() as db:
        db.execute(sql.read_text(encoding='utf-8'))


def save_document_claims(store: Store, company: Company, claims: list[DocumentClaim]):
    """Atomic, immutable batch. Location checks are performed by B's importer.

    Validate every source against the selected deal/entity, including secondary
    evidence and converted representations. A quote match is not semantic review.
    """
    added = 0
    with store.transaction() as db:
        for supplied in claims:
            claim = DocumentClaim.model_validate(supplied.model_dump(mode='json'))
            if (claim.deal_id, claim.entity_key) != (company.deal_id, company.entity_key):
                raise ValueError('Document claim belongs to another deal/entity.')
            referenced = {claim.snapshot_id}
            for evidence in claim.evidence:
                referenced.add(evidence['snapshot_id'])
                if not isinstance(evidence.get('quote'), str) or not evidence['quote'].strip():
                    raise ValueError('Every document fact needs a source quote.')
                if evidence.get('original_snapshot_id'):
                    referenced.add(evidence['original_snapshot_id'])
            providers = {}
            for source_id in referenced:
                row = db.execute('SELECT deal_id, entity_key, provider FROM source_snapshots WHERE id=?', [source_id]).fetchone()
                if row is None or row[:2] != (company.deal_id, company.entity_key):
                    raise ValueError('Document evidence source is not registered in this deal/entity.')
                providers[source_id] = row[2]
            payload = claim.model_dump(mode='json')
            previous = db.execute('SELECT payload FROM document_claims WHERE id=?', [claim.id]).fetchone()
            if previous:
                if _json(previous[0]) != payload:
                    raise ValueError('Document claim ID conflicts with immutable data.')
                continue
            Store._insert(db, 'document_claims', {
                'id': claim.id, 'deal_id': claim.deal_id, 'entity_key': claim.entity_key,
                'snapshot_id': claim.snapshot_id, 'provider': providers[claim.snapshot_id],
                'claim_type': claim.claim_type, 'statement': claim.statement,
                'raw_value': claim.numeric.raw_value if claim.numeric else None,
                'metric_key': claim.numeric.metric_key if claim.numeric else None,
                'verification_status': 'needs_review', 'payload': _dump(payload),
            })
            added += 1
    return {'document_claims_added': added, 'document_claims_received': len(claims)}


def document_claims(store: Store, deal_id: str, *, snapshot_id=None, limit=200, offset=0):
    # Read through C's storage contract so the same route supports DuckDB and
    # imported Firestore records without opening a second SQL connection.
    rows = [DocumentClaim.model_validate(row) for row in store.document_claims(deal_id)]
    if snapshot_id:
        rows = [row for row in rows if row.snapshot_id == snapshot_id]
    return sorted(rows, key=lambda row: row.id)[offset:offset + limit]


def submit_document_numbers(store: Store, company: Company, claims: list[DocumentClaim]):
    """Use C's unchanged normalizer/store. Never calculate numbers in B."""
    packets = [c.numeric for c in claims if c.numeric is not None]
    result = ingest_b_claims(company, packets, store.snapshots(company.deal_id))
    return {**store.ingest(result), 'warnings': result.warnings,
            'observation_ids': [o.id for o in result.observations]}


def claim_id(payload):
    return stable_id('b-document-claim-v1', payload)
