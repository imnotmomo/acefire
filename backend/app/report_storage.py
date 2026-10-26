"""Lossless bounded storage for large report drafts; API shapes stay unchanged."""
import base64
import hashlib
import json
import zlib

MAX_STORED_BYTES = 750_000
MAX_LOGICAL_BYTES = 5_000_000
MAX_WORKSPACE_BYTES = 5_000_000
ENCODING = 'canonical-json-zlib-base64-v1'
METADATA = ('id', 'deal_id', 'version', 'created_at', 'updated_at', 'based_on_report_id', 'model')


def canonical_bytes(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    except (RecursionError,TypeError,OverflowError,UnicodeError):
        raise ValueError('Shared report contains unsupported or excessively nested JSON.') from None


def section_count(record):
    if 'draft' not in record and 'workspace' not in record:
        count=record.get('section_count')
        return count if type(count) is int and 0<=count<=12 else 0
    content = record.get('workspace') if isinstance(record.get('workspace'), dict) else record.get('draft')
    sections = content.get('sections') if isinstance(content, dict) else []
    return len(sections) if isinstance(sections, list) else 0


def encode_record(record):
    from app.report_drafts import validate_record
    validate_record(record)
    raw = canonical_bytes(record)
    if len(raw) <= MAX_STORED_BYTES:
        return record  # Existing small records remain compatible plain JSON.
    stored = {key: record[key] for key in METADATA}
    stored.update(storage_encoding=ENCODING, decoded_bytes=len(raw),
                  decoded_sha256=hashlib.sha256(raw).hexdigest(), section_count=section_count(record),
                  payload_base64=base64.b64encode(zlib.compress(raw, 9)).decode('ascii'))
    if len(canonical_bytes(stored)) > MAX_STORED_BYTES:
        raise ValueError('This report exceeds the shared storage limit even after lossless compression. Your draft is preserved; export a full copy or save separate reports.')
    return stored


def decode_record(stored):
    from app.report_drafts import validate_record, validate_metadata
    if not isinstance(stored, dict):
        raise ValueError('Shared report storage has an unsupported format.')
    if 'storage_encoding' not in stored:
        validate_record(stored)
        return stored
    try:
        validate_metadata(stored)
        expected = set(METADATA) | {'storage_encoding','decoded_bytes','decoded_sha256','section_count','payload_base64'}
        if (set(stored) != expected or stored['storage_encoding'] != ENCODING
                or type(stored['decoded_bytes']) is not int or not 1 <= stored['decoded_bytes'] <= MAX_LOGICAL_BYTES
                or type(stored['section_count']) is not int or not 0 <= stored['section_count'] <= 12
                or not isinstance(stored['payload_base64'], str)
                or len(canonical_bytes(stored)) > MAX_STORED_BYTES):
            raise ValueError('Invalid storage metadata')
        compressed = base64.b64decode(stored['payload_base64'], validate=True)
        decoder = zlib.decompressobj()
        raw = decoder.decompress(compressed, MAX_LOGICAL_BYTES + 1)
        if (len(raw) > MAX_LOGICAL_BYTES or len(raw) != stored['decoded_bytes']
                or not decoder.eof or decoder.unconsumed_tail or decoder.unused_data
                or hashlib.sha256(raw).hexdigest() != stored['decoded_sha256']):
            raise ValueError('Invalid compressed content')
        record = json.loads(raw)
        if (not isinstance(record, dict) or canonical_bytes(record) != raw
                or any(stored[key] != record.get(key) for key in METADATA)
                or stored['section_count'] != section_count(record)):
            raise ValueError('Storage metadata does not match content')
        validate_record(record)
        return record
    except (ValueError, TypeError, KeyError, zlib.error, UnicodeError,RecursionError):
        raise ValueError('Shared report storage failed its integrity or size check. Your local draft is preserved; retry or contact the workspace owner.') from None


def unavailable_record(stored, *, deal_id=None, draft_id=None, version=None):
    """Use scoped row/document identities; never invent missing dates or text."""
    values = stored if isinstance(stored, dict) else {}
    text = lambda key,limit=2048: values.get(key) if isinstance(values.get(key), str) and len(values[key])<=limit else ''
    number = version if type(version) is int and version > 0 else values.get('version')
    return {'id': draft_id or text('id'), 'deal_id': deal_id or text('deal_id'),
            'version': number if type(number) is int and 1<=number<=9007199254740991 else 0,
            'created_at': text('created_at',100), 'updated_at': text('updated_at',100),
            'based_on_report_id': text('based_on_report_id'),
            'model': text('model').strip() or None,
            'draft': None, 'workspace': None, 'section_count': 0, 'unavailable': True}


def decode_scoped_record(stored, *, deal_id=None, draft_id=None, version=None):
    record=decode_record(stored)
    if (deal_id is not None and record.get('deal_id') != deal_id
            or draft_id is not None and record.get('id') != draft_id
            or version is not None and (type(version) is not int or record.get('version') != version)):
        raise ValueError('Shared report identity or version does not match its storage scope.')
    return record


def record_for_listing(stored, *, deal_id=None, draft_id=None, version=None):
    """Keep valid reports visible when another compressed payload is damaged."""
    try:
        return decode_scoped_record(stored,deal_id=deal_id,draft_id=draft_id,version=version)
    except ValueError:
        return unavailable_record(stored, deal_id=deal_id, draft_id=draft_id, version=version)
