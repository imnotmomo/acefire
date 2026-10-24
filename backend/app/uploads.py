"""Private upload intake. File bytes are evidence, never executable instructions.

Only the reviewed Circle Orbis Summary adapter performs numeric extraction.
All other formats are preserved as snapshots awaiting an extraction/review step.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Literal
import unicodedata
from urllib.parse import quote

from app.local_sources import ingest_local_circle
from app.schemas import CIRCLE, Company, IngestionResult, SourceSnapshot, stable_id


MAX_UPLOAD_BYTES = 50 * 1024 * 1024
UPLOAD_VERSION = '1'
UploadProvider = Literal['orbis', 'pitchbook', 'uploaded']


def _filename(value: str) -> str:
    # Browsers may send Windows client paths even when this server runs on Unix.
    # Store only a bounded display basename, under generated hash directories.
    basename = unicodedata.normalize('NFKC', str(value or '')).replace('\\', '/').rsplit('/', 1)[-1]
    basename = re.sub(r'[^\w. ()-]', '_', basename, flags=re.UNICODE).strip(' .')
    if not basename:
        return 'upload.bin'
    # Stay below common filesystem byte limits while preserving useful suffixes.
    suffix = Path(basename).suffix[:16]
    stem = basename[:-len(suffix)] if suffix else basename
    while len((stem + suffix).encode('utf-8')) > 200:
        stem = stem[:-1]
    return (stem or 'upload') + suffix


def _circle_mapping(company: Company) -> bool:
    normalized = lambda name: ''.join(c for c in unicodedata.normalize('NFKC', name).casefold() if c.isalnum())
    return (company.entity_key == CIRCLE.entity_key
            and company.domain.lower().removeprefix('www.').rstrip('.') == CIRCLE.domain
            and normalized(company.legal_name) == normalized(CIRCLE.legal_name))


def _save_once(path: Path, content: bytes, digest: str):
    if path.is_symlink():
        raise ValueError('Upload cache file must not be a symbolic link.')
    try:
        with path.open('xb') as output:
            output.write(content)
    except FileExistsError:
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('Existing uploaded file failed its immutable hash check.') from None


def ingest_upload(
    content: bytes,
    filename: str,
    content_type: str | None,
    provider: UploadProvider,
    company: Company,
    cache_dir: Path,
) -> IngestionResult:
    """Preserve an upload and return supplemental observations for this deal.

    A caller-declared provider is not identity proof. The Circle workbook adapter
    verifies legal name, BvD/Orbis IDs and layout before emitting observations.
    Neither uploaded metadata nor extracted rows change the primary company.
    """
    if not isinstance(content, bytes) or not content:
        raise ValueError('Upload must contain nonempty file bytes.')
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError('Upload exceeds the 50 MiB size limit.')
    if provider not in {'orbis', 'pitchbook', 'uploaded'}:
        raise ValueError('Upload provider must be orbis, pitchbook or uploaded.')

    name = _filename(filename)
    digest = hashlib.sha256(content).hexdigest()
    identity = stable_id('user-upload-v' + UPLOAD_VERSION, company.deal_id,
                         company.entity_key, provider, digest, name)
    # Every directory component comes from a hash or a fixed provider enum.
    # The sanitized filename is never interpreted as a directory.
    cache = Path(cache_dir).resolve()
    folder = (cache / 'uploads' / stable_id(company.deal_id, company.entity_key)
              / provider / digest / stable_id(name))
    if folder.is_symlink() or not folder.resolve().is_relative_to(cache):
        raise ValueError('Upload cache path escapes its configured directory.')
    source_dir = folder / provider
    source_dir.mkdir(parents=True, exist_ok=True)
    if source_dir.is_symlink() or not source_dir.resolve().is_relative_to(cache):
        raise ValueError('Upload cache path escapes its configured directory.')
    path = source_dir / name
    _save_once(path, content, digest)

    # A hidden record is skipped by the local financial adapter. Its timestamp
    # is write-once, so re-uploading the same file produces an identical payload.
    record_path = folder / '.upload-record.json'
    if record_path.is_symlink():
        raise ValueError('Upload record must not be a symbolic link.')
    record = {
        'version': UPLOAD_VERSION, 'snapshot_id': identity,
        'deal_id': company.deal_id, 'entity_key': company.entity_key,
        'provider': provider, 'original_filename': name, 'sha256': digest,
        'uploaded_at': datetime.now(timezone.utc).isoformat(),
        'declared_content_type': content_type,
    }
    try:
        with record_path.open('x', encoding='utf-8') as output:
            json.dump(record, output, ensure_ascii=False, sort_keys=True)
    except FileExistsError:
        try:
            previous = json.loads(record_path.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            raise ValueError('Existing uploaded metadata is unreadable; refusing to rewrite it.') from None
        if not isinstance(previous, dict) or any(previous.get(k) != record[k] for k in (
            'version', 'snapshot_id', 'deal_id', 'entity_key', 'provider', 'original_filename', 'sha256'
        )):
            raise ValueError('Existing uploaded metadata conflicts with immutable source identity.')
        record = previous
    try:
        uploaded_at = datetime.fromisoformat(record['uploaded_at'])
        if uploaded_at.tzinfo is None:
            raise ValueError
    except (KeyError, ValueError, TypeError):
        raise ValueError('Existing upload timestamp is invalid; refusing to invent an earlier upload time.') from None

    snapshot = SourceSnapshot(
        id=identity, deal_id=company.deal_id, entity_key=company.entity_key,
        provider=provider, ingestion_channel='user_upload',
        data_role='supplemental_evidence', visibility='deal_private',
        original_filename=name, uploaded_at=uploaded_at,
        source_kind='user_uploaded_' + (path.suffix.lower().lstrip('.') or 'file'),
        source_uri='upload://' + identity + '/' + quote(name, safe=''),
        local_path=str(path), sha256=digest,
        context={
            'upload_version': UPLOAD_VERSION,
            'declared_content_type': record.get('declared_content_type'),
            'provider_attribution': 'user_declared_pending_source_identity_validation',
            'numeric_extraction_performed': False,
            'original_bytes_preserved': True,
            'source_instructions_executed': False,
        },
    )
    observations = []
    warnings = []
    if provider == 'orbis' and path.suffix.lower() == '.xlsx' and _circle_mapping(company):
        parsed = ingest_local_circle(folder)
        # This isolated upload folder contains only the selected source file.
        parsed_snapshot = next((s for s in parsed.snapshots if s.local_path == str(path)), None)
        if parsed_snapshot:
            snapshot.context['adapter'] = 'reviewed_circle_orbis_summary_v1'
            snapshot.context['source_identity'] = parsed_snapshot.context.get('identity_verification', {})
            snapshot.context['numeric_extraction_performed'] = bool(parsed.observations)
            if snapshot.context['source_identity'].get('status') == 'matched_native_identifiers':
                snapshot.context['provider_attribution'] = 'matched_native_circle_identifiers'
            if parsed_snapshot.context.get('ingestion_error'):
                snapshot.context['ingestion_error'] = parsed_snapshot.context['ingestion_error']
            for observation in parsed.observations:
                if observation.snapshot_id != parsed_snapshot.id:
                    continue
                observations.append(observation.model_copy(update={
                    'id': stable_id(identity, observation.id),
                    'deal_id': company.deal_id, 'entity_key': company.entity_key,
                    'snapshot_id': identity, 'provider': provider,
                    'notes': observation.notes + ['User-uploaded supplemental evidence; primary company identity remains provided by Akta.'],
                }))
        if not observations:
            warnings.append('No reviewed Circle Orbis financial rows were extracted; native identity or workbook layout requires review.')
    else:
        warnings.append('File preserved as private supplemental evidence; financial extraction and source-identity review are still required.')
    warnings.append('Upload time is not the reporting period, source publication date or provider retrieval date.')
    return IngestionResult(company=company, snapshots=[snapshot], observations=observations,
                           profile=None, warnings=warnings)
