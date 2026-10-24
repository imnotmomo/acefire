import json
from pathlib import Path

import httpx
import pytest

from app.akta import AktaClient, AktaError, ingest_akta_circle


# Synthetic protocol fixture only; none of these profile values were fetched live.
PROFILE = {'data': {'uuid': 'fixture-circle', 'firmographic': {'name': 'Circle', 'legal_name': 'Circle Internet Group, Inc.', 'website': 'https://www.circle.com'}, 'financial_estimate': {'revenue_estimate': {'code': '1b_5b', 'label': '$1B-$5B'}}}, 'credits_consumed': 2.5}


def transport(profile=None, websites=None):
    def handle(request):
        assert request.headers['x-api-key'] == 'synthetic-test-key'
        assert request.url.host == 'api.akta.pro'
        if request.url.path.endswith('/search'):
            return httpx.Response(200, json={'data': [{'uuid': 'fixture-circle', 'name': 'Circle', 'website': w} for w in (websites or ['circle.com'])], 'count': 1})
        assert request.url.params['sections'] == 'firmographic,financial_estimate'
        return httpx.Response(200, json=profile or PROFILE)
    return httpx.MockTransport(handle)


def test_estimate_is_not_an_exact_historical_number(tmp_path):
    client = AktaClient('synthetic-test-key', transport=transport())
    result = ingest_akta_circle(client, tmp_path)
    assert result.company.identifiers['akta'] == 'fixture-circle'
    assert len(result.snapshots) == 2
    observation = result.observations[0]
    assert observation.value is None
    assert observation.period_end is None
    assert observation.definition_key is None
    assert observation.normalization_status == 'unresolved'
    assert '$1B-$5B' in observation.raw_value
    assert observation.locator['pointer'] == '/data/financial_estimate/revenue_estimate'
    for source in result.snapshots:
        payload = Path(source.local_path).read_text()
        assert 'synthetic-test-key' not in payload
        json.loads(payload)
    client.close()


@pytest.mark.parametrize('websites', [['circle.com.evil.test'], ['circle.com', 'circle.com'], [None]])
def test_domain_or_ambiguous_match_is_never_merged(tmp_path, websites):
    client = AktaClient('synthetic-test-key', transport=transport(websites=websites))
    with pytest.raises(AktaError, match='identity is unresolved'):
        ingest_akta_circle(client, tmp_path)
    assert not list(tmp_path.rglob('*.json'))
    client.close()


def test_wrong_legal_entity_is_not_merged(tmp_path):
    wrong = json.loads(json.dumps(PROFILE))
    wrong['data']['firmographic']['legal_name'] = 'Circle Internet Financial LLC'
    client = AktaClient('synthetic-test-key', transport=transport(wrong))
    with pytest.raises(AktaError, match='legal name'):
        ingest_akta_circle(client, tmp_path)
    client.close()


@pytest.mark.parametrize('status', [302, 403, 429])
def test_denied_or_redirected_request_is_not_retried_or_leaked(status):
    calls = []
    def denied(request):
        calls.append(request)
        return httpx.Response(status, text='provider error containing synthetic-test-key', headers={'location': 'https://elsewhere.test'})
    client = AktaClient('synthetic-test-key', transport=httpx.MockTransport(denied))
    with pytest.raises(AktaError) as error:
        client.search('circle.com')
    assert 'synthetic-test-key' not in str(error.value)
    assert len(calls) == 1
    client.close()


def test_credential_cannot_be_sent_to_custom_host(monkeypatch):
    monkeypatch.setenv('AKTA_API_URL', 'https://other.test')
    with pytest.raises(AktaError, match='documented HTTPS'):
        AktaClient('synthetic-test-key')
