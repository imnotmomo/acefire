from hashlib import sha256
from zipfile import ZipFile

from fastapi.testclient import TestClient
import pytest

from app.main import create_app
from app.schemas import CIRCLE, SourceSnapshot, IngestionResult
from app.source_preview import cell_position, workbook_preview
from app.store import Store


def workbook(path):
    with ZipFile(path,'w') as z:
        z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Assets" r:id="r1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="49"><c r="A49" t="inlineStr"><is><t>Non-current assets (th USD)</t></is></c><c r="I49"><f>SUM(I50:I51)</f><v>669460</v></c></row></sheetData></worksheet>')
    return path


def test_workbook_preview_keeps_original_values_formula_and_precise_cell(tmp_path):
    path=workbook(tmp_path/'source.xlsx')
    result=workbook_preview(path,sheet='Assets',cell='I49')
    selected=[cell for row in result['rows'] for cell in row['cells'] if cell['selected']]
    assert len(selected)==1 and selected[0]['address']=='I49'
    assert selected[0]['value']=='669460' and selected[0]['formula']=='SUM(I50:I51)'
    assert result['formula_evaluation'] is False
    assert any(c['value']=='Non-current assets (th USD)' for r in result['rows'] for c in r['cells'])
    with pytest.raises(ValueError,match='not present'):workbook_preview(path,sheet='Missing')


@pytest.mark.parametrize('address',['A0','XFE1','A1048577','../I49','I49;execute','', '1A'])
def test_cell_addresses_are_bounded_without_executable_content(address):
    with pytest.raises(ValueError):cell_position(address)


def test_preview_api_checks_registered_file_hash_before_exposing_cells(tmp_path):
    path=workbook(tmp_path/'source.xlsx');digest=sha256(path.read_bytes()).hexdigest()
    snapshot=SourceSnapshot(id='workbook',deal_id=CIRCLE.deal_id,entity_key=CIRCLE.entity_key,provider='uploaded',source_kind='xlsx',source_uri='upload://source.xlsx',original_filename='source.xlsx',sha256=digest,local_path=str(path))
    store=Store(str(tmp_path/'test.duckdb'));store.initialize();store.ingest(IngestionResult(company=CIRCLE,snapshots=[snapshot],observations=[]))
    with TestClient(create_app(store=store)) as client:
        result=client.get('/sources/workbook/preview',params={'sheet':'Assets','cell':'I49'})
        assert result.status_code==200 and result.json()['sha256']==digest
        assert store.observations(CIRCLE.deal_id)==[]
        path.write_bytes(b'changed source')
        assert client.get('/sources/workbook/preview').status_code==409
