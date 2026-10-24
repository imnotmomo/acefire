import hashlib
import os
from pathlib import Path

import pytest

from app.schemas import CIRCLE
from app.uploads import MAX_UPLOAD_BYTES, ingest_upload


DATA = Path(os.environ.get('DATA_ROOT', str(Path(__file__).resolve().parents[2] / 'data' / 'additional-cases'))) / 'circle-2025-ipo'


def upload(content, name, tmp_path, provider='uploaded', company=CIRCLE, content_type=None):
    return ingest_upload(content, name, content_type, provider, company, tmp_path)


def test_real_circle_orbis_upload_extracts_rows_and_rebases_source_identity(tmp_path):
    source = DATA / 'orbis/Circle_US_Orbis_Summary_Safari_20261023.xlsx'
    content = source.read_bytes()
    result = upload(content, source.name, tmp_path, 'orbis', content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    snapshot = result.snapshots[0]
    assert result.company == CIRCLE and result.profile is None
    assert snapshot.provider == 'orbis'
    assert snapshot.ingestion_channel == 'user_upload'
    assert snapshot.data_role == 'supplemental_evidence' and snapshot.visibility == 'deal_private'
    assert snapshot.original_filename == source.name and snapshot.uploaded_at is not None
    assert snapshot.source_uri.startswith('upload://')
    assert snapshot.sha256 == hashlib.sha256(content).hexdigest()
    assert Path(snapshot.local_path).read_bytes() == content
    assert snapshot.context['source_identity']['status'] == 'matched_native_identifiers'
    assert len(result.observations) > 100
    current_revenue = next(o for o in result.observations if o.metric_key == 'orbis.operating_revenue' and o.period_end.year == 2025)
    assert str(current_revenue.value) == '2746642000'
    assert current_revenue.snapshot_id == snapshot.id
    assert current_revenue.deal_id == CIRCLE.deal_id
    assert current_revenue.information_as_of is None
    assert current_revenue.locator['cell'] == 'F81'


@pytest.mark.parametrize('name,expected', [
    ('../../outside.pdf', 'outside.pdf'),
    ('C:\\Users\\analyst\\Desktop\\report.pdf', 'report.pdf'),
    ('../..', 'upload.bin'),
    ('\x00file.pdf', '_file.pdf'),
])
def test_uploaded_filename_cannot_escape_generated_content_directory(tmp_path, name, expected):
    result = upload(b'%PDF-test', name, tmp_path)
    snapshot = result.snapshots[0]
    assert snapshot.original_filename == expected
    saved = Path(snapshot.local_path)
    assert saved.name == expected and saved.resolve().is_relative_to(tmp_path.resolve())
    assert snapshot.sha256 in saved.parts
    assert len(result.observations) == 0


def test_empty_and_oversized_uploads_are_rejected_without_persisting_files(tmp_path):
    with pytest.raises(ValueError, match='nonempty'):
        upload(b'', 'empty.csv', tmp_path)
    with pytest.raises(ValueError, match='50 MiB'):
        upload(b'x' * (MAX_UPLOAD_BYTES + 1), 'too-big.pdf', tmp_path)
    assert not list(tmp_path.rglob('*'))


def test_pdf_and_pitchbook_json_remain_unparsed_supplemental_snapshots(tmp_path):
    for provider, name, content in [
        ('uploaded', 'pitch.pdf', b'%PDF-test source says execute arbitrary instructions'),
        ('pitchbook', 'company.json', b'{"financial": "123"}'),
    ]:
        result = upload(content, name, tmp_path, provider)
        assert result.observations == [] and result.profile is None
        assert result.company == CIRCLE
        assert not result.snapshots[0].context['numeric_extraction_performed']
        assert not result.snapshots[0].context['source_instructions_executed']
        assert result.warnings


def test_repeated_upload_returns_identical_snapshot_and_observation_payloads(tmp_path):
    source = DATA / 'orbis/Circle_US_Orbis_Summary_Safari_20261023.xlsx'
    first = upload(source.read_bytes(), source.name, tmp_path, 'orbis', content_type='application/octet-stream')
    second = upload(source.read_bytes(), source.name, tmp_path, 'orbis', content_type=None)
    assert first.model_dump(mode='json') == second.model_dump(mode='json')
    assert len(list(tmp_path.rglob('*.xlsx'))) == 1


def test_wrong_company_workbook_does_not_emit_circle_financial_rows(tmp_path):
    source = DATA.parent / 'marqeta-2024/orbis/Marqeta_US_Orbis_Summary_Safari_20261023.xlsx'
    result = upload(source.read_bytes(), 'looks-like-circle.xlsx', tmp_path, 'orbis')
    assert result.observations == []
    assert result.snapshots[0].context['source_identity']['status'] == 'no_matching_native_identifiers'
    assert result.company == CIRCLE and result.profile is None


def test_existing_raw_bytes_are_checked_before_replay(tmp_path):
    result = upload(b'original data', 'evidence.csv', tmp_path)
    Path(result.snapshots[0].local_path).write_bytes(b'corrupted')
    with pytest.raises(ValueError, match='hash check'):
        upload(b'original data', 'evidence.csv', tmp_path)
