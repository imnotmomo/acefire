"""Load user-saved Akta responses as primary company data, without network access."""
from datetime import datetime
import hashlib
import json
from pathlib import Path

from app.akta import AktaError, domain, legal_name
from app.schemas import CIRCLE, IngestionResult, Observation, SourceSnapshot, stable_id


CIRCLE_AKTA_UUID = '000004j'


def _read_saved(path: Path) -> tuple[bytes, dict, dict, list[str], datetime]:
    raw = path.read_bytes()
    try:
        envelope = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise AktaError(f'Saved Akta file is not valid JSON: {path.name}') from None
    if not isinstance(envelope, dict) or envelope.get('provider') not in {'akta', 'akta.pro'}:
        raise AktaError(f'Saved response does not identify Akta as its provider: {path.name}')
    response = envelope.get('response')
    data = response.get('data') if isinstance(response, dict) else None
    if not isinstance(data, dict) or data.get('uuid') != CIRCLE_AKTA_UUID:
        raise AktaError(f'Saved response UUID does not match the verified Circle Akta UUID: {path.name}')
    parameters = envelope.get('request_parameters')
    section_string = parameters.get('sections') if isinstance(parameters, dict) else None
    if not isinstance(section_string, str) or not section_string.strip():
        raise AktaError(f'Saved response has no requested sections: {path.name}')
    sections = [part.strip() for part in section_string.split(',') if part.strip()]
    if len(sections) != len(set(sections)):
        raise AktaError(f'Saved response repeats a section: {path.name}')
    for section in ('firmographic', 'financial_estimate'):
        if section in data and section not in sections:
            raise AktaError(f'Saved response section is not declared in request parameters: {path.name}')
    try:
        fetched_at = datetime.fromisoformat(str(envelope.get('fetched_at', '')).replace('Z', '+00:00'))
    except ValueError:
        raise AktaError(f'Saved response has no valid fetched_at timestamp: {path.name}') from None
    if fetched_at.utcoffset() is None:
        raise AktaError(f'Saved response fetched_at must include its timezone: {path.name}')
    if 'financial_estimate' in data and not isinstance(data['financial_estimate'], dict):
        raise AktaError(f'Saved financial_estimate must be an object: {path.name}')
    return raw, envelope, data, sections, fetched_at


def ingest_saved_akta_circle(folder: Path) -> IngestionResult:
    """Validate all saved Circle response envelopes before returning any intake data.

    A financial-only response is attached only after a matching firmographic
    response establishes Circle's legal name, domain and Akta UUID. Each saved
    file retains its own raw bytes/hash and profile binding; files are not edited.
    """
    root = Path(folder).resolve()
    if not root.is_dir():
        raise AktaError(f'Saved Akta data directory does not exist: {root}')
    paths = sorted(root.glob('Circle*.json'))
    if not paths:
        raise AktaError('No saved Circle Akta response files were found.')
    records = []
    identity_verified = False
    for path in paths:
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise AktaError('Saved Akta response must be a regular file inside the selected directory.')
        raw, envelope, data, sections, fetched_at = _read_saved(path)
        if 'firmographic' in data:
            firmographic = data['firmographic']
            if not isinstance(firmographic, dict):
                raise AktaError('Saved Akta firmographic data must be an object.')
            if (legal_name(str(firmographic.get('legal_name', ''))) != legal_name(CIRCLE.legal_name)
                    or domain(str(firmographic.get('website', ''))) != CIRCLE.domain):
                raise AktaError('Saved Akta legal name or domain does not match Circle Internet Group, Inc.')
            identity_verified = True
        records.append((path, raw, data, sections, fetched_at))
    if not identity_verified:
        raise AktaError('A saved firmographic response is required to verify Circle before attaching financial data.')

    company = CIRCLE.model_copy(update={
        'identifiers': {**CIRCLE.identifiers, 'akta': CIRCLE_AKTA_UUID},
        'primary_provider': 'akta', 'primary_company_id': CIRCLE_AKTA_UUID,
    })
    snapshots, observations, profiles = [], [], {}
    for path, raw, data, sections, fetched_at in records:
        sha = hashlib.sha256(raw).hexdigest()
        snapshot = SourceSnapshot(
            id=stable_id(company.deal_id, 'akta-saved', company.entity_key, sha),
            deal_id=company.deal_id, entity_key=company.entity_key,
            provider='akta', ingestion_channel='provider_api',
            data_role='primary_company_data', visibility='deal_private',
            original_filename=path.name, source_kind='saved_provider_json_response',
            source_uri=f'akta://company/{CIRCLE_AKTA_UUID}/' + ','.join(sections),
            local_path=str(path), sha256=sha, retrieved_at=fetched_at,
            context={
                'record_type': 'enrichment', 'provider_uuid': CIRCLE_AKTA_UUID,
                'sections': sections, 'identity_basis': 'saved firmographic exact domain and normalized legal name; same Akta UUID',
                'json_pointer_base': '/response/data',
                'saved_api_response': True,
                'source_note': 'User-saved Akta API response envelope; no network request was made by this importer and no HTTP request URL is asserted.',
                'financial_kind': 'provider_estimate_not_audited_statement',
            },
        )
        snapshots.append(snapshot)
        profiles[snapshot.id] = data
        for metric, value in data.get('financial_estimate', {}).items():
            pointer = '/response/data/financial_estimate/' + metric.replace('~', '~0').replace('/', '~1')
            raw_value = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)
            observations.append(Observation(
                id=stable_id(snapshot.id, pointer), deal_id=company.deal_id,
                entity_key=company.entity_key, snapshot_id=snapshot.id,
                provider='akta', metric_key='akta.' + metric,
                raw_label=metric, raw_value=raw_value,
                normalization_status='missing' if value is None else 'unresolved',
                verification_status='api_reported',
                locator={'kind': 'json_pointer', 'pointer': pointer},
                notes=[
                    'Provider financial estimate; no midpoint, exact amount or historical period inferred.',
                    'Saved response fetched_at is a retrieval timestamp, not a financial reporting period.',
                ],
            ))
    return IngestionResult(
        company=company, snapshots=snapshots, observations=observations,
        profiles=profiles,
        warnings=[
            'Loaded saved Akta responses offline; no live provider availability was verified.',
            'Financial estimate ranges are not audited statements and cannot supply ARR, burn or runway.',
        ],
    )
