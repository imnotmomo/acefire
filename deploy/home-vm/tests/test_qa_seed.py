"""Offline QA copies preserve evidence while isolating files and database writes."""
from copy import deepcopy
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'backend'))
spec = importlib.util.spec_from_file_location('qa_seed', Path(__file__).resolve().parents[1] / 'seed_qa.py')
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)
from app.schemas import Company, SourceSnapshot, Observation, Calculation
from app.store import Store


def typed(value):
    if value is None:
        return {'nullValue': None}
    if isinstance(value, dict):
        return {'mapValue': {'fields': {k: typed(v) for k, v in value.items()}}}
    if isinstance(value, list):
        return {'arrayValue': {'values': [typed(v) for v in value]}}
    if isinstance(value, bool):
        return {'booleanValue': value}
    if isinstance(value, int):
        return {'integerValue': str(value)}
    return {'stringValue': value}


class QaSeedTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = (self.root / 'qa').resolve()
        self.original = self.root / 'original.txt'
        self.original.write_text('Synthetic QA fixture reports revenue of 12.001 USD.\n')
        digest = sha256(self.original.read_bytes()).hexdigest()
        self.company = Company(deal_id='synthetic-qa', entity_key='synthetic-entity',
            legal_name='Synthetic QA', domain='example.invalid', country='USA')
        self.source = SourceSnapshot(id='source-1',deal_id=self.company.deal_id,entity_key=self.company.entity_key,
            provider='akta',ingestion_channel='provider_api',data_role='primary_company_data',
            original_filename='original.txt',source_kind='saved_provider_json_response',
            source_uri='akta://synthetic-fixture',sha256=digest,context={'record_type':'enrichment'})
        self.observation = Observation(id='observation-1',deal_id=self.company.deal_id,entity_key=self.company.entity_key,
            snapshot_id=self.source.id,provider='akta',metric_key='revenue',raw_label='revenue',raw_value='12.001',
            value='12.001',unit='USD',normalization_status='confirmed',locator={'kind':'text_lines','line_start':1,'line_end':1})
        self.calculation = Calculation(id='calculation-1',deal_id=self.company.deal_id,metric_key='revenue',
            function_key='synthetic',formula='source value',status='succeeded',value='12.001',unit='USD',
            input_ids=[self.observation.id],input_snapshots=[self.source.id])
        self.claim = {'id':'claim-1','deal_id':self.company.deal_id,'entity_key':self.company.entity_key,
            'snapshot_id':self.source.id,'claim_type':'financial','statement':'Synthetic source report.',
            'evidence':[{'snapshot_id':self.source.id,'quote':self.original.read_text().strip(),
                         'locator':{'kind':'text_lines','line_start':1,'line_end':1}}],
            'model':'synthetic-fixture','extractor_version':'synthetic-v1','verification_status':'needs_review'}
        self.report = {'id':'report-1','deal_id':self.company.deal_id,'entity_key':self.company.entity_key,
            'created_at':'2026-10-25T12:00:00+00:00','sections':[{'id':'summary','entries':[]}],
            'sources':[{'id':'quote-1','snapshot_id':self.source.id,'sha256':digest,
                        'quote':self.original.read_text().strip(),'locator':{'kind':'text_lines','line_start':1,'line_end':1}}]}
        self.rows = []
        for collection,record in [
            ('companies',self.company.model_dump(mode='json')),
            ('source_snapshots',self.source.model_dump(mode='json')),
            ('source_observations',self.observation.model_dump(mode='json')),
            ('company_profiles',{'snapshot_id':self.source.id,'provider':'akta','profile':{'name':'Synthetic QA'}}),
            ('calculations',self.calculation.model_dump(mode='json')),
            ('document_claims',self.claim),('narrative_reports',self.report),
        ]:
            key = record['deal_id'] if collection == 'companies' else record.get('id',record.get('snapshot_id'))
            path = 'companies/'+self.company.deal_id + ('' if collection == 'companies' else '/'+collection+'/'+key)
            envelope={'schema_version':1,'record':record,'record_sha256':sha256(seed.canonical(record)).hexdigest()}
            fields=typed(envelope)['mapValue']['fields']
            self.rows.append({'path':path,'fields_sha256':sha256(seed.canonical(fields)).hexdigest(),
                              'document':{'fields':fields}})
        self.snapshot = self.root / 'documents.jsonl'
        self.manifest = self.root / 'source-files.json'
        self.write_snapshot()
        self.manifest.write_text(json.dumps({self.source.id:{'path':str(self.original),'sha256':digest}}))

    def write_snapshot(self):
        self.snapshot.write_text(''.join(json.dumps(row)+'\n' for row in self.rows))

    def run_seed(self):
        return seed.seed_qa(self.snapshot,self.manifest,self.output)

    def test_preserves_records_exact_decimal_quotes_and_isolates_original_bytes(self):
        result=self.run_seed()
        self.assertEqual(result['copied_originals'],1)
        self.assertEqual(result['missing_originals'],[])
        self.assertEqual(result['records']['narrative_reports'],1)
        with Store(self.output/'acefire.duckdb') as store:
            self.assertEqual(store.company(self.company.deal_id),self.company)
            self.assertEqual(str(store.observation(self.observation.id).value),'12.001')
            self.assertEqual(store.calculation(self.calculation.id),self.calculation)
            self.assertEqual(store.narrative_reports(self.company.deal_id),[self.report])
            self.assertEqual(store.document_claims(self.company.deal_id)[0]['evidence'],self.claim['evidence'])
            self.assertEqual(store.profiles(self.company.deal_id)[0]['profile'],{'name':'Synthetic QA'})
            copied=Path(store.snapshot(self.source.id).local_path)
        self.assertTrue(copied.is_relative_to(self.output/'sources'))
        self.assertEqual(copied.read_bytes(),self.original.read_bytes())
        self.assertNotEqual(copied.stat().st_ino,self.original.stat().st_ino)
        copied.write_text('Changed only in QA.')
        self.assertIn('12.001',self.original.read_text())
        self.assertEqual((self.output/'acefire.duckdb').stat().st_mode & 0o777,0o600)
        self.assertFalse((self.output/'.seed.lock').exists())

    def test_repeated_seed_never_replaces_database_or_qa_edits(self):
        self.run_seed()
        database=self.output/'acefire.duckdb'
        before=database.read_bytes()
        with self.assertRaisesRegex(ValueError,'already exists'):
            self.run_seed()
        self.assertEqual(database.read_bytes(),before)

    def test_typed_field_corruption_is_rejected_before_creating_qa(self):
        self.rows[0]['fields_sha256']='0'*64
        self.write_snapshot()
        with self.assertRaisesRegex(ValueError,'typed fields'):
            self.run_seed()
        self.assertFalse(self.output.exists())

    def test_record_envelope_corruption_is_rejected_even_with_valid_fields_hash(self):
        fields=self.rows[0]['document']['fields']
        fields['record_sha256']={'stringValue':'0'*64}
        self.rows[0]['fields_sha256']=sha256(seed.canonical(fields)).hexdigest()
        self.write_snapshot()
        with self.assertRaisesRegex(ValueError,'Snapshot record'):
            self.run_seed()
        self.assertFalse(self.output.exists())

    def test_source_hash_mismatch_leaves_no_published_database_or_files(self):
        self.original.write_text('Different source bytes.')
        with self.assertRaisesRegex(ValueError,'Original source'):
            self.run_seed()
        self.assertFalse((self.output/'acefire.duckdb').exists())
        self.assertFalse((self.output/'sources').exists())
        self.assertFalse((self.output/'.seed.lock').exists())

    def test_unavailable_original_remains_missing_without_inventing_a_location(self):
        self.original.unlink()
        result=self.run_seed()
        self.assertEqual(result['copied_originals'],0)
        self.assertEqual(result['missing_originals'],[self.source.id])
        with Store(self.output/'acefire.duckdb') as store:
            self.assertIsNone(store.snapshot(self.source.id).local_path)
            self.assertEqual(store.document_claims(self.company.deal_id)[0]['evidence'],self.claim['evidence'])

    def test_duplicate_paths_and_foreign_bindings_are_rejected(self):
        self.rows.append(deepcopy(self.rows[0]))
        self.write_snapshot()
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            self.run_seed()
        self.rows.pop()
        self.rows[0]['path']='companies/different-company'
        self.write_snapshot()
        with self.assertRaisesRegex(ValueError,'company binding'):
            self.run_seed()

    def test_production_output_path_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'production path'):
            seed.seed_qa(self.snapshot,self.manifest,'/var/lib/ingenium/qa')


if __name__ == '__main__':
    unittest.main()
