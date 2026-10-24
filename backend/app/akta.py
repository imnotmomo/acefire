"""Akta JSON adapter; the MCP endpoint is also available for read-only discovery.

Contracts: docs.akta.pro/docs/supporting-apis/company-search and
docs.akta.pro/docs/company-data/quick-start. No model-generated financial numbers.
"""
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import urlparse

import httpx

from app.schemas import CIRCLE, Company, IngestionResult, Observation, SourceSnapshot, stable_id


class AktaError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def domain(value: str | None) -> str:
    if not isinstance(value, str):
        return ''
    parsed = urlparse(value if '://' in value else 'https://' + value)
    return (parsed.hostname or '').lower().removeprefix('www.').rstrip('.')


def legal_name(value: str) -> str:
    return re.sub(r'[^a-z0-9]', '', value.lower())


class AktaClient:
    def __init__(self, api_key: str | None = None, transport=None):
        key = api_key if api_key is not None else os.environ.get('AKTA_API_KEY')
        if not key:
            raise AktaError('Set AKTA_API_KEY in the server environment; it is never accepted in API request bodies.')
        self.api_url = os.environ.get('AKTA_API_URL', 'https://api.akta.pro').rstrip('/')
        self.mcp_url = os.environ.get('AKTA_MCP_URL', 'https://mcp.akta.pro/mcp')
        # Credentials are scoped to the documented provider origins, including on redirects.
        if self.api_url != 'https://api.akta.pro' or self.mcp_url != 'https://mcp.akta.pro/mcp':
            raise AktaError('Akta credentials may only be sent to the documented HTTPS provider endpoints.')
        self.client = httpx.Client(headers={'x-api-key': key}, timeout=45, follow_redirects=False, transport=transport)
        self.responses: dict[str, bytes] = {}

    def close(self):
        self.client.close()

    def _request(self, method, url, **kwargs) -> httpx.Response:
        try:
            response = self.client.request(method, url, **kwargs)
        except httpx.RequestError:
            raise AktaError('Akta network request failed; no automatic retry was attempted.') from None
        if response.status_code >= 300:
            # Never echo request headers, URLs with query secrets, or arbitrary provider error bodies.
            raise AktaError(f'Akta returned HTTP {response.status_code}; request was not retried.', response.status_code)
        return response

    def _get(self, path, params):
        response = self._request('GET', self.api_url + path, params=params)
        try:
            payload = response.json()
        except ValueError:
            raise AktaError('Akta returned an invalid JSON response.') from None
        if not isinstance(payload, dict):
            raise AktaError('Akta JSON response must be an object.')
        self.responses[path] = response.content
        return payload

    def search(self, query: str) -> dict:
        return self._get('/api/v1/company/search', {'query': query})

    def enrich(self, company_id: str) -> dict:
        # Two bounded sections. No news/list generation, bulk requests or polling.
        return self._get('/api/v1/company/enrichment/', {'company': company_id, 'sections': 'firmographic,financial_estimate'})

    def mcp_tools(self) -> dict:
        headers = {'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json'}
        def rpc(method, params=None, request_id=1):
            request = {'jsonrpc': '2.0', 'method': method}
            if params is not None:
                request['params'] = params
            if request_id is not None:
                request['id'] = request_id
            response = self._request('POST', self.mcp_url, json=request, headers=headers)
            if response.headers.get('mcp-session-id'):
                headers['Mcp-Session-Id'] = response.headers['mcp-session-id']
            if not response.content:
                return {}
            try:
                obj = response.json()
            except ValueError:
                obj = None
                for event in response.text.replace('\r\n', '\n').split('\n\n'):
                    text = '\n'.join(line[5:].lstrip() for line in event.splitlines() if line.startswith('data:'))
                    if text:
                        candidate = json.loads(text)
                        if candidate.get('id') == request_id:
                            obj = candidate
                            break
            if not isinstance(obj, dict) or 'error' in obj:
                raise AktaError('MCP returned an invalid response or protocol error.')
            return obj.get('result', {})
        init = rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'acefire-member-c', 'version': '0.1.0'}})
        headers['MCP-Protocol-Version'] = init.get('protocolVersion', '2025-06-18')
        rpc('notifications/initialized', request_id=None)
        return rpc('tools/list', request_id=2)


def ingest_akta_circle(client: AktaClient, cache_dir: Path) -> IngestionResult:
    search = client.search(CIRCLE.domain)
    candidates = search.get('data')
    if not isinstance(candidates, list):
        raise AktaError('Unexpected Akta company-search response schema.')
    matches = [c for c in candidates if isinstance(c, dict) and domain(c.get('website', '')) == CIRCLE.domain and c.get('uuid')]
    if len(matches) != 1:
        raise AktaError('Circle identity is unresolved: expected exactly one company with website circle.com.')
    candidate = matches[0]
    if not re.fullmatch(r'[A-Za-z0-9_-]{3,80}', str(candidate['uuid'])):
        raise AktaError('Akta company identifier has an unexpected format.')
    enriched = client.enrich(str(candidate['uuid']))
    profile = enriched.get('data')
    if not isinstance(profile, dict):
        raise AktaError('Unexpected Akta company-enrichment response schema.')
    firmographic = profile.get('firmographic')
    if not isinstance(firmographic, dict):
        raise AktaError('Akta firmographic data is unavailable; legal entity cannot be verified.')
    if legal_name(str(firmographic.get('legal_name', ''))) != legal_name(CIRCLE.legal_name) or domain(str(firmographic.get('website', ''))) != CIRCLE.domain:
        raise AktaError('Akta legal name or website does not match Circle Internet Group, Inc.; no data was merged.')
    if profile.get('uuid') != candidate['uuid']:
        raise AktaError('Akta search and enrichment UUIDs differ; no data was merged.')

    now = datetime.now(timezone.utc)
    company = CIRCLE.model_copy(update={'identifiers': {**CIRCLE.identifiers, 'akta': str(candidate['uuid'])}, 'primary_company_id': str(candidate['uuid'])})
    snapshots = []
    for kind, payload, uri in [
        ('search', search, client.api_url + '/api/v1/company/search?query=circle.com'),
        ('enrichment', enriched, client.api_url + '/api/v1/company/enrichment/?company=' + str(candidate['uuid']) + '&sections=firmographic,financial_estimate'),
    ]:
        endpoint = '/api/v1/company/search' if kind == 'search' else '/api/v1/company/enrichment/'
        raw = client.responses.get(endpoint) or json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        sha = hashlib.sha256(raw).hexdigest()
        folder = cache_dir / company.deal_id / 'akta'
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f'{kind}-{sha}.json'
        if not path.exists():
            path.write_bytes(raw)
        elif hashlib.sha256(path.read_bytes()).hexdigest() != sha:
            raise AktaError('Existing cached snapshot failed its hash check.')
        snapshots.append(SourceSnapshot(
            id=stable_id(company.deal_id, 'akta', kind, sha), deal_id=company.deal_id,
            entity_key=company.entity_key, provider='akta', source_kind='provider_json_api',
            ingestion_channel='provider_api', data_role='primary_company_data',
            source_uri=uri, local_path=str(path), sha256=sha, retrieved_at=now,
            context={'record_type': kind, 'provider_uuid': str(candidate['uuid']), 'identity_basis': 'exact website and normalized legal name', 'financial_kind': 'provider_estimate_not_audited_statement', 'json_pointer_base': '/data'},
        ))
    snapshot = snapshots[-1]
    estimates = profile.get('financial_estimate', {})
    observations = []
    if isinstance(estimates, dict):
        for metric, value in estimates.items():
            pointer = '/data/financial_estimate/' + metric.replace('~', '~0').replace('/', '~1')
            raw = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)
            observations.append(Observation(
                id=stable_id(snapshot.id, pointer), deal_id=company.deal_id, entity_key=company.entity_key,
                snapshot_id=snapshot.id, provider='akta', metric_key='akta.' + metric,
                raw_label=metric, raw_value=raw, normalization_status='missing' if value is None else 'unresolved',
                verification_status='api_reported', locator={'kind': 'json_pointer', 'pointer': pointer},
                notes=['Provider financial estimate; no midpoint or exact historical amount inferred.', 'Financial period, as-of, currency, scope and accounting basis remain unknown unless explicitly provided.'],
            ))
    return IngestionResult(company=company, snapshots=snapshots, observations=observations, profile=profile,
        warnings=['Akta profile and financial estimates are enrichment, not audited financial statements.', 'Retrieval time is not the financial reporting period.'])
