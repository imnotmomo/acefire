from decimal import Decimal
from hashlib import sha256
import json

from fastapi.testclient import TestClient
import pytest

from app.agent_calculation import AgentCalculationError
from app.main import create_app
from app.schemas import CIRCLE, Calculation, IngestionResult, Observation, SourceSnapshot
from app.store import Store


@pytest.fixture
def agent_workspace(tmp_path):
    path = tmp_path / 'source.csv'
    path.write_text('component,value\na,100.123400\nb,0.000006\n')
    source = SourceSnapshot(id='source-agent-api', deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        provider='uploaded', source_kind='csv', source_uri='upload://agent-api/source.csv',
        original_filename=path.name, local_path=str(path), sha256=sha256(path.read_bytes()).hexdigest())
    rows = [Observation(id=f'agent-input-{index}', deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        snapshot_id=source.id, provider='uploaded', metric_key=f'uploaded.component_{index}',
        raw_label=f'Component {index}', raw_value=value, value=Decimal(value), unit='USD', currency='USD',
        scale_multiplier=Decimal('1'), normalization_status='confirmed', normalization_basis='source unit',
        period_kind='unknown', locator={'kind': 'csv_row', 'row': index + 1, 'column': 'value'})
        for index, value in [(1, '100.123400'), (2, '0.000006')]]
    store = Store(str(tmp_path / 'agent.duckdb'))
    store.initialize()
    store.ingest(IngestionResult(company=CIRCLE, snapshots=[source], observations=rows))
    calls = []
    class FakeAgent:
        def calculate(self, deal_id, request, observations, snapshots, text_evidence=None):
            calls.append(request)
            return Calculation(id='generated-agent-api', deal_id=deal_id, metric_key='agent.components_sum',
                function_key='llm_local_python', function_version='b' * 64,
                status='succeeded', value=Decimal('100.123406'), unit='USD',
                formula='selected source component a + selected source component b',
                input_ids=request.input_ids, input_snapshots=[source.id], parameters={'agent_execution': {
                    'mode': 'llm_local', 'generation_provider': 'nicrron', 'model': 'openai/gpt-6.1-sol',
                    'code': 'def calculate(inputs, parameters): pass', 'code_sha256': 'b' * 64,
                    'verification': 'model_generated_unverified', 'input_lineage_basis': 'all_supplied_inputs',
                    'declared_input_ids': request.input_ids, 'stdout': '{"value":"100.123406"}',
                    'stderr': '', 'exit_code': 0, 'cleanup_succeeded': True}})
    yield store, source, rows, calls, FakeAgent
    store.close()


def test_agent_result_roundtrips_into_the_existing_report_and_source_graph(agent_workspace):
    store, source, rows, calls, factory = agent_workspace
    with TestClient(create_app(store=store, agent_factory=factory)) as client:
        result = client.post(f'/deals/{CIRCLE.deal_id}/calculate/agent', json={
            'question': 'Add these source components.', 'input_ids': [row.id for row in rows]})
        assert result.status_code == 200, result.text
        assert result.json()['value'] == '100.123406'
        assert result.json()['conflict_numbers'] is False
        assert len(calls) == 1
        report = client.get(f'/deals/{CIRCLE.deal_id}/report').json()
        entry = next(item for item in report['calculations'] if item['calculation']['id'] == result.json()['id'])
        assert entry['verification'] == 'model_generated_unverified'
        assert entry['input_lineage_basis'] == 'all_supplied_inputs'
        assert entry['execution']['code_sha256'] == 'b' * 64
        assert {item['observation']['id'] for item in entry['inputs']} == {row.id for row in rows}
        assert {item['source']['sha256'] for item in entry['inputs']} == {source.sha256}
        assert {item['source']['locator']['row'] for item in entry['inputs']} == {2, 3}
        assert any(step['kind'] == 'generated_formula' for step in entry['explanation_steps'])
        assert not any(step['kind'] == 'reviewed_formula' for step in entry['explanation_steps'])
        assert client.get(f"/calculations/{result.json()['id']}/lineage").json()['execution'] == entry['execution']


def test_agent_request_validation_and_company_isolation_run_before_the_model(agent_workspace):
    store, _, rows, calls, factory = agent_workspace
    with TestClient(create_app(store=store, agent_factory=factory)) as client:
        route = f'/deals/{CIRCLE.deal_id}/calculate/agent'
        for request in [
            {'question': ' ', 'input_ids': [rows[0].id]},
            {'question': 'Add', 'input_ids': []},
            {'question': 'Add', 'input_ids': [rows[0].id, rows[0].id]},
            {'question': 'Add', 'input_ids': [rows[0].id], 'parameters': {'rate': 0.1}},
        ]:
            assert client.post(route, json=request).status_code == 422
        assert client.post('/deals/another-company/calculate/agent', json={'question': 'Add', 'input_ids': [rows[0].id]}).status_code == 404
        assert calls == []


def test_agent_provider_errors_are_explicit_without_a_fixed_formula_fallback(agent_workspace):
    store, _, rows, _, _ = agent_workspace
    class Unconfigured:
        def calculate(self, *args, **kwargs):
            raise AgentCalculationError(503, 'model_not_configured', 'Model configuration is missing.')
    with TestClient(create_app(store=store, agent_factory=Unconfigured)) as client:
        response = client.post(f'/deals/{CIRCLE.deal_id}/calculate/agent', json={'question': 'Add', 'input_ids': [rows[0].id]})
        assert response.status_code == 503
        assert response.json()['detail']['code'] == 'model_not_configured'
        assert store.calculations(CIRCLE.deal_id) == []


def test_source_sentence_premise_remains_bound_to_its_original_file_and_graph(agent_workspace, tmp_path):
    store, numeric_source, rows, _, factory = agent_workspace
    sentence = 'The company reports transaction fees as one source of revenue.'
    profile = {'firmographic': {'company_description_short': sentence}}
    path = tmp_path / 'company.json'
    path.write_text(json.dumps({'response': {'data': profile}}))
    source = SourceSnapshot(id='primary-text-source', deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
        provider='akta', source_kind='provider_json', source_uri='saved://company.json',
        original_filename=path.name, local_path=str(path), sha256=sha256(path.read_bytes()).hexdigest(),
        ingestion_channel='provider_api', data_role='primary_company_data',
        context={'record_type': 'enrichment', 'json_pointer_base': '/response/data'})
    store.ingest(IngestionResult(company=CIRCLE, snapshots=[source], observations=[], profiles={source.id: profile}))
    class TextAgent:
        def calculate(self, deal_id, request, observations, snapshots, text_evidence=None):
            supplied = next(item for item in text_evidence if item['id'] == request.premise_ids[0])
            result = factory().calculate(deal_id, request, observations, snapshots)
            metadata = {**result.parameters['agent_execution'], 'supplied_text_evidence': [supplied],
                'premises': [{'evidence_id': supplied['id'], 'quote': sentence,
                    'role': 'premise', 'reason': 'Business context only, not an accounting-scope proof.', 'source': supplied['source']}]}
            return result.model_copy(update={'input_snapshots': [numeric_source.id, source.id], 'parameters': {'agent_execution': metadata}})
    with TestClient(create_app(store=store, agent_factory=TextAgent)) as client:
        evidence = client.get(f'/deals/{CIRCLE.deal_id}/text-evidence').json()['evidence']
        selected = next(item for item in evidence if item['text'] == sentence)
        assert selected['source']['locator']['pointer'] == '/response/data/firmographic/company_description_short'
        response = client.post(f'/deals/{CIRCLE.deal_id}/calculate/agent', json={
            'question': 'Add the components and cite the business context.',
            'input_ids': [row.id for row in rows], 'premise_ids': [selected['id']]})
        assert response.status_code == 200, response.text
        graph = client.get(f"/calculations/{response.json()['id']}/lineage").json()
        text_node = next(node for node in graph['nodes'] if node['data']['kind'] == 'text_evidence')
        assert text_node['data']['text'] == sentence
        assert text_node['data']['source']['sha256'] == sha256(path.read_bytes()).hexdigest()
        assert text_node['data']['source']['locator'] == selected['source']['locator']
        assert any(edge['source'] == f'file:{source.id}' and edge['target'] == text_node['id'] for edge in graph['edges'])
        assert any(edge['source'] == text_node['id'] and edge['target'] == f"calculation:{response.json()['id']}" for edge in graph['edges'])
        report = client.get(f'/deals/{CIRCLE.deal_id}/report').json()
        assert any(node['id'] == selected['id'] for node in report['source_graph']['nodes'])
        assert any(edge['source'] == selected['id'] and edge['target'] == response.json()['id'] for edge in report['source_graph']['edges'])
