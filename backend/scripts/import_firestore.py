"""Create-only migration of a C/B DuckDB file into the selected Firestore database.

Run from backend/: python scripts/import_firestore.py /path/to/acefire.duckdb --dry-run
Uses Application Default Credentials. Never uploads host paths or the binary DB.
"""
from concurrent.futures import ThreadPoolExecutor
import argparse
from hashlib import sha256
import json
from pathlib import Path
import shutil
import sys
import tempfile

import duckdb
from google.api_core.exceptions import AlreadyExists

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.firebase_store import FirebaseStore, envelope, unpack
from app.schemas import Company, SourceSnapshot, Observation, Calculation, Comparison


def sanitized(value):
    if isinstance(value, dict):
        return {key: None if key == 'local_path' else sanitized(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitized(item) for item in value]
    if isinstance(value, str) and (value.startswith('/Users/') or value.startswith('file:///Users/')):
        return 'local-file://' + value.rsplit('/', 1)[-1]
    return value


def prepare(path):
    digest = sha256(path.read_bytes()).hexdigest()
    records = []
    def add(record_path, record):
        record = sanitized(record)
        records.append((record_path, envelope(record)))
    with tempfile.TemporaryDirectory(prefix='acefire-migration-') as directory:
        copy = Path(directory) / 'source.duckdb'
        shutil.copyfile(path, copy)
        if sha256(copy.read_bytes()).hexdigest() != digest or sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('Database changed while copying. Retry with a stable handoff file.')
        db = duckdb.connect(str(copy), read_only=True)
        try:
            tables = {row[0] for row in db.execute('SHOW TABLES').fetchall()}
            for deal_id, entity_key, name, domain, country, provider, provider_id in db.execute('SELECT * FROM entities').fetchall():
                deal = db.execute('SELECT historical_cutoff FROM deals WHERE id=?', [deal_id]).fetchone()
                identifiers = {ns: value for ns, value in db.execute('SELECT namespace, identifier FROM entity_identifiers WHERE deal_id=? AND entity_key=?', [deal_id, entity_key]).fetchall()}
                company = Company(deal_id=deal_id, entity_key=entity_key, legal_name=name, domain=domain,
                                  country=country, primary_provider=provider, primary_company_id=provider_id,
                                  historical_cutoff=deal[0], identifiers=identifiers)
                add(f'companies/{deal_id}', company.model_dump(mode='json'))
                sources, observations = set(), set()
                for table, model in [('source_snapshots', SourceSnapshot), ('source_observations', Observation),
                                     ('calculations', Calculation), ('comparisons', Comparison),
                                     ('document_claims', None), ('narrative_reports', None)]:
                    if table not in tables:
                        continue
                    for (payload,) in db.execute(f'SELECT payload FROM {table} WHERE deal_id=? ORDER BY id', [deal_id]).fetchall():
                        record = json.loads(payload)
                        if model:
                            record = model.model_validate(record).model_dump(mode='json')
                        if record.get('deal_id') != deal_id or record.get('entity_key', entity_key) != entity_key:
                            raise ValueError('Record has invalid company bindings.')
                        if table == 'source_snapshots':
                            sources.add(record['id'])
                        elif table in ('source_observations', 'document_claims'):
                            if record['snapshot_id'] not in sources:
                                raise ValueError('Unknown source snapshot.')
                            if table == 'source_observations':
                                observations.add(record['id'])
                        elif table == 'calculations' and (not set(record['input_ids']) <= observations or not set(record['input_snapshots']) <= sources):
                            raise ValueError('Unknown calculation input.')
                        add(f"companies/{deal_id}/{table}/{record['id']}", record)
                if 'company_profiles' in tables:
                    for sid, provider, payload in db.execute('SELECT snapshot_id, provider, payload FROM company_profiles WHERE deal_id=?', [deal_id]).fetchall():
                        if sid not in sources:
                            raise ValueError('Unknown profile source.')
                        add(f'companies/{deal_id}/company_profiles/{sid}', {'snapshot_id': sid, 'provider': provider, 'profile': json.loads(payload)})
        finally:
            db.close()
    if len({path for path, _ in records}) != len(records):
        raise ValueError('Duplicate record paths in migration.')
    return digest, records


def migrate(store, records):
    def one(item):
        path, expected = item
        doc = store.client.document(path)
        current = doc.get(timeout=30)
        if current.exists:
            if unpack(current) != expected['record']:
                raise ValueError('Existing immutable record differs: ' + path)
            return 'unchanged'
        try:
            doc.create(expected, timeout=30)
            state = 'created'
        except AlreadyExists:
            state = 'unchanged'
        if unpack(doc.get(timeout=30)) != expected['record']:
            raise ValueError('Readback differs: ' + path)
        return state
    with ThreadPoolExecutor(max_workers=6) as pool:
        states = list(pool.map(one, records))
    return {'created': states.count('created'), 'unchanged': states.count('unchanged'), 'verified': len(states)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('--project', default='acefire-50248')
    parser.add_argument('--database-id', default='acefire')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    digest, records = prepare(args.database)
    counts = {}
    for path, _ in records:
        collection = path.split('/')[-2]
        counts[collection] = counts.get(collection, 0) + 1
    summary = {'source_sha256': digest, 'records': len(records), 'collections': counts}
    if not args.dry_run:
        store = FirebaseStore(args.project, args.database_id)
        try:
            summary.update(migrate(store, records))
        finally:
            store.close()
    print(json.dumps(summary, sort_keys=True))


if __name__ == '__main__':
    main()
