"""Firestore persistence for C's immutable records; browser access stays behind the API.

Financial values remain decimal strings in the record envelope. Imports and new
calculation runs are create-only: an existing ID with different bytes is an error.
The private local file manifest is optional and never uploaded to Firestore.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
from threading import RLock
from time import monotonic

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore

from app.schemas import Company, SourceSnapshot, Observation, Calculation, Comparison, IngestionResult

COLLECTIONS = ('source_snapshots', 'source_observations', 'company_profiles',
               'calculations', 'comparisons', 'document_claims', 'narrative_reports')


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def envelope(record):
    text = canonical(record)
    if len(text.encode()) > 800_000:
        raise ValueError('Record exceeds the supported Firestore document size.')
    return {'schema_version': 1, 'record_sha256': hashlib.sha256(text.encode()).hexdigest(), 'record': record}


def unpack(document):
    if not document.exists:
        return None
    data = document.to_dict()
    if not data or data.get('schema_version') != 1 or not isinstance(data.get('record'), dict):
        raise ValueError('Unsupported Firestore record envelope.')
    if envelope(data['record'])['record_sha256'] != data.get('record_sha256'):
        raise ValueError('Firestore record failed its content integrity check.')
    return data['record']


def identifier(value):
    if not isinstance(value, str) or not value or '/' in value or value in ('.', '..') or len(value.encode()) > 1000:
        raise ValueError('Invalid record identifier.')
    return value


class FirebaseStore:
    backend = 'firestore'

    def __init__(self, project=None, database=None, client=None, cache_seconds=15):
        self.project = project or os.getenv('FIREBASE_PROJECT_ID', 'acefire-50248')
        self.database = database or os.getenv('FIRESTORE_DATABASE_ID', 'acefire')
        self.client = client or firestore.Client(project=self.project, database=self.database)
        self.cache_seconds = cache_seconds
        self._cache = {}
        self._generation = {}
        self._lock = RLock()

    def _invalidate(self, deal_id):
        with self._lock:
            self._generation[deal_id] = self._generation.get(deal_id, 0) + 1
            self._cache.pop(deal_id, None)

    def initialize(self):
        # Fail at startup if credentials or the named database are unavailable.
        self.companies()

    def close(self):
        self.client.close()

    def companies(self):
        return [Company.model_validate(unpack(doc)) for doc in self.client.collection('companies').stream(timeout=30)]

    def company(self, deal_id):
        record = unpack(self.client.collection('companies').document(identifier(deal_id)).get(timeout=30))
        return Company.model_validate(record) if record else None

    def create_company(self, company):
        company = Company.model_validate(company.model_dump(mode='json'))
        doc = self.client.collection('companies').document(identifier(company.deal_id))
        try:
            doc.create(envelope(company.model_dump(mode='json')), timeout=30)
        except AlreadyExists:
            if unpack(doc.get(timeout=30)) != company.model_dump(mode='json'):
                raise ValueError('Company ID already belongs to a different workspace.') from None
        self._invalidate(company.deal_id)
        return company

    def ingest(self, result):
        """Validate a complete intake before create-only writes; retries are idempotent.

        Original bytes are indexed privately on this server, never stored as paths
        inside Firestore records. Large intakes use separate immutable writes;
        callers must report a failure honestly and may retry the same identities.
        """
        result = IngestionResult.model_validate(result.model_dump(mode='json'))
        company = self.company(result.company.deal_id)
        if company is None or company.model_dump(mode='json') != result.company.model_dump(mode='json'):
            raise ValueError('Source intake cannot create or change a selected company identity.')
        sources = {s.id: s for s in self.snapshots(company.deal_id)}
        pending = []
        for source in result.snapshots:
            if (source.deal_id, source.entity_key) != (company.deal_id, company.entity_key):
                raise ValueError('Snapshot company does not match ingestion company.')
            data = source.model_dump(mode='json', exclude={'local_path'})
            if data['source_uri'].startswith('file:'):
                data['source_uri'] = 'local-file://' + (source.original_filename or source.id)
            sources[source.id] = source
            pending.append(('source_snapshots', source.id, data))
        for row in result.observations:
            source = sources.get(row.snapshot_id)
            if not source or (row.deal_id, row.entity_key, row.provider) != (company.deal_id, company.entity_key, source.provider):
                raise ValueError('Observation references an unknown or foreign source.')
            pending.append(('source_observations', row.id, row.model_dump(mode='json')))
        if result.profile is not None or result.profiles:
            raise ValueError('Workspace upload intake does not replace primary Akta profiles.')
        writes = self._save_many(company.deal_id, pending)
        return {'snapshots_added': sum(c == 'source_snapshots' for c, _, _ in writes),
                'observations_added': sum(c == 'source_observations' for c, _, _ in writes)}

    def save_document_claims(self, company, claims):
        from app.document_intake import DocumentClaim
        from app.intake import _validate_locator
        sources = {s.id: s for s in self.snapshots(company.deal_id)}
        checked = [DocumentClaim.model_validate(c.model_dump(mode='json') if hasattr(c, 'model_dump') else c) for c in claims]
        for claim in checked:
            if (claim.deal_id, claim.entity_key) != (company.deal_id, company.entity_key) or claim.snapshot_id not in sources:
                raise ValueError('Document claim belongs to another company or source.')
            for evidence in claim.evidence:
                if evidence.get('snapshot_id') not in sources or evidence.get('original_snapshot_id') not in (None, *sources):
                    raise ValueError('Document quotation references an unknown source.')
                if not isinstance(evidence.get('quote'), str) or not evidence['quote'].strip():
                    raise ValueError('Document quotation must retain nonempty original source text.')
                if not isinstance(evidence.get('locator'), dict):
                    raise ValueError('Document quotation needs its native source locator.')
                _validate_locator(evidence['locator'])
        self._save_many(company.deal_id, [('document_claims', claim.id, claim.model_dump(mode='json')) for claim in checked])
        return {'document_claims_received': len(checked)}

    def _save_many(self, deal_id, records):
        """Preflight a batch, then create at most 400 immutable records per commit."""
        indexed = {}
        for collection, record_id, record in records:
            key = (collection, identifier(record_id))
            if key in indexed and indexed[key] != record:
                raise ValueError('Duplicate immutable record identity has different content.')
            envelope(record)
            indexed[key] = record
        prepared = [(collection, record_id, record, self._collection(deal_id, collection).document(record_id))
                    for (collection, record_id), record in indexed.items()]
        previous = {}
        if hasattr(self.client, 'get_all'):
            for start in range(0, len(prepared), 200):
                for document in self.client.get_all([row[3] for row in prepared[start:start+200]], timeout=30):
                    previous[document.reference.path] = unpack(document)
        writes = []
        for collection, record_id, record, ref in prepared:
            old = previous.get(ref.path) if hasattr(self.client, 'get_all') else unpack(ref.get(timeout=30))
            if old is not None and old != record:
                raise ValueError('Existing immutable source/observation/claim has different content.')
            if old is None:
                writes.append((collection, record_id, record, ref))
        try:
            for start in range(0, len(writes), 400):
                group = writes[start:start+400]
                if hasattr(self.client, 'batch'):
                    batch = self.client.batch()
                    for _, _, record, ref in group:
                        batch.create(ref, envelope(record))
                    try:
                        batch.commit(timeout=30)
                    except AlreadyExists:
                        # A concurrent identical retry is acceptable; mismatched
                        # content cannot be replaced by either writer.
                        if any(unpack(ref.get(timeout=30)) != record for _, _, record, ref in group):
                            raise ValueError('Concurrent immutable batch identity conflict.') from None
                else:
                    for _, _, record, ref in group:
                        try:ref.create(envelope(record), timeout=30)
                        except AlreadyExists:
                            if unpack(ref.get(timeout=30)) != record:
                                raise ValueError('Concurrent immutable record identity conflict.') from None
        finally:
            self._invalidate(deal_id)
        return [(collection, record_id, record) for collection, record_id, record, _ in writes]

    def _collection(self, deal_id, name):
        return self.client.collection('companies').document(identifier(deal_id)).collection(name)

    def bundle(self, deal_id):
        identifier(deal_id)
        def read(name):
            values = [unpack(doc) for doc in self._collection(deal_id, name).stream(timeout=30)]
            for record in values:
                if name == 'company_profiles':
                    continue
                if record.get('deal_id') != deal_id:
                    raise ValueError('Stored record belongs to another company.')
            return name, values
        while True:
            with self._lock:
                cached = self._cache.get(deal_id)
                if cached and monotonic() - cached[0] < self.cache_seconds:
                    return cached[1]
                generation = self._generation.get(deal_id, 0)
            with ThreadPoolExecutor(max_workers=6) as pool:
                result = dict(pool.map(read, COLLECTIONS))
            with self._lock:
                if self._generation.get(deal_id, 0) != generation:
                    # An upload/calculation committed while these independent
                    # reads were in flight. Never return or cache that old view.
                    continue
                source_ids = {s['id'] for s in result['source_snapshots']}
                if any(p['snapshot_id'] not in source_ids for p in result['company_profiles']):
                    raise ValueError('Company profile is missing its registered source.')
                self._cache[deal_id] = (monotonic(), result)
                return result

    def snapshots(self, deal_id):
        return [SourceSnapshot.model_validate(x) for x in self.bundle(deal_id)['source_snapshots']]

    def observations(self, deal_id, provider=None, metric=None):
        return [Observation.model_validate(x) for x in self.bundle(deal_id)['source_observations']
                if (not provider or x['provider'] == provider) and (not metric or x['metric_key'] == metric)]

    def profiles(self, deal_id):
        return self.bundle(deal_id)['company_profiles']

    def document_claims(self, deal_id):
        return self.bundle(deal_id)['document_claims']

    def narrative_reports(self, deal_id):
        return sorted(self.bundle(deal_id)['narrative_reports'], key=lambda x: (x.get('created_at', ''), x['id']), reverse=True)

    def calculations(self, deal_id):
        return [Calculation.model_validate(x) for x in self.bundle(deal_id)['calculations']]

    def comparisons(self, deal_id):
        return [Comparison.model_validate(x) for x in self.bundle(deal_id)['comparisons']]

    def _find(self, collection, record_id, model):
        identifier(record_id)
        # Direct ID lookups avoid collection-group indexes and preserve company scope.
        for company in self.companies():
            data = unpack(self._collection(company.deal_id, collection).document(record_id).get(timeout=30))
            if data:
                if data['deal_id'] != company.deal_id:
                    raise ValueError('Stored record belongs to another company.')
                return model.model_validate(data)
        return None

    def snapshot(self, record_id):
        return self._find('source_snapshots', record_id, SourceSnapshot)

    def observation(self, record_id):
        return self._find('source_observations', record_id, Observation)

    def calculation(self, record_id):
        return self._find('calculations', record_id, Calculation)

    def save_record(self, deal_id, collection, record_id, record):
        if collection not in (*COLLECTIONS, 'report_drafts'):
            raise ValueError('Unsupported record collection.')
        if not self.company(deal_id) or record.get('deal_id') != deal_id:
            raise ValueError('Record belongs to an unknown or different company.')
        doc = self._collection(deal_id, collection).document(identifier(record_id))
        data = envelope(record)
        try:
            doc.create(data, timeout=30)
        except AlreadyExists:
            if unpack(doc.get(timeout=30)) != record:
                raise ValueError('Existing immutable record has different content.') from None
        self._invalidate(deal_id)

    def save_calculation(self, result):
        from app.lineage import build_calculation_lineage
        rows = {o.id: o for o in self.observations(result.deal_id)}
        if not set(result.input_ids) <= rows.keys():
            raise ValueError('Unknown calculation input.')
        build_calculation_lineage(result, [rows[i] for i in result.input_ids], self.snapshots(result.deal_id))
        self.save_record(result.deal_id, 'calculations', result.id, result.model_dump(mode='json'))

    def save_comparison(self, result):
        rows = {o.id for o in self.observations(result.deal_id)}
        if result.lhs_id not in rows or result.rhs_id not in rows:
            raise ValueError('Unknown comparison input.')
        self.save_record(result.deal_id, 'comparisons', result.id, result.model_dump(mode='json'))

    def local_source_file(self, source):
        from app.workspace_intake import uploaded_source_path
        uploaded = uploaded_source_path(source)
        if uploaded is not None:
            return uploaded
        manifest = os.getenv('SOURCE_FILE_MANIFEST')
        if not manifest:
            return None
        entries = json.loads(Path(manifest).read_text())
        entry = entries.get(source.id)
        if not entry or entry.get('sha256') != source.sha256:
            return None
        path = Path(entry['path'])
        return path if path.is_file() else None
