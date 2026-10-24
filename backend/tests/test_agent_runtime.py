import json
from pathlib import Path
import subprocess

import pytest

from app.agent_runtime import AgentSettings, LocalCodeRunner, LocalExecutionError, validate_local_code


EXACT = '''from decimal import Decimal

def calculate(inputs, parameters):
    return {"status": "succeeded", "value": str(Decimal(inputs[0]["observation"]["value"]) + Decimal(parameters["add"])), "unit": "USD"}
'''


def test_settings_read_local_config_as_data_and_environment_takes_precedence(tmp_path, monkeypatch):
    for name in ('NICRRON_API_KEY', 'NICRRON_BASE_URL', 'NICRRON_MODEL', 'LOCAL_EXECUTION_TIMEOUT_SECONDS'):
        monkeypatch.delenv(name, raising=False)
    path = tmp_path / '.env'
    marker = tmp_path / 'must-not-exist'
    path.write_text(f'NICRRON_API_KEY="local-test-key"\nNICRRON_MODEL="configured-model"\nIGNORED=$(touch {marker})\nLOCAL_EXECUTION_TIMEOUT_SECONDS=999\n')
    settings = AgentSettings.from_environment(path)
    assert settings.model_key == 'local-test-key'
    assert settings.model == 'configured-model'
    assert settings.execution_timeout_seconds == 30
    assert not marker.exists()
    assert 'local-test-key' not in repr(settings)
    assert 'local-test-key' not in json.dumps(settings.configuration_status())
    monkeypatch.setenv('NICRRON_API_KEY', 'environment-test-key')
    assert AgentSettings.from_environment(path).model_key == 'environment-test-key'


def test_missing_key_configuration_is_explicit_and_safe(tmp_path, monkeypatch):
    monkeypatch.delenv('NICRRON_API_KEY', raising=False)
    settings = AgentSettings.from_environment(tmp_path / 'absent.env')
    status = settings.configuration_status()
    assert status['configured'] is False
    assert status['missing'] == ['NICRRON_API_KEY']
    assert status['mode'] == 'llm_local'
    assert status['executor'] == 'local_python'
    assert status['isolation'] == 'restricted_subprocess'
    assert settings.model == 'openai/gpt-6.1-sol'


def test_decimal_child_execution_preserves_precision_and_cleans_files(monkeypatch):
    original = subprocess.Popen
    calls = []
    def launch(*args, **kwargs):
        calls.append((args, kwargs))
        return original(*args, **kwargs)
    monkeypatch.setattr(subprocess, 'Popen', launch)
    monkeypatch.setenv('NICRRON_API_KEY', 'do-not-inherit-test-secret')
    result = LocalCodeRunner(AgentSettings(model_key='do-not-inherit-test-secret')).execute(
        EXACT, [{'observation': {'value': '9007199254740993.123400'}}], {'add': '0.000006'})
    assert result.exit_code == 0, result.stderr
    assert json.loads(result.stdout)['value'] == '9007199254740993.123406'
    assert result.cleanup_succeeded
    assert result.execution_id and result.executed_at
    assert calls[0][1]['start_new_session'] is True
    assert set(calls[0][1]['env']) == {'LANG', 'LC_ALL'}
    assert not Path(calls[0][1]['cwd']).exists()
    argv = calls[0][0][0]
    assert '-I' in argv
    assert '9007199254740993.123400' not in ' '.join(argv)
    assert 'do-not-inherit-test-secret' not in str(calls[0])


@pytest.mark.parametrize('code', [
    'import os\ndef calculate(inputs, parameters):\n return os.environ',
    'import socket\ndef calculate(inputs, parameters):\n return {}',
    'def calculate(inputs, parameters):\n return open("/etc/passwd").read()',
    'def calculate(inputs, parameters):\n return inputs.__class__',
    'def calculate(inputs, parameters):\n return getattr(inputs, "__class__")',
    'def calculate(inputs, parameters):\n return {"value": 1.2}',
    'def calculate(inputs, parameters):\n print(inputs)\n return {}',
    'import decimal\ndef calculate(inputs, parameters):\n return decimal.sys',
    'def calculate(inputs, parameters):\n return "{0.__class__}".format(inputs)',
    'from decimal import *\ndef calculate(inputs, parameters):\n return {}',
    'class Unsafe:\n pass\ndef calculate(inputs, parameters):\n return {}',
    'def calculate(inputs, parameters):\n return {}\ncalculate([], {})',
])
def test_forbidden_code_is_rejected_before_starting_a_process(code, monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail('Rejected code must not launch a child')
    monkeypatch.setattr(subprocess, 'Popen', denied)
    with pytest.raises(LocalExecutionError):
        LocalCodeRunner().execute(code, [], {})


def test_generic_text_evidence_and_parameters_pass_through_without_file_access():
    code = '''def calculate(inputs, parameters):
    return {"status": "insufficient_data", "value": None, "premise": inputs[0]["text_evidence"]["text"], "parameter": parameters["scope"]}
'''
    result = LocalCodeRunner().execute(code, [{'text_evidence': {'id': 'text:1', 'text': 'Fiscal closing date unknown'}, 'source': {'snapshot_id': 'snapshot'}}], {'scope': 'parent'})
    assert result.exit_code == 0
    assert json.loads(result.stdout)['premise'] == 'Fiscal closing date unknown'
    assert json.loads(result.stdout)['parameter'] == 'parent'


def test_infinite_code_is_killed_and_temporary_directory_is_removed(monkeypatch):
    original = subprocess.Popen
    directories = []
    def launch(*args, **kwargs):
        directories.append(Path(kwargs['cwd']))
        return original(*args, **kwargs)
    monkeypatch.setattr(subprocess, 'Popen', launch)
    result = LocalCodeRunner(AgentSettings(execution_timeout_seconds=1)).execute('def calculate(inputs, parameters):\n while True:\n  pass', [], {})
    assert result.exit_code == 124
    assert 'time limit' in result.stderr
    assert result.cleanup_succeeded
    assert all(not item.exists() for item in directories)


def test_output_is_bounded_and_runtime_errors_do_not_include_host_tracebacks():
    result = LocalCodeRunner().execute('def calculate(inputs, parameters):\n return {"text": "x" * 100000}', [], {})
    assert result.exit_code != 0
    assert len(result.stdout) <= 65536
    assert len(result.stderr) <= 65536
    assert '60 KiB' in result.stderr
    assert 'Traceback' not in result.stderr
    assert 'worker.py' not in result.stderr


def test_worker_errors_are_redacted_before_persistence():
    key = 'fictional-test-model-key'
    result = LocalCodeRunner(AgentSettings(model_key=key)).execute('def calculate(inputs, parameters):\n raise ValueError(parameters["message"])', [], {'message': key})
    assert result.exit_code == 1
    assert key not in result.stderr
    assert '[REDACTED]' in result.stderr


def test_non_finite_json_inputs_and_oversized_payloads_are_rejected():
    code = 'def calculate(inputs, parameters):\n return {}'
    with pytest.raises(LocalExecutionError, match='finite JSON'):
        LocalCodeRunner().execute(code, [], {'bad': float('nan')})
    with pytest.raises(LocalExecutionError, match='1 MiB'):
        LocalCodeRunner().execute(code, [], {'large': 'x' * (1024 * 1024)})


def test_calculate_must_return_one_json_result_object():
    result = LocalCodeRunner().execute('def calculate(inputs, parameters):\n return [1, 2]', [], {})
    assert result.exit_code == 1
    assert 'one result object' in result.stderr
    assert result.cleanup_succeeded


def test_supported_config_aliases_and_preferred_names(tmp_path, monkeypatch):
    for name in ('NICRRON_MODEL', 'LOCAL_EXECUTION_TIMEOUT_SECONDS', 'LLM_MODEL', 'AGENT_EXECUTION_TIMEOUT_SECONDS'):
        monkeypatch.delenv(name, raising=False)
    path = tmp_path / '.env'
    path.write_text('LLM_MODEL=alias-model\nAGENT_EXECUTION_TIMEOUT_SECONDS=4\n')
    settings = AgentSettings.from_environment(path)
    assert settings.model == 'alias-model'
    assert settings.execution_timeout_seconds == 4
    assert settings.configuration_status()['maximum_inputs'] == 100
    monkeypatch.setenv('NICRRON_MODEL', 'preferred-model')
    monkeypatch.setenv('LOCAL_EXECUTION_TIMEOUT_SECONDS', '3')
    assert AgentSettings.from_environment(path).model == 'preferred-model'
    assert AgentSettings.from_environment(path).execution_timeout_seconds == 3


def test_builtin_decimal_format_is_supported_without_string_format_introspection():
    code = "from decimal import Decimal\ndef calculate(inputs, parameters):\n return {\"value\": format(Decimal(\"123.4500\"), \"f\")}"
    result = LocalCodeRunner().execute(code, [], {})
    assert result.exit_code == 0, result.stderr
    assert json.loads(result.stdout)['value'] == '123.4500'
