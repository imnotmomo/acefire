"""Real browser workflows: reviewed inputs, shared drafts, concurrent edits, old DB reopen."""
from copy import deepcopy
from decimal import Decimal
import json
from types import SimpleNamespace
from threading import Barrier, Event
import os

from fastapi.testclient import TestClient
import pytest

from app.db_schema import SCHEMA_SQL
from app.firebase_store import FirebaseStore, envelope
from app.main import create_app
from app.report_drafts import DraftVersionConflict, new_record, summary
from app.schemas import CIRCLE, IngestionResult, Observation, SourceSnapshot
from app.store import Store
from app.workspace_routes import UploadJobs
from app.workspace_intake import atomic_json


def seeded_store(path=':memory:'):
    store = Store(path)
    store.initialize()
    source = SourceSnapshot(id='original', deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        provider='uploaded', source_kind='csv', original_filename='cash.csv',
        source_uri='upload://cash.csv', sha256='a' * 64)
    row = Observation(id='raw-cash', deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        provider='uploaded', snapshot_id=source.id, metric_key='uploaded.cash', raw_label='Cash',
        raw_value='100.123400000000000006', locator={'kind':'csv_row', 'row':2, 'quote':'Cash,100.123400000000000006'})
    store.ingest(IngestionResult(company=CIRCLE, snapshots=[source], observations=[row]))
    return store, row


def review_body():
    return {'metric_key':'cash', 'unit':'USD', 'currency':'USD', 'scale_multiplier':'1000',
            'normalization_basis':'User checked source table header: thousand USD.',
            'period_kind':'instant', 'period_end':'2024-12-31', 'scenario':'actual'}


def editor_workspace(content=None):
    config = {'topics':[], 'depth':'Standard', 'geography':'Global', 'horizon':'Source period',
              'scope':'Internal only', 'focus':''}
    return {'order':['overview'], 'configs':{}, 'revisions':[], 'generatedAt':None,
            'sections':[] if content is None else [{'id':'overview', 'title':'Overview', 'content':content,
                                                   'evidenceIds':[], 'config':config}]}


def test_review_makes_exact_immutable_input_and_retains_original_evidence():
    store, original = seeded_store()
    original_payload = original.model_dump(mode='json')
    with TestClient(create_app(store=store)) as client:
        before = client.get(f'/deals/{CIRCLE.deal_id}/report').json()['report_id']
        response = client.post(f'/deals/{CIRCLE.deal_id}/observations/{original.id}/normalize', json=review_body())
        assert response.status_code == 200, response.text
        payload = response.json(); reviewed = payload['observation']
        assert reviewed['value'] == '100123.400000000000006000'
        assert reviewed['reviewed_from_id'] == original.id and reviewed['id'] != original.id
        assert reviewed['locator'] == original.locator and reviewed['raw_value'] == original.raw_value
        assert reviewed['snapshot_id'] == original.snapshot_id and reviewed['verification_status'] == 'needs_review'
        assert store.observation(original.id).model_dump(mode='json') == original_payload
        repeat = client.post(f'/deals/{CIRCLE.deal_id}/observations/{original.id}/normalize', json=review_body())
        assert repeat.json()['created'] is False and repeat.json()['observation']['id'] == reviewed['id']
        report = client.get(f'/deals/{CIRCLE.deal_id}/report').json()
        assert report['report_id'] != before and len(report['reported_metrics']) == 2
        source_row = next(item for item in report['reported_metrics'] if item['observation']['id'] == reviewed['id'])
        assert source_row['source']['sha256'] == 'a'*64 and source_row['source']['locator'] == original.locator
        assert client.post('/deals/foreign/observations/raw-cash/normalize', json=review_body()).status_code == 404
        for patch in ({'value':'100'}, {'raw_value':'100'}, {'scale_multiplier':0.1},
                      {'period_start':'2024-01-01'}, {'definition_key':'guessed.cash'}, {'unit':' '}):
            assert client.post(f'/deals/{CIRCLE.deal_id}/observations/{original.id}/normalize', json={**review_body(), **patch}).status_code == 422


def test_generated_and_manual_drafts_survive_reload_and_stale_browser_cannot_overwrite(tmp_path):
    path = tmp_path/'old.duckdb'
    store, _ = seeded_store(path)
    class Generator:
        def generate(self, deal, request, catalog):
            return {'id':'generated-draft', 'deal_id':deal, 'based_on_report_id':request.based_on_report_id,
                    'model':'test-provider', 'sections':[{'id':'overview', 'claims':[], 'gaps':['Fixture gap']}],
                    'evidence_manifest':catalog}
    with TestClient(create_app(store=store, narrative_factory=Generator)) as client:
        report_id = client.get(f'/deals/{CIRCLE.deal_id}/report').json()['report_id']
        generated = client.post(f'/deals/{CIRCLE.deal_id}/report/draft', json={
            'based_on_report_id':report_id, 'sections':[{'id':'overview','title':'Overview'}]})
        assert generated.status_code == 200, generated.text
        assert generated.json()['persisted_version'] == 1
        assert generated.json()['drafting_preferences'][0]['title'] == 'Overview'
        endpoint = f'/deals/{CIRCLE.deal_id}/report-drafts/generated-draft'
        cloud = client.get(endpoint).json()
        assert cloud['version'] == 1 and cloud['workspace'] is None
        original_draft = deepcopy(cloud['draft'])
        edited = {**editor_workspace('Human interpretation; not a source quotation.'),
                  'sharedDraftId':'cannot-change-record-id', 'sharedDraftVersion':300}
        saved = client.put(endpoint, json={'expected_version':1,'workspace':edited})
        assert saved.status_code == 200 and saved.json()['version'] == 2
        assert saved.json()['id'] == 'generated-draft' and saved.json()['draft'] == original_draft
        conflict = client.put(endpoint, json={'expected_version':1,'workspace':editor_workspace()})
        assert conflict.status_code == 409 and conflict.json()['detail']['code'] == 'draft_version_conflict'
        assert client.get(endpoint).json()['workspace'] == edited
        manual = client.post(f'/deals/{CIRCLE.deal_id}/report-drafts', json={
            'based_on_report_id':report_id, 'workspace':edited})
        assert manual.status_code == 201 and manual.json()['draft'] is None
        assert len(client.get(f'/deals/{CIRCLE.deal_id}/report-drafts').json()['drafts']) == 2
        # Editable drafts are not imported source reports or new company evidence.
        assert store.narrative_reports(CIRCLE.deal_id) == []
        assert client.get(f'/deals/{CIRCLE.deal_id}/report').json()['report_id'] == report_id
        assert client.post(f'/deals/{CIRCLE.deal_id}/report-drafts', json={
            'based_on_report_id':'stale', 'workspace':edited}).status_code == 409
        for bad in ({'sections':1}, {**edited,'sections':None}, {**edited,'sections':[{'id':'foreign'}]},
                    {**edited,'order':['overview','overview']}, {**edited,'revisions':'bad'},
                    {**edited,'configs':{'overview':None}}):
            assert client.put(endpoint, json={'expected_version':2,'workspace':bad}).status_code == 422
            assert client.post(f'/deals/{CIRCLE.deal_id}/report-drafts', json={
                'based_on_report_id':report_id, 'workspace':bad}).status_code == 422
        assert client.get(endpoint).json()['workspace'] == edited
        assert len(client.get(f'/deals/{CIRCLE.deal_id}/report-drafts').json()['drafts']) == 2
    reopened = Store(path); reopened.initialize()
    assert reopened.report_draft(CIRCLE.deal_id, 'generated-draft')['workspace'] == edited
    assert reopened.report_draft('foreign', 'generated-draft') is None
    reopened.close()


def test_old_schema_and_original_observation_bytes_remain_compatible(tmp_path):
    path = tmp_path/'version-one.duckdb'
    old = Store(path)
    old._connect().execute(SCHEMA_SQL)  # Exactly the existing schema, no draft table.
    old.close()
    migrated = Store(path); migrated.initialize()
    assert migrated.report_drafts(CIRCLE.deal_id) == []
    migrated.close()
    store, row = seeded_store(path)
    # Null additive fields must not alter immutable historical JSON on replay.
    assert 'reviewed_from_id' not in row.model_dump(mode='json')
    before = store._connect().execute('SELECT payload FROM source_observations WHERE id=?', [row.id]).fetchone()[0]
    assert store.ingest(IngestionResult(company=CIRCLE, snapshots=[], observations=[row]))['observations_added'] == 0
    after = store._connect().execute('SELECT payload FROM source_observations WHERE id=?', [row.id]).fetchone()[0]
    assert before == after
    store.close()


def test_summary_of_older_malformed_workspace_does_not_poison_saved_draft_list():
    record = new_record(CIRCLE.deal_id, 'evidence-version', draft={'id':'old-draft', 'sections':[]})
    for corrupt in (None, 1, [], 'bad'):
        record['workspace'] = {'sections':corrupt}
        assert summary(record)['section_count'] == 0


def test_company_labels_archive_restore_do_not_change_legal_identity_or_existing_evidence():
    store, original = seeded_store()
    before_company = store.company(CIRCLE.deal_id)
    before_sources = [source.model_dump(mode='json') for source in store.snapshots(CIRCLE.deal_id)]
    with TestClient(create_app(store=store)) as client:
        result = client.patch(f'/deals/{CIRCLE.deal_id}', json={
            'display_name':'Circle diligence', 'sector':'Payments', 'geography':'North America', 'archived':True})
        assert result.status_code == 200, result.text
        company = result.json()['company']
        assert company['legal_name'] == before_company.legal_name
        assert company['entity_key'] == before_company.entity_key and company['domain'] == before_company.domain
        assert company['identifiers']['workspace_display_name'] == 'Circle diligence'
        assert client.get('/deals').json()['companies'] == []
        assert client.get('/deals?include_archived=true').json()['companies'][0]['deal_id'] == CIRCLE.deal_id
        # Archiving preserves report/source access and concurrent captured uploads.
        assert client.get(f'/deals/{CIRCLE.deal_id}/report').status_code == 200
        store.ingest(IngestionResult(company=before_company, snapshots=[], observations=[original]))
        assert store.company(CIRCLE.deal_id).identifiers['workspace_sector'] == 'Payments'
        assert [source.model_dump(mode='json') for source in store.snapshots(CIRCLE.deal_id)] == before_sources
        assert client.patch(f'/deals/{CIRCLE.deal_id}', json={'archived':False}).status_code == 200
        assert len(client.get('/deals').json()['companies']) == 1
        for invalid in ({}, {'legal_name':'replacement'}, {'display_name':' '}, {'archived':None}):
            assert client.patch(f'/deals/{CIRCLE.deal_id}', json=invalid).status_code == 422


def test_firestore_mutable_labels_are_separate_and_stale_upload_identity_still_matches():
    from google.api_core.exceptions import AlreadyExists, FailedPrecondition
    class Cloud:
        rows = {}
        versions = {}
        def collection(self, name): return Collection(self, name)
    class Collection:
        def __init__(self, client, path): self.client, self.path = client, path
        def document(self, name): return Document(self.client, self.path + '/' + name)
        def stream(self, **kwargs):
            return [Document(self.client, key).get() for key in self.client.rows
                    if key.startswith(self.path+'/') and '/' not in key[len(self.path)+1:]]
    class Document(Collection):
        def collection(self, name): return Collection(self.client, self.path + '/' + name)
        def get(self, **kwargs):
            value = deepcopy(self.client.rows.get(self.path))
            return SimpleNamespace(exists=value is not None, to_dict=lambda:value,
                                   update_time=self.client.versions.get(self.path, 0))
        def create(self, value, **kwargs):
            if self.path in self.client.rows: raise AlreadyExists('exists')
            self.client.rows[self.path] = deepcopy(value); self.client.versions[self.path] = 1
        def update(self, value, option, **kwargs):
            if option._last_update_time != self.client.versions[self.path]: raise FailedPrecondition('changed')
            self.client.rows[self.path] = deepcopy(value); self.client.versions[self.path] += 1
    cloud = Cloud(); store = FirebaseStore(client=cloud)
    store.create_company(CIRCLE)
    original = deepcopy(cloud.rows['companies/'+CIRCLE.deal_id])
    updated = store.patch_workspace(CIRCLE.deal_id, {'display_name':'New label', 'archived':True})
    assert updated.legal_name == CIRCLE.legal_name and updated.identifiers['workspace_archived'] == 'true'
    assert cloud.rows['companies/'+CIRCLE.deal_id] == original
    assert store.companies()[0].identifiers['workspace_display_name'] == 'New label'
    store.patch_workspace(CIRCLE.deal_id, {'archived':False, 'sector':'Payments'})
    # An upload created before the rename is not rejected or allowed to revert it.
    store.ingest(IngestionResult(company=CIRCLE, snapshots=[], observations=[]))
    assert store.company(CIRCLE.deal_id).identifiers['workspace_display_name'] == 'New label'
    assert store.company(CIRCLE.deal_id).identifiers['workspace_archived'] == 'false'
    assert cloud.rows['companies/'+CIRCLE.deal_id] == original


def test_firestore_draft_updates_use_atomic_preconditions_and_preserve_generated_original():
    record = new_record(CIRCLE.deal_id, 'evidence-version', draft={
        'id':'draft','deal_id':CIRCLE.deal_id,'model':'fixture','sections':[]})
    class Ref:
        current = deepcopy(record)
        update_time = 7
        reject_next = False
        def get(self, **kwargs):
            value = envelope(deepcopy(self.current))
            return SimpleNamespace(exists=True, to_dict=lambda:value, update_time=self.update_time)
        def update(self, value, option, **kwargs):
            assert option._last_update_time == self.update_time
            if self.reject_next:
                from google.api_core.exceptions import FailedPrecondition
                raise FailedPrecondition('Changed by another server')
            self.current = value['record']; self.update_time += 1
    ref = Ref()
    store = FirebaseStore(client=SimpleNamespace())
    store._collection = lambda *args: SimpleNamespace(document=lambda record_id:ref)
    saved = store.update_report_draft(CIRCLE.deal_id, 'draft', 1, editor_workspace())
    assert saved['version'] == 2 and saved['draft'] == record['draft']
    with pytest.raises(DraftVersionConflict):
        store.update_report_draft(CIRCLE.deal_id, 'draft', 1, editor_workspace())
    ref.reject_next = True
    with pytest.raises(DraftVersionConflict):
        store.update_report_draft(CIRCLE.deal_id, 'draft', 2, editor_workspace())


def test_upload_recovery_uses_worker_lease_not_recycled_or_current_pid(tmp_path, monkeypatch):
    monkeypatch.setenv('UPLOAD_CACHE_ROOT', str(tmp_path/'uploads'))
    store, _ = seeded_store()
    jobs = UploadJobs(store)
    try:
        for number, protocol in ((1, None), (2, 1)):
            job = {'id':f'{number:032x}', 'deal_id':CIRCLE.deal_id, 'status':'processing', 'owner_pid':os.getpid()}
            if protocol: job['lease_protocol'] = protocol
            atomic_json(jobs.jobs/f'{job["id"]}.json', job)
        jobs.start()
        assert all(jobs.read(CIRCLE.deal_id, f'{number:032x}')['status'] == 'failed' for number in (1,2))
    finally:
        jobs.close(); store.close()


def test_upload_handoff_preserves_live_jobs_and_shutdown_cancels_queued_receipts(tmp_path, monkeypatch):
    monkeypatch.setenv('UPLOAD_CACHE_ROOT', str(tmp_path/'uploads'))
    store, _ = seeded_store()
    started = Barrier(3); release = Event()
    def slow_processor(*args):
        started.wait(timeout=5)
        assert release.wait(timeout=5)
        return {'observations':0, 'claims':0, 'warnings':[]}
    jobs = UploadJobs(store, slow_processor)
    second = UploadJobs(store, slow_processor)
    try:
        first = jobs.submit(CIRCLE, b'a,b\nRevenue,1\n', 'one.csv', 'text/csv', 'uploaded')
        two = jobs.submit(CIRCLE, b'a,b\nRevenue,2\n', 'two.csv', 'text/csv', 'uploaded')
        started.wait(timeout=5)
        queued = jobs.submit(CIRCLE, b'a,b\nRevenue,3\n', 'three.csv', 'text/csv', 'uploaded')
        second.start()
        assert second.read(CIRCLE.deal_id, first['id'])['status'] == 'processing'
        duplicate = second.submit(CIRCLE, b'a,b\nRevenue,1\n', 'one.csv', 'text/csv', 'uploaded')
        assert duplicate['id'] == first['id']  # No second extraction or model call.
        jobs.close()
        assert jobs.read(CIRCLE.deal_id, queued['id'])['status'] == 'failed'
        assert not jobs.active({'id':queued['id'], 'lease_protocol':1})
        assert second.read(CIRCLE.deal_id, two['id'])['status'] == 'processing'
    finally:
        release.set()
        jobs.executor.shutdown(wait=True)
        second.close(); store.close()
