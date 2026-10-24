"""Native embedded DuckDB store with immutable, exact-decimal JSON records.

The constructor is lazy: importing the FastAPI app neither creates nor locks a
file. One native connection is shared under a reentrant lock, including for
in-memory demos. All writes are transactional; no external database is used.
"""
from contextlib import contextmanager
from decimal import Decimal
import json
from pathlib import Path
from threading import RLock

import duckdb

from app.db_schema import SCHEMA_SQL, SCHEMA_VERSION, TABLE_NAMES
from app.schemas import Calculation, Company, Comparison, IngestionResult, Observation, SourceSnapshot, stable_id


def _dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), default=str, allow_nan=False)


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def _decimal_text(value):
    return str(value) if value is not None else None


class Store:
    def __init__(self, path: str | Path):
        database = str(path)
        if '://' in database:
            raise ValueError('Store requires a DuckDB file path or :memory:, not a database URL.')
        self.path = database if database == ':memory:' else str(Path(database).expanduser().resolve())
        self._lock = RLock()
        self._connection = None
        self._closed = False

    def _connect(self):
        if self._closed:
            raise ValueError('DuckDB store is closed.')
        if self._connection is None:
            if self.path != ':memory:':
                Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            self._connection = duckdb.connect(self.path)
        return self._connection

    @contextmanager
    def transaction(self):
        """A locked native DuckDB transaction, also available to local SQL tests."""
        with self._lock:
            connection = self._connect()
            connection.execute('BEGIN TRANSACTION')
            try:
                yield connection
                connection.execute('COMMIT')
            except BaseException:
                connection.execute('ROLLBACK')
                raise

    def close(self):
        with self._lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None
            self._closed = True

    def __enter__(self):
        self.initialize()
        return self

    def __exit__(self, *_):
        self.close()

    def initialize(self):
        with self.transaction() as db:
            existing = {row[0] for row in db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main' AND table_type='BASE TABLE'").fetchall()}
            if existing:
                if 'schema_versions' not in existing:
                    raise ValueError('Existing unversioned tables found. Use a fresh DuckDB file; bootstrap will not rewrite another schema.')
                versions = [row[0] for row in db.execute('SELECT version FROM schema_versions ORDER BY version').fetchall()]
                if versions != [SCHEMA_VERSION] or not TABLE_NAMES.issubset(existing):
                    raise ValueError('Unsupported or incomplete DuckDB schema version. Use a reviewed migration or a fresh file.')
                return
            db.execute(SCHEMA_SQL)

    @staticmethod
    def _insert(db, table, fields):
        # Table and column names are internal constants, never source/client SQL.
        columns = ','.join(fields)
        placeholders = ','.join('?' for _ in fields)
        db.execute(f'INSERT INTO {table} ({columns}) VALUES ({placeholders})', list(fields.values()))

    def company(self, deal_id: str) -> Company | None:
        with self._lock:
            db = self._connect()
            row = db.execute('''SELECT d.id, e.entity_key, e.legal_name, e.domain, e.country,
                                       d.historical_cutoff, e.primary_provider, e.primary_company_id
                                FROM deals d JOIN entities e ON e.deal_id=d.id
                                WHERE d.id=? ORDER BY e.entity_key LIMIT 1''', [deal_id]).fetchone()
            if row is None:
                return None
            identifiers = db.execute('SELECT namespace, identifier FROM entity_identifiers WHERE deal_id=? AND entity_key=? ORDER BY namespace, identifier', [deal_id, row[1]]).fetchall()
            return Company(deal_id=row[0], entity_key=row[1], legal_name=row[2], domain=row[3], country=row[4],
                           historical_cutoff=row[5], identifiers=dict(identifiers), primary_provider=row[6], primary_company_id=row[7])

    def ingest(self, result: IngestionResult) -> dict:
        added = {'snapshots_added': 0, 'observations_added': 0}
        company = result.company
        with self.transaction() as db:
            existing_entity = db.execute('SELECT legal_name, domain, country, primary_company_id FROM entities WHERE deal_id=? AND entity_key=?', [company.deal_id, company.entity_key]).fetchone()
            if existing_entity:
                if existing_entity[:3] != (company.legal_name, company.domain, company.country):
                    raise ValueError('Uploaded evidence cannot change the selected legal entity or company profile.')
                if company.primary_company_id and existing_entity[3] and company.primary_company_id != existing_entity[3]:
                    raise ValueError('Akta company identifier conflicts with the selected company.')
            deal = db.execute('SELECT name, historical_cutoff FROM deals WHERE id=?', [company.deal_id]).fetchone()
            if deal is None:
                self._insert(db, 'deals', {'id': company.deal_id, 'name': company.legal_name, 'historical_cutoff': company.historical_cutoff})
            elif deal != (company.legal_name, company.historical_cutoff):
                db.execute('UPDATE deals SET name=?, historical_cutoff=? WHERE id=?', [company.legal_name, company.historical_cutoff, company.deal_id])
            if existing_entity is None:
                self._insert(db, 'entities', {'deal_id': company.deal_id, 'entity_key': company.entity_key, 'legal_name': company.legal_name,
                    'domain': company.domain, 'country': company.country, 'primary_provider': 'akta', 'primary_company_id': company.primary_company_id})
            elif company.primary_company_id and company.primary_company_id != existing_entity[3] and any(s.provider == 'akta' and s.data_role == 'primary_company_data' for s in result.snapshots):
                db.execute('UPDATE entities SET primary_company_id=? WHERE deal_id=? AND entity_key=?', [company.primary_company_id, company.deal_id, company.entity_key])
            for namespace, identifier in company.identifiers.items():
                row_id = stable_id(company.deal_id, company.entity_key, namespace, identifier)
                if db.execute('SELECT 1 FROM entity_identifiers WHERE id=?', [row_id]).fetchone() is None:
                    self._insert(db, 'entity_identifiers', {'id': row_id, 'deal_id': company.deal_id, 'entity_key': company.entity_key, 'namespace': namespace, 'identifier': identifier})
            for snapshot in result.snapshots:
                if (snapshot.deal_id, snapshot.entity_key) != (company.deal_id, company.entity_key):
                    raise ValueError('Snapshot company does not match ingestion company')
                previous = db.execute('SELECT payload FROM source_snapshots WHERE id=?', [snapshot.id]).fetchone()
                payload = snapshot.model_dump(mode='json')
                if previous is not None:
                    old_identity = {k: v for k, v in _json(previous[0]).items() if k != 'retrieved_at'}
                    new_identity = {k: v for k, v in payload.items() if k != 'retrieved_at'}
                    if old_identity != new_identity:
                        raise ValueError('Existing source snapshot ID conflicts with immutable source data; create a new versioned snapshot.')
                else:
                    fields = snapshot.model_dump(exclude={'context'})
                    fields['payload'] = _dump(payload)
                    self._insert(db, 'source_snapshots', fields)
                    added['snapshots_added'] += 1
            for observation in result.observations:
                if (observation.deal_id, observation.entity_key) != (company.deal_id, company.entity_key):
                    raise ValueError('Observation company does not match ingestion company')
                source = db.execute('SELECT deal_id, entity_key, provider FROM source_snapshots WHERE id=?', [observation.snapshot_id]).fetchone()
                if source is None:
                    raise ValueError('Observation references an unknown source snapshot.')
                if source != (observation.deal_id, observation.entity_key, observation.provider):
                    raise ValueError('Observation deal, entity or provider does not match its source snapshot.')
                previous = db.execute('SELECT payload FROM source_observations WHERE id=?', [observation.id]).fetchone()
                payload = observation.model_dump(mode='json')
                if previous is not None:
                    if _json(previous[0]) != payload:
                        raise ValueError('Existing observation ID conflicts with immutable source data; create a new versioned observation.')
                else:
                    columns = ['id','deal_id','entity_key','snapshot_id','provider','metric_key','definition_key','raw_value','normalization_basis','currency','unit','scope','accounting_basis','scenario','verification_status','quarantined','information_as_of','normalization_status','period_kind','period_start','period_end']
                    fields = {key: getattr(observation, key) for key in columns}
                    fields.update(value=_decimal_text(observation.value), scale_multiplier=_decimal_text(observation.scale_multiplier), locator=_dump(observation.locator), payload=_dump(payload))
                    self._insert(db, 'source_observations', fields)
                    added['observations_added'] += 1
            profile_sources = {s.id: s for s in result.snapshots if s.provider == 'akta' and s.ingestion_channel == 'provider_api' and s.data_role == 'primary_company_data' and s.context.get('record_type') == 'enrichment'}
            pending_profiles = dict(result.profiles)
            if result.profile is not None:
                if len(profile_sources) != 1:
                    raise ValueError('Company profile requires exactly one Akta enrichment snapshot.')
                pending_profiles[next(iter(profile_sources))] = result.profile
            for source_id, profile in pending_profiles.items():
                if source_id not in profile_sources:
                    raise ValueError('Company profile must be bound to a primary Akta enrichment snapshot.')
                previous = db.execute('SELECT payload FROM company_profiles WHERE snapshot_id=?', [source_id]).fetchone()
                if previous is not None:
                    if _json(previous[0]) != profile:
                        raise ValueError('Existing company profile conflicts with its immutable source snapshot.')
                else:
                    self._insert(db, 'company_profiles', {'snapshot_id': source_id, 'deal_id': company.deal_id, 'entity_key': company.entity_key, 'provider': 'akta', 'data_role': 'primary_company_data', 'payload': _dump(profile)})
        return added

    def observations(self, deal_id: str, provider: str | None = None, metric: str | None = None) -> list[Observation]:
        with self._lock:
            query, parameters = 'SELECT payload FROM source_observations WHERE deal_id=?', [deal_id]
            if provider:
                query += ' AND provider=?'
                parameters.append(provider)
            if metric:
                query += ' AND metric_key=?'
                parameters.append(metric)
            rows = self._connect().execute(query + ' ORDER BY provider, metric_key, id', parameters).fetchall()
            return [Observation.model_validate_json(row[0]) for row in rows]

    def observation(self, record_id: str) -> Observation | None:
        with self._lock:
            row = self._connect().execute('SELECT payload FROM source_observations WHERE id=?', [record_id]).fetchone()
            return Observation.model_validate_json(row[0]) if row else None

    def snapshots(self, deal_id: str) -> list[SourceSnapshot]:
        with self._lock:
            rows = self._connect().execute('SELECT payload FROM source_snapshots WHERE deal_id=? ORDER BY provider, id', [deal_id]).fetchall()
            return [SourceSnapshot.model_validate_json(row[0]) for row in rows]

    def snapshot(self, record_id: str) -> SourceSnapshot | None:
        with self._lock:
            row = self._connect().execute('SELECT payload FROM source_snapshots WHERE id=?', [record_id]).fetchone()
            return SourceSnapshot.model_validate_json(row[0]) if row else None

    def profiles(self, deal_id: str) -> list[dict]:
        with self._lock:
            rows = self._connect().execute('SELECT snapshot_id, provider, payload FROM company_profiles WHERE deal_id=? ORDER BY snapshot_id', [deal_id]).fetchall()
            return [{'snapshot_id': row[0], 'provider': row[1], 'profile': _json(row[2])} for row in rows]

    def document_claims(self, deal_id: str) -> list[dict]:
        """Read B's optional extension without creating or migrating its schema."""
        with self._lock:
            db = self._connect()
            exists = db.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='main' AND table_name='document_claims'").fetchone()[0]
            if not exists:
                return []
            rows = db.execute('SELECT payload FROM document_claims WHERE deal_id=? ORDER BY id', [deal_id]).fetchall()
            return [_json(row[0]) for row in rows]

    def narrative_reports(self, deal_id: str) -> list[dict]:
        with self._lock:
            db = self._connect()
            exists = db.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='main' AND table_name='narrative_reports'").fetchone()[0]
            if not exists:
                return []
            rows = db.execute('SELECT payload FROM narrative_reports WHERE deal_id=? ORDER BY created_at DESC, id', [deal_id]).fetchall()
            return [_json(row[0]) for row in rows]

    def save_comparison(self, result: Comparison):
        with self.transaction() as db:
            payload = result.model_dump(mode='json')
            previous = db.execute('SELECT payload FROM comparisons WHERE id=?', [result.id]).fetchone()
            if previous:
                if _json(previous[0]) != payload:
                    raise ValueError('Existing comparison ID conflicts with immutable comparison data.')
                return
            self._insert(db, 'comparisons', {'id': result.id, 'deal_id': result.deal_id, 'lhs_id': result.lhs_id, 'rhs_id': result.rhs_id,
                'status': result.status, 'delta': _decimal_text(result.delta), 'payload': _dump(payload)})

    def comparisons(self, deal_id: str) -> list[Comparison]:
        with self._lock:
            rows = self._connect().execute('SELECT payload FROM comparisons WHERE deal_id=? ORDER BY id', [deal_id]).fetchall()
            return [Comparison.model_validate_json(row[0]) for row in rows]

    def save_calculation(self, result: Calculation):
        with self.transaction() as db:
            payload = result.model_dump(mode='json')
            previous = db.execute('SELECT payload FROM calculations WHERE id=?', [result.id]).fetchone()
            if previous:
                if _json(previous[0]) != payload:
                    raise ValueError('Existing calculation ID conflicts with immutable calculation data.')
                return
            self._insert(db, 'calculations', {'id': result.id, 'deal_id': result.deal_id, 'metric_key': result.metric_key,
                'function_key': result.function_key, 'function_version': result.function_version, 'status': result.status,
                'value': _decimal_text(result.value), 'payload': _dump(payload)})
            for index, input_id in enumerate(result.input_ids, 1):
                self._insert(db, 'calculation_inputs', {'calculation_id': result.id, 'observation_id': input_id, 'deal_id': result.deal_id, 'input_order': index})

    def calculation(self, record_id: str) -> Calculation | None:
        with self._lock:
            row = self._connect().execute('SELECT payload FROM calculations WHERE id=?', [record_id]).fetchone()
            return Calculation.model_validate_json(row[0]) if row else None

    def calculations(self, deal_id: str) -> list[Calculation]:
        with self._lock:
            rows = self._connect().execute('SELECT payload FROM calculations WHERE deal_id=? ORDER BY id', [deal_id]).fetchall()
            return [Calculation.model_validate_json(row[0]) for row in rows]
