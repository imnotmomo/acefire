"""Configured model access and bounded local Python execution.

Generated code runs only in a fresh child process. This is a restricted numeric
worker, not a hardware-isolated sandbox or an unrestricted Python service.
"""
from __future__ import annotations

import ast
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from uuid import uuid4


class LocalExecutionError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class AgentSettings:
    model_key: str = field(default='', repr=False)
    nicrron_base_url: str = 'https://api.nicrron.ai/v1'
    model: str = 'openai/gpt-6.1-sol'
    execution_timeout_seconds: int = 10

    @classmethod
    def from_environment(cls, env_file: Path | None = None) -> 'AgentSettings':
        path = env_file if env_file is not None else Path(__file__).resolve().parent.parent / '.env'
        values: dict[str, str] = {}
        if path.is_file():
            for line in path.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if line.startswith('export '):
                    line = line[7:].lstrip()
                name, separator, value = line.partition('=')
                name, value = name.strip(), value.strip()
                if not separator or name not in {'NICRRON_API_KEY', 'NICRRON_BASE_URL', 'NICRRON_MODEL', 'LOCAL_EXECUTION_TIMEOUT_SECONDS', 'LLM_MODEL', 'AGENT_EXECUTION_TIMEOUT_SECONDS'}:
                    continue
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                    value = value[1:-1]
                values[name] = value
        def get(name: str, default: str = '', alias: str | None = None) -> str:
            if name in os.environ or name in values:
                return os.environ.get(name, values.get(name, default)).strip()
            return os.environ.get(alias, values.get(alias, default)).strip() if alias else default
        try:
            timeout = int(get('LOCAL_EXECUTION_TIMEOUT_SECONDS', '10', 'AGENT_EXECUTION_TIMEOUT_SECONDS'))
        except ValueError:
            timeout = 10
        return cls(model_key=get('NICRRON_API_KEY'),
                   nicrron_base_url=get('NICRRON_BASE_URL', 'https://api.nicrron.ai/v1').rstrip('/'),
                   model=get('NICRRON_MODEL', 'openai/gpt-6.1-sol', 'LLM_MODEL'),
                   execution_timeout_seconds=max(1, min(timeout, 30)))

    def configuration_status(self) -> dict:
        missing = [] if self.model_key else ['NICRRON_API_KEY']
        return {'mode': 'llm_local', 'configured': not missing, 'model': self.model,
                'generation_provider': 'nicrron', 'executor': 'local_python', 'missing': missing,
                'execution_timeout_seconds': self.execution_timeout_seconds,
                'isolation': 'restricted_subprocess', 'maximum_inputs': 100}


@dataclass(frozen=True)
class LocalExecution:
    stdout: str
    stderr: str
    exit_code: int
    execution_id: str
    cleanup_succeeded: bool
    executed_at: str


_ALLOWED_MODULES = {'decimal', 'json', 'datetime', 'calendar', 'math', 'statistics', 'collections'}
_FORBIDDEN_NAMES = {'eval', 'exec', 'open', 'compile', 'globals', 'locals', 'vars', 'getattr',
                    'setattr', 'delattr', 'hasattr', 'input', 'print', 'breakpoint', 'help',
                    'dir', 'type', 'object', 'super', 'memoryview', 'bytearray', 'bytes',
                    'exit', 'quit', 'copyright', 'license', 'classmethod', 'staticmethod',
                    'property', 'staticmethod', 'ExceptionGroup'}
_FORBIDDEN_ATTRS = {'sys', 'os', 'modules', 'system', 'popen', 'environ', 'open', 'read',
                    'write', 'load', 'dump', 'import_module', 'builtins', 'format', 'format_map',
                    'mro', 'subclasses', 'gi_frame', 'cr_frame', 'f_globals', 'f_locals'}


def validate_local_code(code: str) -> None:
    if not isinstance(code, str) or not code.strip() or len(code.encode('utf-8')) > 32768:
        raise LocalExecutionError('Generated Python must be nonempty and at most 32 KiB.')
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError, RecursionError):
        raise LocalExecutionError('Generated Python is not valid supported code.') from None
    if not any(isinstance(node, ast.FunctionDef) and node.name == 'calculate' for node in tree.body):
        raise LocalExecutionError('Generated Python must define calculate(inputs, parameters).')
    if any(not isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef))
           and not (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str))
           for node in tree.body):
        raise LocalExecutionError('Only imports and function definitions are allowed at module level.')
    forbidden_nodes = (ast.ClassDef, ast.AsyncFunctionDef, ast.Await, ast.AsyncFor, ast.AsyncWith,
                       ast.Global, ast.Nonlocal, ast.With, ast.Delete)
    for node in ast.walk(tree):
        if isinstance(node, forbidden_nodes):
            raise LocalExecutionError('Generated Python uses an unsupported language feature.')
        if isinstance(node, ast.Constant) and isinstance(node.value, (float, complex)):
            raise LocalExecutionError('Numeric code must use Decimal strings instead of float literals.')
        if isinstance(node, ast.Name) and (node.id.startswith('_') or node.id in _FORBIDDEN_NAMES):
            raise LocalExecutionError('Generated Python requests a forbidden name.')
        if isinstance(node, (ast.FunctionDef, ast.arg)):
            name = node.name if isinstance(node, ast.FunctionDef) else node.arg
            if name.startswith('_'):
                raise LocalExecutionError('Private generated names are not allowed.')
        if isinstance(node, ast.Attribute) and (node.attr.startswith('_') or node.attr in _FORBIDDEN_ATTRS):
            raise LocalExecutionError('Generated Python requests a forbidden attribute.')
        if isinstance(node, ast.Import):
            if any(alias.name not in _ALLOWED_MODULES or alias.asname and alias.asname.startswith('_') for alias in node.names):
                raise LocalExecutionError('Generated Python may import numeric standard-library modules only.')
        if isinstance(node, ast.ImportFrom):
            if node.level or node.module not in _ALLOWED_MODULES or any(alias.name == '*' or alias.name.startswith('_') or alias.name in _FORBIDDEN_ATTRS or alias.asname and alias.asname.startswith('_') for alias in node.names):
                raise LocalExecutionError('Generated Python requests an unsupported import.')


# This trusted harness is written by the application, never by the model. The
# model's code and source-bound data travel over stdin, not a shell or argv.
_CHILD = r'''
import builtins
import decimal
import json
import sys
try:
    import resource
    for name, amount in [('RLIMIT_CPU', int(sys.argv[1]) + 1), ('RLIMIT_FSIZE', 65536), ('RLIMIT_DATA', 512 * 1024 * 1024), ('RLIMIT_CORE', 0), ('RLIMIT_NOFILE', 32), ('RLIMIT_NPROC', 0)]:
        if hasattr(resource, name):
            try:
                resource.setrlimit(getattr(resource, name), (amount, amount))
            except (ValueError, OSError):
                pass
    if hasattr(resource, 'RLIMIT_AS'):
        try:
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
        except (ValueError, OSError):
            pass
except ImportError:
    pass
# Load safe numeric modules before reducing imports; their internal imports are
# trusted standard-library work and are not available to generated code.
import calendar, collections, datetime, math, statistics
modules = {'decimal': decimal, 'json': json, 'datetime': datetime, 'calendar': calendar,
           'math': math, 'statistics': statistics, 'collections': collections}
def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level or name not in modules or any(str(item).startswith('_') or item in {'sys','os','open','read','write','load','dump','builtins','modules'} for item in fromlist):
        raise ImportError('Unsupported numeric import')
    return modules[name]
allowed = ['abs','all','any','bool','dict','enumerate','filter','format','frozenset','int','isinstance',
           'issubclass','iter','len','list','map','max','min','next','pow','range','reversed',
           'round','set','slice','sorted','str','sum','tuple','zip','Exception','ValueError',
           'TypeError','KeyError','IndexError','ZeroDivisionError','ArithmeticError','OverflowError']
safe = {name: getattr(builtins, name) for name in allowed}
safe['__import__'] = safe_import
try:
    payload = json.load(sys.stdin)
    decimal.getcontext().prec = 50
    namespace = {'__builtins__': safe, '__name__': 'calculation'}
    exec(compile(payload['code'], '<generated calculation>', 'exec'), namespace, namespace)
    result = namespace['calculate'](payload['inputs'], payload['parameters'])
    if not isinstance(result, dict):
        raise TypeError('calculate must return one result object')
    output = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    if len(output.encode('utf-8')) > 60000:
        raise ValueError('Calculation output exceeds the 60 KiB limit')
    sys.stdout.write(output)
except BaseException as error:
    sys.stderr.write(type(error).__name__ + ': ' + str(error)[:1800])
    sys.exit(1)
'''


class LocalCodeRunner:
    def __init__(self, settings: AgentSettings | None = None):
        self.settings = settings or AgentSettings.from_environment()

    def execute(self, code: str, inputs: list[dict], parameters: dict) -> LocalExecution:
        validate_local_code(code)
        if not isinstance(inputs, list) or not all(isinstance(item, dict) for item in inputs) or not isinstance(parameters, dict):
            raise LocalExecutionError('Calculation inputs and parameters must be JSON objects.')
        try:
            payload = json.dumps({'code': code, 'inputs': inputs, 'parameters': parameters}, ensure_ascii=False, allow_nan=False).encode('utf-8')
        except (ValueError, TypeError):
            raise LocalExecutionError('Calculation data must be finite JSON.') from None
        if len(payload) > 1024 * 1024:
            raise LocalExecutionError('Calculation input exceeds the 1 MiB execution limit.')
        timeout = max(1, min(self.settings.execution_timeout_seconds, 30))
        execution_id = str(uuid4())
        executed_at = datetime.now(timezone.utc).isoformat()
        stdout = stderr = ''
        exit_code = 1
        temporary = tempfile.TemporaryDirectory(prefix='acefire-calculation-')
        directory = Path(temporary.name)
        try:
            worker = directory / 'worker.py'
            worker.write_text(_CHILD, encoding='utf-8')
            os.chmod(worker, 0o600)
            with (directory / 'stdout.txt').open('wb') as out, (directory / 'stderr.txt').open('wb') as err:
                process = subprocess.Popen([sys.executable, '-I', '-X', 'utf8', str(worker), str(timeout)],
                                           cwd=directory, env={'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'},
                                           stdin=subprocess.PIPE, stdout=out, stderr=err, start_new_session=True)
                try:
                    process.communicate(input=payload, timeout=timeout)
                    exit_code = process.returncode
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except (ProcessLookupError, AttributeError):
                        process.kill()
                    process.wait(timeout=3)
                    exit_code = 124
            stdout = (directory / 'stdout.txt').read_bytes()[:65536].decode('utf-8', errors='replace')
            stderr = (directory / 'stderr.txt').read_bytes()[:65536].decode('utf-8', errors='replace')
            if exit_code == 124:
                stderr = 'Calculation exceeded the local execution time limit.'
        except OSError:
            raise LocalExecutionError('The local Python execution worker could not start.', 503) from None
        finally:
            try:
                temporary.cleanup()
                cleanup_succeeded = True
            except OSError:
                cleanup_succeeded = False
        # Keys never enter the worker. Redact nevertheless before persisting any
        # output in case a provider or user supplied a matching literal in data.
        if self.settings.model_key:
            stdout = stdout.replace(self.settings.model_key, '[REDACTED]')
            stderr = stderr.replace(self.settings.model_key, '[REDACTED]')
        return LocalExecution(stdout, stderr, exit_code, execution_id, cleanup_succeeded, executed_at)
