from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.firebase_store import FirebaseStore, envelope, unpack, identifier
from app.schemas import CIRCLE
from app.stored_narratives import source_claims, draft


def document(record):
    return SimpleNamespace(exists=True, to_dict=lambda:record)


def test_record_integrity_preserves_decimal_strings_and_rejects_content_tampering():
    original={'value':'100.123400000000000006','missing':None,'raw_value':'$25B+'}
    stored=envelope(original)
    assert unpack(document(stored))==original
    bad=deepcopy(stored);bad['record']['value']='100.1234'
    with pytest.raises(ValueError,match='integrity'):unpack(document(bad))
    with pytest.raises(ValueError,match='size'):envelope({'text':'x'*800001})


@pytest.mark.parametrize('value',['../company','a/b','','.', '..'])
def test_record_identifiers_cannot_escape_company_paths(value):
    with pytest.raises(ValueError):identifier(value)


def test_firestore_existing_ids_are_immutable_and_foreign_company_writes_fail():
    original={'id':'one','deal_id':CIRCLE.deal_id,'value':'1.000'}
    class Ref:
        def create(self,*args,**kwargs):
            from google.api_core.exceptions import AlreadyExists
            raise AlreadyExists('already exists')
        def get(self,**kwargs):return document(envelope(original))
    class Collection:
        def document(self,*args):return Ref()
    store=FirebaseStore(client=SimpleNamespace(),cache_seconds=0)
    store.company=lambda deal:CIRCLE if deal==CIRCLE.deal_id else None
    store._collection=lambda *args:Collection()
    store.save_record(CIRCLE.deal_id,'calculations','one',original)
    with pytest.raises(ValueError,match='different content'):
        store.save_record(CIRCLE.deal_id,'calculations','one',{**original,'value':'2'})
    with pytest.raises(ValueError,match='different company'):
        store.save_record(CIRCLE.deal_id,'calculations','one',{**original,'deal_id':'foreign'})


def test_imported_report_quotes_remain_original_and_automated_verified_maps_to_review():
    source=SimpleNamespace(id='pdf',sha256='a'*64,original_filename='company.pdf')
    company=CIRCLE
    report={'id':'saved-report','deal_id':company.deal_id,'entity_key':company.entity_key,
        'created_at':'2026-10-24T00:00:00Z','provenance':{'requested_model':'upstream-model'},
        'sources':[{'id':'quote-one','snapshot_id':'pdf','quote':'The company reports 14 customers.',
                    'locator':{'kind':'pdf_page','page':4},'sha256':'a'*64}],
        'sections':[{'id':'overview','title':'Company overview','config':{},'entries':[
            {'id':'summary-one','text':'Reported customer count is 14.','status':'verified','evidenceIds':['quote-one']},
            {'id':'gap','text':'ARR inputs have not been provided.','status':'missing','evidenceIds':[]}]}]}
    claims=source_claims(company,[report],[source])
    assert claims[0]['evidence'][0]['quote']=='The company reports 14 customers.'
    assert claims[0]['verification_status']=='needs_review'
    eid=f"claim:{claims[0]['id']}:evidence:0"
    current={'report_id':'current-version','narrative_evidence':[{'id':eid,'kind':'statement','title':'Original source quotation','quote_basis':'source_text','text':claims[0]['evidence'][0]['quote'],
        'source':{'snapshot_id':'pdf','file_name':'company.pdf','provider':'uploaded','sha256':'a'*64,'locator':{'page':4}}}]}
    result=draft(report,current)
    assert result['status']=='model_generated_unverified' and result['human_reviewed'] is False
    claim=result['sections'][0]['claims'][0]
    assert claim['review_state']=='verify' and claim['upstream_status']=='verified'
    assert claim['citations'][0]['quote']=='The company reports 14 customers.'
    assert result['sections'][0]['gaps']==['ARR inputs have not been provided.']
    bad=deepcopy(report);bad['sources'][0]['sha256']='b'*64
    with pytest.raises(ValueError,match='invalid source'):source_claims(company,[bad],[source])
