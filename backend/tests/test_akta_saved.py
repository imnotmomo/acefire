"""Offline integration tests against the real user-saved Akta envelopes."""
import hashlib
import json
import os
from pathlib import Path

import pytest

from app.akta import AktaError
from app.akta_saved import CIRCLE_AKTA_UUID, ingest_saved_akta_circle


@pytest.fixture
def saved_root():
    root = Path(os.environ.get('AKTA_DATA_ROOT', str(Path(__file__).resolve().parents[2] / 'data' / 'akta')))
    if not list(root.glob('Circle*.json')):
        pytest.skip('Real saved Akta response files are not available; set AKTA_DATA_ROOT.')
    return root


@pytest.fixture
def copied_saved(saved_root, tmp_path):
    for path in saved_root.glob('Circle*.json'):
        (tmp_path / path.name).write_bytes(path.read_bytes())
    return tmp_path


def _edit(root, kind, change):
    path = next(p for p in root.glob('Circle*.json') if ('financial' in p.name) == (kind == 'financial'))
    data = json.loads(path.read_bytes())
    change(data)
    path.write_text(json.dumps(data))


def test_real_saved_responses_bind_primary_profile_and_financial_separately(saved_root):
    result = ingest_saved_akta_circle(saved_root)
    assert result.company.primary_provider == 'akta'
    assert result.company.primary_company_id == CIRCLE_AKTA_UUID == '000004j'
    assert result.company.identifiers['akta'] == CIRCLE_AKTA_UUID
    assert result.profile is None
    assert len(result.snapshots) == len(result.profiles) == 2
    main = next(s for s in result.snapshots if 'firmographic' in s.context['sections'])
    financial = next(s for s in result.snapshots if s.context['sections'] == ['financial_estimate'])
    assert result.profiles[main.id]['firmographic']['legal_name'] == 'Circle Internet Group, Inc.'
    assert result.profiles[main.id]['firmographic']['website'] == 'circle.com'
    assert 'financial_estimate' not in result.profiles[main.id]
    assert 'firmographic' not in result.profiles[financial.id]
    assert 'product_offering' in result.profiles[main.id]


def test_saved_financial_data_contains_only_valuation_range_without_revenue(saved_root):
    result = ingest_saved_akta_circle(saved_root)
    assert len(result.observations) == 1
    observation = result.observations[0]
    assert observation.metric_key == 'akta.valuation_estimate'
    assert json.loads(observation.raw_value) == {'code': 'over_25b', 'label': '$25B+'}
    assert observation.value is None
    assert observation.currency is None
    assert observation.period_end is None
    assert observation.definition_key is None
    assert observation.normalization_status == 'unresolved'
    assert observation.locator == {'kind': 'json_pointer', 'pointer': '/response/data/financial_estimate/valuation_estimate'}
    assert not any('revenue' in x.metric_key or x.metric_key in {'arr', 'runway', 'monthly_net_burn'} for x in result.observations)


def test_snapshots_preserve_original_bytes_timestamp_and_two_source_lanes(saved_root):
    before = {p.name: p.read_bytes() for p in saved_root.glob('Circle*.json')}
    result = ingest_saved_akta_circle(saved_root)
    for snapshot in result.snapshots:
        raw = before[snapshot.original_filename]
        assert snapshot.sha256 == hashlib.sha256(raw).hexdigest()
        assert Path(snapshot.local_path).read_bytes() == raw
        assert snapshot.ingestion_channel == 'provider_api'
        assert snapshot.data_role == 'primary_company_data'
        assert snapshot.visibility == 'deal_private'
        assert snapshot.uploaded_at is None
        assert snapshot.retrieved_at.isoformat() == json.loads(raw)['fetched_at']
        assert snapshot.source_uri.startswith('akta://company/000004j/')
        assert not snapshot.source_uri.startswith('http')
        assert snapshot.context['saved_api_response'] is True
    assert before == {p.name: p.read_bytes() for p in saved_root.glob('Circle*.json')}
    replay = ingest_saved_akta_circle(saved_root)
    assert [s.id for s in result.snapshots] == [s.id for s in replay.snapshots]
    assert [o.id for o in result.observations] == [o.id for o in replay.observations]


@pytest.mark.parametrize('kind', ['main', 'financial'])
def test_wrong_uuid_is_rejected_before_intake(copied_saved, kind):
    _edit(copied_saved, kind, lambda d: d['response']['data'].update(uuid='different-company'))
    with pytest.raises(AktaError, match='UUID'):
        ingest_saved_akta_circle(copied_saved)


@pytest.mark.parametrize('field,value', [('legal_name', 'Circle Internet Financial LLC'), ('website', 'circle.com.evil.test')])
def test_wrong_legal_identity_or_domain_is_rejected(copied_saved, field, value):
    _edit(copied_saved, 'main', lambda d: d['response']['data']['firmographic'].update({field: value}))
    with pytest.raises(AktaError, match='legal name or domain'):
        ingest_saved_akta_circle(copied_saved)


def test_financial_only_file_requires_saved_identity(copied_saved):
    for p in copied_saved.glob('Circle*.json'):
        if 'financial' not in p.name:
            p.unlink()
    with pytest.raises(AktaError, match='firmographic response is required'):
        ingest_saved_akta_circle(copied_saved)


def test_corrupt_json_is_rejected_without_writes(copied_saved):
    target = next(copied_saved.glob('Circle*.json'))
    target.write_bytes(b'{invalid')
    before = {p.name: p.read_bytes() for p in copied_saved.iterdir()}
    with pytest.raises(AktaError, match='not valid JSON'):
        ingest_saved_akta_circle(copied_saved)
    assert before == {p.name: p.read_bytes() for p in copied_saved.iterdir()}


def test_timezone_missing_from_saved_fetch_timestamp_is_rejected(copied_saved):
    _edit(copied_saved, 'financial', lambda d: d.update(fetched_at='2026-10-24T15:10:44'))
    with pytest.raises(AktaError, match='timezone'):
        ingest_saved_akta_circle(copied_saved)
