from datetime import date
from decimal import Decimal
import hashlib
import json
from types import SimpleNamespace

import httpx
import pytest
from pydantic import ValidationError

from app.agent_calculation import AgentCalculator, AgentCalculationError, AgentCalculationRequest, validate_generated_code
from app.schemas import Observation, SourceSnapshot


CODE = """from decimal import Decimal
def calculate(inputs, parameters):
    first = inputs[0]['observation']
    second = inputs[1]['observation']
    value = Decimal(first['value']) + Decimal(second['value'])
    return {'status': 'succeeded', 'value': str(value), 'unit': 'USD', 'formula': 'first source component + second source component', 'input_ids': [first['id'], second['id']], 'metric_key': 'source_components_sum', 'assumptions': [], 'limitations': ['Source arithmetic only.'], 'explanation': 'Adds the two supplied exact normalized source components.'}
"""


def settings(key='test-private-credential'):
    return SimpleNamespace(model_key=key, nicrron_base_url='https://api.nicrron.ai/v1', model='openai/gpt-6.1-sol')


@pytest.fixture
def records():
    source = SourceSnapshot(id='source-1', deal_id='circle', entity_key='entity', provider='uploaded',
                            source_kind='xlsx', source_uri='upload://source-1/financial.xlsx',
                            original_filename='financial.xlsx', sha256='a' * 64, local_path='/secret/local/path.xlsx')
    rows = [Observation(id=f'input-{index}', deal_id='circle', entity_key='entity', snapshot_id=source.id,
                        provider='uploaded', metric_key=f'uploaded.component_{index}', raw_label=f'Component {index}',
                        raw_value=token, value=Decimal(token), unit='USD', currency='USD',
                        scale_multiplier=Decimal('1'), normalization_status='confirmed', normalization_basis='source unit',
                        scope='consolidated', period_kind='instant', period_label='FY 2024', period_end=date(2024, 12, 31),
                        locator={'kind': 'xlsx_cell', 'sheet': 'Assets', 'cell': cell})
            for index, token, cell in [(1, '9007199254740993.123400', 'A1'), (2, '0.000006', 'A2')]]
    return rows, [source]


def result(**patch):
    value = {'status': 'succeeded', 'value': '9007199254740993.123406', 'unit': 'USD',
             'formula': 'first source component + second source component', 'input_ids': ['input-1', 'input-2'],
             'metric_key': 'source_components_sum', 'assumptions': [], 'limitations': ['Source arithmetic only.'],
             'explanation': 'Adds the two supplied exact normalized source components.'}
    return {**value, **patch}


class Runner:
    def __init__(self, output=None, **execution_patch):
        self.calls = []
        self.execution = SimpleNamespace(stdout=json.dumps(output or result()), stderr='', exit_code=0,
                                         execution_id='5e5b09bf-d791-4da0-bbe3-b6c5abcb839a', cleanup_succeeded=True,
                                         executed_at='2026-10-24T12:00:00+00:00', **execution_patch)

    def execute(self, code, inputs, parameters):
        self.calls.append((code, inputs, parameters))
        return self.execution


def client_for(code=CODE, handler=None):
    def respond(request):
        if handler:
            return handler(request)
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps({'code': code})}}]})
    return httpx.Client(transport=httpx.MockTransport(respond))


def request(ids=None, **patch):
    return AgentCalculationRequest(question='Add the two source components, explaining their limits.', input_ids=ids or ['input-1', 'input-2'], **patch)


def test_model_code_and_execution_proof_keep_exact_source_values_and_all_supplied_lineage(records):
    rows, sources = records
    runner = Runner()
    seen = []
    def handler(http_request):
        body = json.loads(http_request.content)
        seen.append(body)
        assert http_request.url == 'https://api.nicrron.ai/v1/chat/completions'
        assert body['model'] == 'openai/gpt-6.1-sol'
        assert '/secret/local/path.xlsx' not in json.dumps(body)
        assert 'test-private-credential' not in json.dumps(body)
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps({'code': CODE})}}]})
    with client_for(handler=handler) as model:
        calculation = AgentCalculator(settings(), model, runner).calculate('circle', request(), rows, sources)
    assert calculation.value == Decimal('9007199254740993.123406')
    assert calculation.model_dump(mode='json')['value'] == '9007199254740993.123406'
    assert calculation.metric_key == 'agent.source_components_sum'
    assert calculation.function_key == 'llm_local_python'
    assert calculation.input_ids == ['input-1', 'input-2']
    assert calculation.input_snapshots == ['source-1']
    proof = calculation.parameters['agent_execution']
    assert proof['code'] == CODE and proof['code_sha256'] == hashlib.sha256(CODE.encode()).hexdigest()
    assert proof['input_manifest']['inputs'][0]['observation']['value'] == '9007199254740993.123400'
    assert proof['input_manifest']['inputs'][0]['source']['locator']['cell'] == 'A1'
    assert proof['input_manifest']['inputs'][0]['source']['sha256'] == 'a' * 64
    assert proof['declared_input_ids'] == calculation.input_ids
    assert proof['input_lineage_basis'] == 'all_supplied_inputs'
    assert proof['verification'] == 'model_generated_unverified'
    assert any('definitions are unreviewed' in item for item in proof['limitations'])
    assert any('scenarios are unknown' in item for item in proof['limitations'])
    assert proof['stdout'] == runner.execution.stdout
    assert len(runner.calls) == 1 and len(seen) == 1


@pytest.mark.parametrize('code', [
    'import os\ndef calculate(inputs, parameters): return os.environ',
    'from calendar import sys\ndef calculate(inputs, parameters): return sys.modules',
    'def calculate(inputs, parameters): return eval("1+1")',
    'def calculate(inputs, parameters): return inputs[0].__class__',
    'def calculate(inputs, parameters): return float("1.2")',
    'def calculate(inputs, parameters): return 1.2',
    'def calculate(inputs, parameters): return open("/etc/passwd").read()',
    'print("not in child")\ndef calculate(inputs, parameters): return {}',
    'def calculate(inputs, parameters={}): return {}',
    '@some_function()\ndef calculate(inputs, parameters): return {}',
])
def test_unsupported_generated_code_never_reaches_the_runner(records, code):
    rows, sources = records
    runner = Runner()
    with client_for(code) as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, runner).calculate('circle', request(), rows, sources)
    assert caught.value.status_code == 502 and not runner.calls


@pytest.mark.parametrize('patch,code', [
    ({'value': 12.3}, 'invalid_execution_value'),
    ({'value': 'NaN'}, 'invalid_execution_value'),
    ({'value': '1e99999'}, 'invalid_execution_value'),
    ({'input_ids': ['invented']}, 'invalid_execution_provenance'),
    ({'status': 'insufficient_data', 'value': '1'}, 'invalid_execution_value'),
    ({'input_ids': []}, 'invalid_execution_value'),
    ({'unit': None}, 'invalid_execution_value'),
])
def test_execution_result_contract_refuses_invented_provenance_and_lossy_financial_values(records, patch, code):
    rows, sources = records
    with client_for() as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, Runner(result(**patch))).calculate('circle', request(), rows, sources)
    assert caught.value.code == code


def test_missing_or_unconfirmed_inputs_can_be_present_but_success_may_not_declare_using_them(records):
    rows, sources = records
    missing = rows[0].model_copy(update={'id': 'missing', 'value': None, 'normalization_status': 'missing'})
    supplied = [*rows, missing]
    with client_for() as model:
        calculation = AgentCalculator(settings(), model, Runner()).calculate('circle', request(['input-1', 'input-2', 'missing']), supplied, sources)
    assert calculation.input_ids == ['input-1', 'input-2', 'missing']
    assert calculation.parameters['agent_execution']['declared_input_ids'] == ['input-1', 'input-2']
    with client_for() as model, pytest.raises(AgentCalculationError, match='missing, unconfirmed'):
        AgentCalculator(settings(), model, Runner(result(input_ids=['missing']))).calculate('circle', request(['missing']), supplied, sources)


def test_incomplete_analysis_returns_null_with_explanation_and_sources(records):
    rows, sources = records
    output = result(status='insufficient_data', value=None, limitations=['No recurring revenue definition was supplied.'])
    with client_for() as model:
        calculation = AgentCalculator(settings(), model, Runner(output)).calculate('circle', request(), rows, sources)
    assert calculation.value is None and calculation.status == 'insufficient_data'
    assert calculation.input_ids == ['input-1', 'input-2']
    assert 'No recurring revenue definition was supplied.' in calculation.reasons


def test_request_and_source_ownership_are_validated_before_any_model_call(records):
    rows, sources = records
    with pytest.raises(ValidationError): request(['input-1', 'input-1'])
    with pytest.raises(ValidationError): request(parameters={'money': 1.1})
    with pytest.raises(ValidationError): AgentCalculationRequest(question='  ', input_ids=['input-1'])
    def unexpected(_): raise AssertionError('Must not call the model')
    with client_for(handler=unexpected) as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, Runner()).calculate('another-deal', request(), rows, sources)
    assert caught.value.status_code == 422


def test_provider_errors_and_malformed_responses_do_not_echo_secrets(records):
    rows, sources = records
    def denied(_): return httpx.Response(401, text='test-private-credential: invalid')
    with client_for(handler=denied) as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, Runner()).calculate('circle', request(), rows, sources)
    assert caught.value.status_code == 502 and 'test-private-credential' not in str(caught.value)
    def malformed(_): return httpx.Response(200, json={'choices': [{'message': {'content': '{"value":"15"}'}}]})
    with client_for(handler=malformed) as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, Runner()).calculate('circle', request(), rows, sources)
    assert caught.value.code == 'invalid_model_response'
    with client_for() as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(''), model, Runner()).calculate('circle', request(), rows, sources)
    assert caught.value.status_code == 503


def test_nonzero_exit_and_timeout_do_not_become_calculation_results(records):
    rows, sources = records
    runner = Runner(); runner.execution.exit_code = 1; runner.execution.stderr = 'private local traceback'
    with client_for() as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, runner).calculate('circle', request(), rows, sources)
    assert caught.value.code == 'execution_failed' and 'traceback' not in str(caught.value)
    class TimeoutRunner:
        def execute(self, *_): raise TimeoutError('private process details')
    with client_for() as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, TimeoutRunner()).calculate('circle', request(), rows, sources)
    assert caught.value.status_code == 504 and 'private' not in str(caught.value)


def test_valid_generated_function_can_be_executed_by_the_real_restricted_local_runner(records):
    from app.agent_runtime import AgentSettings, LocalCodeRunner
    rows, sources = records
    config = AgentSettings(model_key='test-private-credential')
    with client_for() as model:
        calculation = AgentCalculator(config, model, LocalCodeRunner(config)).calculate('circle', request(), rows, sources)
    assert calculation.value == Decimal('9007199254740993.123406')
    assert calculation.parameters['agent_execution']['execution_provider'] == 'local_python'
    assert calculation.parameters['agent_execution']['cleanup_succeeded'] is True


def text_record(source):
    return {'id': f'field:{source.id}:/firmographic/company_description_short',
            'text': 'The company provides payment services. The assets include customer reserves.',
            'source': {'snapshot_id': source.id, 'file_name': source.original_filename,
                       'provider': source.provider, 'sha256': source.sha256,
                       'locator': {'kind': 'json_pointer', 'pointer': '/firmographic/company_description_short'},
                       'location': {'pointer': '/firmographic/company_description_short'},
                       'preview_url': f'/sources/{source.id}/file', 'local_path': '/do/not/include'}}


def test_sentences_used_as_premises_keep_verbatim_quotes_original_locations_and_hashes(records):
    rows, sources = records
    sentence_source = sources[0].model_copy(update={'id': 'profile-source', 'original_filename': 'profile.json',
                                                  'source_kind': 'json', 'sha256': 'b' * 64})
    sentence = text_record(sentence_source)
    claim = {'evidence_id': sentence['id'], 'quote': 'The assets include customer reserves.',
             'role': 'premise', 'reason': 'Explains why a total-assets sum must not be described as unrestricted company cash.'}
    runner = Runner(result(premises=[claim]))
    with client_for() as model:
        calculation = AgentCalculator(settings(), model, runner).calculate(
            'circle', request(premise_ids=[sentence['id']]), rows, [*sources, sentence_source], text_evidence=[sentence])
    proof = calculation.parameters['agent_execution']
    quote = proof['premises'][0]
    assert quote['quote'] == 'The assets include customer reserves.'
    assert quote['source']['sha256'] == 'b' * 64
    assert quote['source']['locator']['pointer'] == '/firmographic/company_description_short'
    assert 'local_path' not in quote['source']
    assert proof['text_lineage_basis'] == 'supplied_text_evidence_and_declared_quotes'
    assert proof['supplied_text_evidence'][0]['text'] == sentence['text']
    assert proof['input_manifest']['inputs'][-1]['text_evidence']['id'] == sentence['id']
    assert runner.calls[0][1][-1]['text_evidence']['text'] == sentence['text']
    assert calculation.input_ids == ['input-1', 'input-2']
    assert calculation.input_snapshots == ['source-1', 'profile-source']


@pytest.mark.parametrize('patch', [
    {'quote': 'The company owns all customer reserves.'},
    {'quote': '   '},
    {'evidence_id': 'invented-file:line-9'},
    {'role': 'model-generated fact'},
    {'role': []},
])
def test_invented_or_changed_sentences_cannot_be_presented_as_source_quotes(records, patch):
    rows, sources = records
    sentence = text_record(sources[0])
    claim = {'evidence_id': sentence['id'], 'quote': 'The assets include customer reserves.', 'role': 'evidence', 'reason': 'Context for the financial result.'}
    with client_for() as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, Runner(result(premises=[{**claim, **patch}]))).calculate(
            'circle', request(premise_ids=[sentence['id']]), rows, sources, text_evidence=[sentence])
    assert caught.value.code == 'invalid_text_provenance'


def test_unused_sentences_are_supplied_context_and_never_implicitly_labeled_as_used_quotes(records):
    rows, sources = records
    sentence = text_record(sources[0])
    with client_for() as model:
        calculation = AgentCalculator(settings(), model, Runner()).calculate(
            'circle', request(premise_ids=[sentence['id']]), rows, sources, text_evidence=[sentence])
    proof = calculation.parameters['agent_execution']
    assert proof['supplied_text_evidence'] and proof['premises'] == []


def test_unknown_sentence_ids_and_mismatched_source_hashes_fail_before_the_model(records):
    rows, sources = records
    sentence = text_record(sources[0])
    def unexpected(_): raise AssertionError('Must not call model for unbound text')
    with client_for(handler=unexpected) as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, Runner()).calculate('circle', request(premise_ids=['invented']), rows, sources, text_evidence=[sentence])
    assert caught.value.code == 'unknown_text_evidence'
    sentence['source']['sha256'] = 'c' * 64
    with client_for(handler=unexpected) as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, Runner()).calculate('circle', request(premise_ids=[sentence['id']]), rows, sources, text_evidence=[sentence])
    assert caught.value.code == 'invalid_text_source'


def sequence_model(codes, seen):
    def handler(http_request):
        seen.append(json.loads(http_request.content))
        code = codes[min(len(seen) - 1, len(codes) - 1)]
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps({'code': code})}}]})
    return client_for(handler=handler)


def test_extra_output_key_is_repaired_once_and_both_real_execution_attempts_remain_auditable(records):
    from app.agent_runtime import AgentSettings, LocalCodeRunner
    rows, sources = records
    invalid = CODE.replace("return {'status':", "return {'context': 'extra output fields are not permitted', 'status':")
    seen = []
    config = AgentSettings(model_key='test-private-credential')
    with sequence_model([invalid, CODE], seen) as model:
        calculation = AgentCalculator(config, model, LocalCodeRunner(config)).calculate('circle', request(), rows, sources)
    assert len(seen) == 2
    feedback = json.loads(seen[1]['messages'][-1]['content'])
    assert feedback['previous_attempt']['error_code'] == 'invalid_execution_output'
    assert 'extra output fields' in feedback['previous_attempt']['stdout']
    proof = calculation.parameters['agent_execution']
    assert proof['code'] == CODE and calculation.value == Decimal('9007199254740993.123406')
    attempts = proof['generation_attempts']
    assert [attempt['status'] for attempt in attempts] == ['rejected', 'accepted']
    assert attempts[0]['code'] == invalid and attempts[1]['code'] == CODE
    assert attempts[0]['exit_code'] == 0 and attempts[1]['exit_code'] == 0
    assert attempts[0]['code_sha256'] == hashlib.sha256(invalid.encode()).hexdigest()
    assert proof['generation_prompt_sha256'] == attempts[1]['generation_prompt_sha256']


def test_nonzero_child_execution_can_be_corrected_using_its_bounded_actual_diagnostics(records):
    from app.agent_runtime import AgentSettings, LocalCodeRunner
    rows, sources = records
    invalid = 'def calculate(inputs, parameters):\n    return missing_source_variable\n'
    seen = []
    config = AgentSettings(model_key='test-private-credential')
    with sequence_model([invalid, CODE], seen) as model:
        calculation = AgentCalculator(config, model, LocalCodeRunner(config)).calculate('circle', request(), rows, sources)
    assert len(seen) == 2
    attempt = calculation.parameters['agent_execution']['generation_attempts'][0]
    assert attempt['error_code'] == 'execution_failed' and attempt['exit_code'] != 0
    assert 'missing_source_variable' in attempt['stderr']
    assert calculation.status == 'succeeded'


def test_unsafe_first_program_is_not_executed_and_only_the_repaired_numeric_program_runs(records):
    rows, sources = records
    invalid = 'import os\ndef calculate(inputs, parameters):\n    return os.environ\n'
    seen, runner = [], Runner()
    with sequence_model([invalid, CODE], seen) as model:
        calculation = AgentCalculator(settings(), model, runner).calculate('circle', request(), rows, sources)
    assert len(seen) == 2 and len(runner.calls) == 1
    assert runner.calls[0][0] == CODE
    assert calculation.parameters['agent_execution']['generation_attempts'][0]['error_code'] == 'unsupported_generated_code'


def test_repaired_text_quotes_still_require_verbatim_registered_evidence(records):
    from app.agent_runtime import AgentSettings, LocalCodeRunner
    rows, sources = records
    sentence = text_record(sources[0])
    claim = {'evidence_id': sentence['id'], 'quote': 'The assets include customer reserves.', 'role': 'premise', 'reason': 'Limits the interpretation of a total-assets sum.'}
    bad_claim = {**claim, 'quote': 'All assets are unrestricted company cash.'}
    invalid = CODE.replace("return {'status':", f"return {{'premises': {[bad_claim]!r}, 'status':")
    valid = CODE.replace("return {'status':", f"return {{'premises': {[claim]!r}, 'status':")
    seen = []
    config = AgentSettings(model_key='test-private-credential')
    with sequence_model([invalid, valid], seen) as model:
        calculation = AgentCalculator(config, model, LocalCodeRunner(config)).calculate(
            'circle', request(premise_ids=[sentence['id']]), rows, sources, text_evidence=[sentence])
    proof = calculation.parameters['agent_execution']
    assert len(seen) == 2 and proof['generation_attempts'][0]['error_code'] == 'invalid_text_provenance'
    assert proof['premises'][0]['quote'] == claim['quote']
    assert proof['premises'][0]['source']['sha256'] == sources[0].sha256


@pytest.mark.parametrize('failure', ['missing_key', 'provider_http', 'provider_timeout', 'execution_timeout', 'cleanup'])
def test_configuration_provider_timeout_and_cleanup_failures_are_not_retried(records, failure):
    rows, sources = records
    seen = []
    runner = Runner()
    if failure == 'execution_timeout':
        class TimeoutRunner:
            def __init__(self): self.calls = []
            def execute(self, *args): self.calls.append(args); raise TimeoutError('not public')
        runner = TimeoutRunner()
    elif failure == 'cleanup':
        runner.execution.cleanup_succeeded = False
    def handler(http_request):
        seen.append(http_request)
        if failure == 'provider_http': return httpx.Response(401, text='test-private-credential')
        if failure == 'provider_timeout': raise httpx.ReadTimeout('test-private-credential')
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps({'code': CODE})}}]})
    with client_for(handler=handler) as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings('' if failure == 'missing_key' else 'test-private-credential'), model, runner).calculate('circle', request(), rows, sources)
    assert len(seen) == (0 if failure == 'missing_key' else 1)
    assert len(runner.calls) == (1 if failure in {'execution_timeout', 'cleanup'} else 0)
    assert len(caught.value.generation_attempts) == 1
    assert 'test-private-credential' not in str(caught.value)


def test_only_one_repair_is_allowed_and_failed_attempt_diagnostics_redact_credentials(records):
    rows, sources = records
    seen, runner = [], Runner(result(context='unexpected field'))
    runner.execution.stderr = 'diagnostic test-private-credential ' + 'x' * 20_000
    with sequence_model([CODE], seen) as model, pytest.raises(AgentCalculationError) as caught:
        AgentCalculator(settings(), model, runner).calculate('circle', request(), rows, sources)
    assert len(seen) == 2 and len(runner.calls) == 2
    assert len(caught.value.generation_attempts) == 2
    assert 'single permitted repair attempt' in str(caught.value)
    diagnostics = json.dumps(caught.value.generation_attempts)
    assert 'test-private-credential' not in diagnostics and '[REDACTED]' in diagnostics
    assert len(caught.value.generation_attempts[0]['stderr']) < 9000
