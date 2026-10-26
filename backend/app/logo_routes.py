"""Read cached website icons; only explicit eligible identity writes can queue lookup."""
import re

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field


def public_company(company, logos=None):
    record = company.model_dump(mode='json')
    if logos is not None:
        state = logos.public(company)
        if state is not None:
            record['company_logo'] = state
    return record


class LogoWebsiteRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    website: str = Field(min_length=1, max_length=2048)


def company_logo_router(store, logos):
    router = APIRouter()

    def company(deal_id):
        result = store.company(deal_id)
        if result is None:
            raise HTTPException(404, 'Company workspace not found.')
        return result

    @router.get('/deals/{deal_id}/logo')
    def logo_status(deal_id: str):
        # Cache-only: viewing or refreshing a company never schedules a lookup.
        return {'logo': logos.public(company(deal_id))}

    @router.post('/deals/{deal_id}/logo/website', status_code=202)
    def supply_logo_identity(deal_id: str, request: LogoWebsiteRequest):
        from app.company_logos import normalize_public_domain
        try:
            domain = normalize_public_domain(request.website)
        except ValueError:
            raise HTTPException(422, 'Enter a public company website domain, without credentials, a private address or a custom port.') from None
        try:
            logos.set_website(company(deal_id), domain)
        except ValueError as error:
            raise HTTPException(409, str(error)[:400]) from None
        return {'logo': logos.public(company(deal_id))}

    @router.get('/deals/{deal_id}/logo/image/{sha256}')
    def cached_logo(deal_id: str, sha256: str, request: Request):
        selected = company(deal_id)
        if not re.fullmatch(r'[a-f0-9]{64}', sha256):
            raise HTTPException(404, 'Cached company icon unavailable.')
        try:
            content = logos.asset(selected, sha256)
        except (ValueError, OSError):
            raise HTTPException(404, 'Cached company icon unavailable. The default cover is retained.') from None
        headers = {'ETag': f'"{sha256}"', 'Cache-Control': 'private, max-age=31536000, immutable',
                   'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="company-icon.png"',
                   'Content-Security-Policy': "default-src 'none'; sandbox"}
        if request.headers.get('if-none-match') == headers['ETag']:
            return Response(status_code=304, headers=headers)
        return Response(content=content, media_type='image/png', headers=headers)

    return router
