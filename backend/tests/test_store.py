from datetime import datetime, timezone
from decimal import Decimal

import pytest
import duckdb

from app.schemas import CIRCLE, IngestionResult, Observation, SourceSnapshot
from app.store import Store


@pytest.fixture
def store(tmp_path):
    value = Store(tmp_path / 'integrity.duckdb')
    value.initialize()
    yield value
    value.close()


def snapshot(identifier='source-1', **updates):
    data = dict(
        id=identifier, deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        provider='orbis', source_kind='native_workbook', source_uri='https://example.invalid/source',
        local_path='/source.xlsx', sha256='a' * 64,
        retrieved_at=datetime(2026, 10, 24, tzinfo=timezone.utc),
        context={'identity': 'verified_circle'},
    )
    data.update(updates)
    return SourceSnapshot(**data)


def observation(identifier='observation-1', **updates):
    data = dict(
        id=identifier, deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        snapshot_id='source-1', provider='orbis', metric_key='orbis.revenue', raw_label='Revenue',
        raw_value='2746642', value=Decimal('2746642000'), unit='USD', currency='USD',
        scale_multiplier=Decimal(1000), normalization_status='confirmed',
        normalization_basis='Explicit thousand USD source header',
        locator={'kind': 'xlsx_cell', 'sheet': 'CIRCLE_INTERNET_GROUP__INC', 'cell': 'F81'},
    )
    data.update(updates)
    return Observation(**data)


def intake(snapshots=None, observations=None, company=CIRCLE, profile=None):
    return IngestionResult(company=company,
                           snapshots=[snapshot()] if snapshots is None else snapshots,
                           observations=[observation()] if observations is None else observations,
                           profile=profile)


def test_source_replay_accepts_only_retrieval_timestamp_change(store):
    first = store.ingest(intake())
    assert first == {'snapshots_added': 1, 'observations_added': 1}
    later = snapshot(retrieved_at=datetime(2026, 10, 25, tzinfo=timezone.utc))
    assert store.ingest(intake(snapshots=[later])) == {'snapshots_added': 0, 'observations_added': 0}
    # Retain the initial immutable record; a re-fetch does not rewrite history.
    assert store.snapshots(CIRCLE.deal_id)[0].retrieved_at == snapshot().retrieved_at


@pytest.mark.parametrize('changes', [
    {'sha256': 'b' * 64},
    {'provider': 'pitchbook'},
    {'source_uri': 'https://example.invalid/another-source'},
    {'source_kind': 'manual_capture'},
    {'local_path': '/different-source.xlsx'},
    {'context': {'identity': 'different_entity'}},
    {'provider_as_of': '2025-01-01'},
])
def test_stable_snapshot_fields_cannot_be_rebound_under_existing_id(store, changes):
    store.ingest(intake())
    with pytest.raises(ValueError, match='immutable source data'):
        store.ingest(intake(snapshots=[snapshot(**changes)]))
    saved = store.snapshots(CIRCLE.deal_id)[0]
    assert saved.model_dump() == snapshot().model_dump()


@pytest.mark.parametrize('changes', [
    {'value': Decimal('123')},
    {'raw_value': 'different'},
    {'definition_key': 'unreviewed_definition'},
    {'locator': {'kind': 'xlsx_cell', 'sheet': 'CIRCLE_INTERNET_GROUP__INC', 'cell': 'F82'}},
    {'notes': ['Changed interpretation under the same ID']},
])
def test_observation_identity_conflict_rolls_back_whole_ingest(store, changes):
    store.ingest(intake())
    new_source = snapshot('source-2', source_uri='https://example.invalid/new', sha256='b' * 64)
    changed_company = CIRCLE.model_copy(update={
        'identifiers': {**CIRCLE.identifiers, 'test_extra': 'must-not-persist'}})
    with pytest.raises(ValueError, match='immutable source data'):
        store.ingest(intake(snapshots=[new_source], observations=[observation(**changes)], company=changed_company))
    assert [s.id for s in store.snapshots(CIRCLE.deal_id)] == ['source-1']
    assert store.observation('observation-1').model_dump() == observation().model_dump()
    assert store.company(CIRCLE.deal_id).legal_name == CIRCLE.legal_name
    assert 'test_extra' not in store.company(CIRCLE.deal_id).identifiers


def test_application_rejects_wrong_provider_reference(store):
    with pytest.raises(ValueError, match='provider does not match'):
        store.ingest(intake(observations=[observation(provider='pitchbook')]))
    assert store.company(CIRCLE.deal_id) is None
    assert store.snapshots(CIRCLE.deal_id) == []


def test_new_observation_versions_are_accepted_without_overwriting_old(store):
    store.ingest(intake())
    replacement = observation('observation-2', value=Decimal('123'))
    assert store.ingest(intake(snapshots=[], observations=[replacement]))['observations_added'] == 1
    assert store.observation('observation-1').value == Decimal('2746642000')
    assert store.observation('observation-2').value == Decimal('123')


def test_database_rejects_provider_mismatch_even_without_application_checks(store):
    store.ingest(intake())
    with store.transaction() as db:
        cursor = db.execute('SELECT * FROM source_observations LIMIT 1')
        columns = [item[0] for item in cursor.description]
        values = dict(zip(columns, cursor.fetchone()))
    values.update(id='invalid-provider-observation', provider='pitchbook')
    with pytest.raises(duckdb.ConstraintException):
        with store.transaction() as db:
            placeholders = ','.join('?' for _ in values)
            db.execute('INSERT INTO source_observations (' + ','.join(values) + ') VALUES (' + placeholders + ')', list(values.values()))


def test_database_rejects_profile_provider_mismatch(store):
    store.ingest(intake())
    with pytest.raises(duckdb.ConstraintException):
        with store.transaction() as db:
            db.execute('INSERT INTO company_profiles VALUES (?, ?, ?, ?, ?, ?)',
                       ['source-1', CIRCLE.deal_id, CIRCLE.entity_key, 'akta', 'primary_company_data', '{}'])


def test_profile_replay_cannot_change_payload_under_same_source(store):
    source = snapshot(provider='akta', ingestion_channel='provider_api', data_role='primary_company_data', source_kind='provider_json_api', context={'record_type': 'enrichment'})
    result = intake(snapshots=[source], observations=[], profile={'uuid': 'circle-akta', 'name': 'Circle'})
    assert store.ingest(result)['snapshots_added'] == 1
    assert store.ingest(result)['snapshots_added'] == 0
    altered = result.model_copy(update={'profile': {'uuid': 'circle-akta', 'name': 'Different'}})
    with pytest.raises(ValueError, match='immutable source snapshot'):
        store.ingest(altered)
    assert store.profiles(CIRCLE.deal_id)[0]['profile'] == result.profile


def test_uploaded_akta_export_cannot_become_primary_profile(store):
    source = snapshot(provider='akta', context={'record_type':'enrichment'})
    with pytest.raises(ValueError, match='Akta enrichment snapshot'):
        store.ingest(intake(snapshots=[source],observations=[],profile={'name':'Uploaded export'}))
    assert store.profiles(CIRCLE.deal_id) == []


def test_upload_cannot_replace_selected_entity(store):
    store.ingest(intake())
    other = CIRCLE.model_copy(update={'legal_name':'Different legal entity'})
    with pytest.raises(ValueError, match='selected legal entity'):
        store.ingest(intake(company=other))
    assert store.company(CIRCLE.deal_id).legal_name == CIRCLE.legal_name


def test_constructor_is_lazy_and_embedded_memory_uses_one_persistent_connection(tmp_path):
    path = tmp_path / 'not-created-on-import' / 'lazy.duckdb'
    lazy = Store(path)
    assert not path.exists() and not path.parent.exists()
    lazy.close()
    with Store(':memory:') as memory:
        memory.ingest(intake())
        assert memory.observation('observation-1').value == Decimal('2746642000')
        memory.initialize()  # Versioned replay must not reset an in-memory DB.
        assert memory.company(CIRCLE.deal_id).legal_name == CIRCLE.legal_name


def test_decimal_columns_and_json_keep_precision_beyond_fixed_scale(store):
    precise = Decimal('123456789012345678901234567890123456789.12345678901234567890123456789')
    multiplier = Decimal('0.000000000000000000000000000001')
    store.ingest(intake(observations=[observation(value=precise, scale_multiplier=multiplier)]))
    saved = store.observation('observation-1')
    assert saved.value == precise and saved.scale_multiplier == multiplier
    with store.transaction() as db:
        row = db.execute('SELECT value, scale_multiplier, typeof(value), typeof(payload) FROM source_observations').fetchone()
    assert row == (str(precise), str(multiplier), 'VARCHAR', 'JSON')


def test_native_schema_keeps_baseline_and_adds_workspace_tables_without_accepting_foreign_db(tmp_path):
    with Store(':memory:') as memory:
        with memory.transaction() as db:
            names = {row[0] for row in db.execute('SHOW TABLES').fetchall()}
        from app.db_schema import TABLE_NAMES
        assert names == TABLE_NAMES | {'report_drafts', 'workspace_settings'}
    path = tmp_path / 'foreign.duckdb'
    with duckdb.connect(str(path)) as db:
        db.execute('CREATE TABLE unrelated (value INTEGER)')
    foreign = Store(path)
    with pytest.raises(ValueError, match='unversioned'):
        foreign.initialize()
    foreign.close()


def test_locked_native_connection_supports_concurrent_api_workers(store):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: store.ingest(intake()), range(12)))
    assert sum(result['snapshots_added'] for result in results) == 1
    assert sum(result['observations_added'] for result in results) == 1
    assert len(store.observations(CIRCLE.deal_id)) == 1


def test_duckdb_file_reopens_without_data_loss(tmp_path):
    path = tmp_path / 'persistent.duckdb'
    with Store(path) as first:
        first.ingest(intake())
    with Store(path) as second:
        assert second.observation('observation-1').raw_value == '2746642'
        assert second.ingest(intake()) == {'snapshots_added': 0, 'observations_added': 0}


def test_legacy_database_urls_are_not_silently_supported():
    with pytest.raises(ValueError, match='DuckDB file path'):
        Store('sqlite:///old.db')
