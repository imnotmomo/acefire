#!/usr/bin/env python3
"""One-time, offline QA DuckDB seed; never connect to Firestore or overwrite QA.

Run with the release's Python and PYTHONPATH pointing at its backend directory.
The source manifest is a private snapshot-id -> {path, sha256} mapping. Original
files are copied, never linked, so QA cannot change production file bytes.
English presentation files are copied separately by the host administrator.
"""
import argparse
from collections import Counter
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import tempfile


COLLECTIONS = {'source_snapshots', 'source_observations', 'company_profiles',
               'calculations', 'comparisons', 'document_claims', 'narrative_reports'}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def decode(value):
    if not isinstance(value, dict) or len(value) != 1:
        raise ValueError('Invalid typed snapshot value.')
    kind, item = next(iter(value.items()))
    if kind == 'mapValue':
        return {key: decode(v) for key, v in item.get('fields', {}).items()}
    if kind == 'arrayValue':
        return [decode(v) for v in item.get('values', [])]
    if kind == 'integerValue':
        return int(item)
    if kind == 'nullValue':
        return None
    if kind in {'stringValue', 'booleanValue', 'doubleValue', 'timestampValue'}:
        return item
    raise ValueError('Unsupported typed snapshot value.')


def load_records(snapshot):
    if snapshot.stat().st_size > 100 * 1024 * 1024:
        raise ValueError('QA snapshot exceeds the supported size.')
    rows, seen = [], set()
    for line in snapshot.read_text().splitlines():
        item = json.loads(line)
        fields = item['document']['fields']
        if sha256(canonical(fields)).hexdigest() != item['fields_sha256']:
            raise ValueError('Snapshot typed fields failed their integrity check.')
        envelope = {key: decode(value) for key, value in fields.items()}
        record = envelope.get('record')
        if (envelope.get('schema_version') != 1 or not isinstance(record, dict)
                or sha256(canonical(record)).hexdigest() != envelope.get('record_sha256')):
            raise ValueError('Snapshot record failed its integrity check.')
        parts = item['path'].split('/')
        if item['path'] in seen or len(seen) >= 10000:
            raise ValueError('Duplicate or excessive snapshot records.')
        seen.add(item['path'])
        if parts[0] == 'imports' and len(parts) == 2:
            continue  # Import receipts describe production and are not app records.
        if (len(parts) not in (2, 4) or parts[0] != 'companies'
                or any(not part or part in {'.', '..'} for part in parts)):
            raise ValueError('Unsupported QA snapshot path.')
        collection = 'companies' if len(parts) == 2 else parts[2]
        if collection == 'company_profiles' and 'deal_id' not in record:
            record = {**record, 'deal_id': parts[1]}  # The profile envelope is nested by company.
        if record.get('deal_id') != parts[1]:
            raise ValueError('Snapshot company binding differs from its path.')
        if collection != 'companies' and collection not in COLLECTIONS:
            raise ValueError('Unsupported QA collection.')
        key = 'deal_id' if collection == 'companies' else 'snapshot_id' if collection == 'company_profiles' else 'id'
        if record.get(key) != parts[-1]:
            raise ValueError('Snapshot record identifier differs from its path.')
        rows.append((collection, record))
    if not any(collection == 'companies' for collection, _ in rows):
        raise ValueError('QA snapshot contains no companies.')
    return rows


def seed_qa(snapshot, source_manifest, qa_root):
    from app.schemas import Company, SourceSnapshot, Observation, Calculation, Comparison, IngestionResult
    from app.store import Store, _dump
    from app import store as store_module
    from app.document_intake import DocumentClaim, initialize_documents, save_document_claims
    from app.stored_narratives import source_claims

    snapshot, source_manifest = Path(snapshot), Path(source_manifest)
    qa_root = Path(qa_root).resolve()
    production = [Path(p).resolve() for p in ('/var/lib/ingenium', '/etc/ingenium', '/srv/ingenium', '/var/www/ingenium')]
    if qa_root == Path('/') or any(qa_root == p or qa_root.is_relative_to(p) for p in production):
        raise ValueError('QA seed output cannot be a production path.')
    records = load_records(snapshot)
    manifest = json.loads(source_manifest.read_text())
    if not isinstance(manifest, dict):
        raise ValueError('Source manifest must be a snapshot mapping.')
    qa_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    database, sources = qa_root / 'acefire.duckdb', qa_root / 'sources'
    receipt = qa_root / 'seed.json'
    if any(p.exists() or p.is_symlink() for p in (database, sources, receipt)):
        raise ValueError('QA data already exists; seeding never overwrites it.')
    lock = qa_root / '.seed.lock'
    descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)
    try:
        with tempfile.TemporaryDirectory(prefix='.seed-', dir=qa_root) as temporary:
            staging = Path(temporary)
            staging_sources = staging / 'sources'
            staging_sources.mkdir(mode=0o700)
            missing, copied, total_bytes, snapshots = [], 0, 0, {}
            for collection, record in records:
                if collection != 'source_snapshots':
                    continue
                source = SourceSnapshot.model_validate(record)
                location = None
                entry = manifest.get(source.id)
                if entry is not None:
                    if (not isinstance(entry, dict) or entry.get('sha256') != source.sha256
                            or not isinstance(entry.get('path'), str)):
                        raise ValueError('Source manifest failed its snapshot binding.')
                    original = Path(entry['path'])
                    if original.is_file():
                        if original.stat().st_size > 100 * 1024 * 1024:
                            raise ValueError('QA source exceeds the supported size.')
                        content = original.read_bytes()
                        total_bytes += len(content)
                        if total_bytes > 300 * 1024 * 1024:
                            raise ValueError('QA source collection exceeds the supported size.')
                        if sha256(content).hexdigest() != source.sha256:
                            raise ValueError('Original source failed its content integrity check.')
                        directory = sha256(source.id.encode()).hexdigest()
                        name = re.sub(r'[^A-Za-z0-9._-]', '_', Path(source.original_filename or 'original').name)[:180]
                        name = name if name not in {'', '.', '..'} else 'original'
                        target = staging_sources / directory / name
                        target.parent.mkdir(mode=0o700)
                        target.write_bytes(content)
                        target.chmod(0o600)
                        location = str(sources / directory / name)
                        copied += 1
                if location is None:
                    missing.append(source.id)
                snapshots[source.id] = source.model_copy(update={'local_path': location})
            with Store(staging / 'acefire.duckdb') as store:
                companies = {r['deal_id']: Company.model_validate(r) for c, r in records if c == 'companies'}
                for deal_id, company in companies.items():
                    selected = [(c, r) for c, r in records if r['deal_id'] == deal_id]
                    store.ingest(IngestionResult(company=company,
                        snapshots=[snapshots[r['id']] for c, r in selected if c == 'source_snapshots'],
                        observations=[Observation.model_validate(r) for c, r in selected if c == 'source_observations'],
                        profiles={r['snapshot_id']: r['profile'] for c, r in selected if c == 'company_profiles'}))
                    for collection, record in selected:
                        if collection == 'calculations':
                            store.save_calculation(Calculation.model_validate(record))
                        elif collection == 'comparisons':
                            store.save_comparison(Comparison.model_validate(record))
                    claims = [DocumentClaim.model_validate(r) for c, r in selected if c == 'document_claims']
                    if claims:
                        initialize_documents(store)
                        save_document_claims(store, company, claims)
                    reports = [r for c, r in selected if c == 'narrative_reports']
                    source_claims(company, reports, store.snapshots(deal_id))
                    with store.transaction() as db:
                        db.execute((Path(store_module.__file__).resolve().parents[2] / 'database-design' / 'narrative.sql').read_text())
                        for report in reports:
                            Store._insert(db, 'narrative_reports', {
                                'id': report['id'], 'deal_id': deal_id, 'entity_key': company.entity_key,
                                'created_at': report['created_at'], 'payload': _dump(report)})
                if any(r['deal_id'] not in companies for _, r in records):
                    raise ValueError('Snapshot record references an unknown company.')
                counts = dict(Counter(collection for collection, _ in records))
                result = {'schema_version': 1, 'storage': 'duckdb', 'source_snapshot_sha256': sha256(snapshot.read_bytes()).hexdigest(),
                          'records': counts, 'copied_originals': copied, 'missing_originals': sorted(missing),
                          'policy': 'offline initial QA copy; no production connection; never reseed during deployment'}
                (staging / 'seed.json').write_bytes(canonical(result) + b'\n')
            # All application imports and source checks succeeded before publication.
            for path in (database, sources, receipt):
                if path.exists() or path.is_symlink():
                    raise ValueError('QA data appeared while seeding; refusing replacement.')
            os.rename(staging_sources, sources)
            try:
                (staging / 'acefire.duckdb').chmod(0o600)
                (staging / 'seed.json').chmod(0o600)
                os.rename(staging / 'acefire.duckdb', database)
                os.rename(staging / 'seed.json', receipt)
            except BaseException:
                database.unlink(missing_ok=True)
                receipt.unlink(missing_ok=True)
                shutil.rmtree(sources)
                raise
            return result
    finally:
        lock.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--source-manifest', type=Path, required=True)
    parser.add_argument('--qa-root', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(seed_qa(args.snapshot, args.source_manifest, args.qa_root), sort_keys=True))


if __name__ == '__main__':
    main()
