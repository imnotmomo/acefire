"""Read B's saved source-bound claims; C's numeric API remains unchanged."""
from fastapi import APIRouter, HTTPException, Query

from app.document_intake import document_claims
from app.document_narrative import get_report


def document_router(store):
    router = APIRouter()

    @router.get('/deals/{deal_id}/narrative-report')
    def narrative_report(deal_id: str, report_id: str | None = None):
        report = get_report(store, deal_id, report_id)
        if report is None:
            raise HTTPException(404, 'No published narrative report in this deal/version.')
        return report

    @router.get('/deals/{deal_id}/narrative-evidence/{citation_id}')
    def narrative_evidence(deal_id: str, citation_id: str, report_id: str):
        report = get_report(store, deal_id, report_id)
        citation = next((c for c in report['sources'] if c['id'] == citation_id), None) if report else None
        if citation is None:
            raise HTTPException(404, 'Citation is not present in this deal/report version.')
        return {'report_id': report['id'], 'source': citation,
                'verification_definition': report['status_definitions']['verified']}

    @router.get('/deals/{deal_id}/document-claims')
    def list_claims(deal_id: str, snapshot_id: str | None = None,
                    limit: int = Query(200, ge=1, le=2000), offset: int = Query(0, ge=0)):
        if store.company(deal_id) is None:
            raise HTTPException(404, 'Deal not found.')
        rows = document_claims(store, deal_id, snapshot_id=snapshot_id, limit=limit, offset=offset)
        return {'deal_id': deal_id, 'claims': rows, 'limit': limit, 'offset': offset,
                'verification': 'Source quotes located by B; semantic review pending.'}

    @router.get('/deals/{deal_id}/document-numeric-packet')
    def numeric_packet(deal_id: str, snapshot_id: str | None = None,
                       limit: int = Query(200, ge=1, le=2000), offset: int = Query(0, ge=0)):
        if store.company(deal_id) is None:
            raise HTTPException(404, 'Deal not found.')
        rows = document_claims(store, deal_id, snapshot_id=snapshot_id, limit=limit, offset=offset)
        return {'claims': [c.numeric for c in rows if c.numeric is not None]}

    return router
