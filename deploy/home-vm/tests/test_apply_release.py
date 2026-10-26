"""Exercise release failure recovery against real temporary links and files."""
from contextlib import ExitStack, redirect_stdout
from hashlib import sha256
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'apply_release', Path(__file__).resolve().parents[1] / 'apply_release.py',
)
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)
COMMIT = 'ab' * 20
GITHUB_TOKEN = 'synthetic_head_check_token_123456789'


def tar_bytes(files, mode='w'):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode=mode) as archive:
        for name, content in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    return stream.getvalue()


class ApplyReleaseRollbackTests(unittest.TestCase):
    target = 'production'

    def setUp(self):
        if self.target == 'qa':
            names = ('STATE', 'APP', 'PUBLIC', 'ETC', 'RUNTIME_FILES', 'REQUIRED_ENV',
                     'TARGET', 'BRANCH', 'APPLICATION_USER', 'SERVICE', 'LOCK', 'LOOPBACK_URL', 'PUBLIC_URL')
            old = {name: getattr(controller, name) for name in names}
            self.addCleanup(lambda: [setattr(controller, name, value) for name, value in old.items()])
            controller.configure_target('qa')
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.app, self.public, self.etc, self.state = [
            self.root / name for name in ('app', 'public', 'etc', 'state')
        ]
        self.old_app = self.app / 'releases' / 'previous'
        self.old_public = self.public / 'releases' / 'previous'
        self.old_app.mkdir(parents=True)
        self.old_public.mkdir(parents=True)
        (self.app / 'current').symlink_to(self.old_app)
        (self.public / 'current').symlink_to(self.old_public)
        self.etc.mkdir()
        self.old_runtime = {
            name: ('original-private-' + name).encode() for name in controller.RUNTIME_FILES
        }
        for name, content in self.old_runtime.items():
            (self.etc / name).write_bytes(content)

        source = {
            'app/backend/requirements.lock': b'# synthetic locked dependencies\n',
            'app/backend/app/main.py': b'# synthetic application\n',
            'public/index.html': b'<!doctype html><title>Synthetic release</title>',
            'public/release.json': json.dumps({'commit': COMMIT, 'storage': 'firestore',
                                              'firebase_project_id': 'acefire-50248',
                                              'database_id': 'acefire',
                                              'firebase_database_edition': 'STANDARD'}).encode(),
        }
        release = tar_bytes(source, 'w:gz')
        manifest = {
            'schema_version': 1, 'commit': COMMIT,
            'archive_sha256': sha256(release).hexdigest(),
            'files': [
                {'path': name, 'bytes': len(content), 'sha256': sha256(content).hexdigest()}
                for name, content in source.items()
            ],
        }
        environment = {
            **controller.REQUIRED_ENV,
            'NICRRON_API_KEY': 'synthetic-test-key',
            'NICRRON_BASE_URL': 'https://api.nicrron.ai/v1',
            'LLM_MODEL': 'synthetic-test-model',
        }
        self.new_runtime = {
            'backend.env': ''.join(key + '=' + json.dumps(value) + '\n'
                                   for key, value in environment.items()).encode(),
        }
        if self.target == 'production':
            self.new_runtime.update({
                'firestore-runtime.json': json.dumps({
                'type': 'service_account', 'project_id': 'acefire-50248',
                'client_email': 'ingenium-home@acefire-50248.iam.gserviceaccount.com',
                }).encode(),
                'prism.env': b'PRISMTRACE_API_KEY="synthetic-test-key"\n',
            })
        self.bundle_files = {
            'release.tar.gz': release,
            'manifest.json': json.dumps(manifest).encode(),
            'deployment.json': json.dumps({
                'commit': COMMIT, 'run_number': 1, 'run_id': 123, 'run_attempt': 1,
            }).encode(),
            **self.new_runtime,
            'github-api-token': GITHUB_TOKEN.encode(),
        }
        self.bundle = tar_bytes(self.bundle_files)

    def patched_host(self, ready, branch=None):
        """Keep file operations real; replace only host/root process boundaries."""
        stack = ExitStack()
        real_open = open

        def open_lock(path, *args, **kwargs):
            if str(path) == controller.LOCK:
                path = self.root / 'deployment.lock'
            return real_open(path, *args, **kwargs)

        for name, value in [('APP', self.app), ('PUBLIC', self.public),
                            ('ETC', self.etc), ('STATE', self.state)]:
            stack.enter_context(patch.object(controller, name, value))
        stack.enter_context(patch.object(controller, 'open', side_effect=open_lock, create=True))
        stack.enter_context(patch.object(controller.os, 'geteuid', return_value=0))
        stack.enter_context(patch.object(controller.os, 'umask', return_value=0o077))
        stack.enter_context(patch.object(controller.os, 'chown'))
        stack.enter_context(patch.object(
            controller.pwd, 'getpwnam', return_value=SimpleNamespace(pw_gid=os.getgid()),
        ))
        stack.enter_context(patch.object(controller.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(self.bundle))))
        self.head_checks = stack.enter_context(patch.object(controller, 'require_branch_head', side_effect=branch))
        stack.enter_context(patch.object(controller, 'ready', side_effect=ready))
        stack.enter_context(patch.object(controller, 'freeze_application'))
        commands = stack.enter_context(patch.object(controller, 'command'))
        return stack, commands

    def assert_previous_release_intact(self):
        self.assertEqual((self.app / 'current').resolve(), self.old_app)
        self.assertEqual((self.public / 'current').resolve(), self.old_public)
        for name, content in self.old_runtime.items():
            self.assertEqual((self.etc / name).read_bytes(), content)
        self.assertFalse((self.state / 'state.json').exists())

    def assert_workflow_token_not_persisted(self):
        for path in self.root.rglob('*'):
            if path.is_file() and not path.is_symlink():
                self.assertNotIn(GITHUB_TOKEN.encode(), path.read_bytes(), str(path.relative_to(self.root)))

    def test_failed_public_check_restores_links_and_every_private_runtime_file(self):
        observed_new_release = []

        def ready(*args, **kwargs):
            if kwargs.get('public'):
                self.assertNotEqual((self.app / 'current').resolve(), self.old_app)
                self.assertNotEqual((self.public / 'current').resolve(), self.old_public)
                for name, content in self.new_runtime.items():
                    self.assertEqual((self.etc / name).read_bytes(), content)
                observed_new_release.append(True)
                raise RuntimeError('Synthetic public acceptance failure')

        stack, commands = self.patched_host(ready)
        with stack, self.assertRaisesRegex(RuntimeError, 'Deployment failed'):
            controller.deploy(COMMIT)
        self.assertEqual(observed_new_release, [True])
        self.assert_previous_release_intact()
        self.assert_workflow_token_not_persisted()
        self.assertEqual(self.head_checks.call_args_list,
                         [unittest.mock.call(COMMIT, GITHUB_TOKEN)] * 2)
        service_calls = [call.args[0] for call in commands.call_args_list
                         if call.args[0][0] == '/usr/bin/systemctl']
        self.assertEqual(service_calls, [
            ['/usr/bin/systemctl', 'stop', controller.SERVICE],
            ['/usr/bin/systemctl', 'start', controller.SERVICE],
            ['/usr/bin/systemctl', 'stop', controller.SERVICE],
            ['/usr/bin/systemctl', 'start', controller.SERVICE],
        ])

    def test_newer_branch_head_during_preparation_leaves_running_release_untouched(self):
        stack, commands = self.patched_host(
            ready=lambda *args, **kwargs: self.fail('A rejected release cannot reach readiness'),
            branch=[None, ValueError('Synthetic newer main commit')],
        )
        with stack, self.assertRaisesRegex(RuntimeError, 'Deployment failed'):
            controller.deploy(COMMIT)
        self.assert_previous_release_intact()
        self.assert_workflow_token_not_persisted()
        self.assertFalse(any(call.args[0][0] == '/usr/bin/systemctl'
                             for call in commands.call_args_list))

    def test_success_commits_matching_links_runtime_and_workflow_state(self):
        readiness_checks = []

        def ready(commit=None, release_id=None, files=None, public=False):
            self.assertEqual(commit, COMMIT)
            self.assertNotEqual((self.app / 'current').resolve(), self.old_app)
            public_root = (self.public / 'current').resolve()
            metadata = json.loads((public_root / 'release.json').read_text())
            self.assertEqual(metadata['commit'], COMMIT)
            self.assertEqual(metadata['release_id'], release_id)
            self.assertEqual((public_root / 'index.html').read_bytes(), files['public/index.html'])
            readiness_checks.append(public)

        stack, commands = self.patched_host(ready)
        output = io.StringIO()
        with stack, redirect_stdout(output):
            controller.deploy(COMMIT)
        self.assertEqual(readiness_checks, [False, True])
        state = json.loads((self.state / 'state.json').read_text())
        self.assertEqual(state['commit'], COMMIT)
        self.assertEqual(state['run_number'], 1)
        self.assertEqual(state['run_id'], 123)
        self.assertEqual(state['previous_app'], str(self.old_app))
        self.assertEqual(state['previous_public'], str(self.old_public))
        self.assertEqual((self.app / 'current').resolve(), self.app / 'releases' / state['release_id'])
        self.assertEqual((self.public / 'current').resolve(), self.public / 'releases' / state['release_id'])
        for name, content in self.new_runtime.items():
            self.assertEqual((self.etc / name).read_bytes(), content)
        self.assertEqual(json.loads(output.getvalue())['status'], 'deployed')
        self.assertNotIn(GITHUB_TOKEN, output.getvalue())
        self.assert_workflow_token_not_persisted()
        self.assertEqual(self.head_checks.call_args_list,
                         [unittest.mock.call(COMMIT, GITHUB_TOKEN)] * 2)
        service_calls = [call.args[0] for call in commands.call_args_list
                         if call.args[0][0] == '/usr/bin/systemctl']
        self.assertEqual(service_calls, [
            ['/usr/bin/systemctl', 'stop', controller.SERVICE],
            ['/usr/bin/systemctl', 'start', controller.SERVICE],
        ])

    def test_missing_or_invalid_workflow_token_stops_before_network_and_preparation(self):
        for token in (None, b'', b'too-short', GITHUB_TOKEN.encode() + b'\n'):
            with self.subTest(token_present=token is not None):
                files = dict(self.bundle_files)
                if token is None:
                    files.pop('github-api-token')
                else:
                    files['github-api-token'] = token
                self.bundle = tar_bytes(files)
                stack, commands = self.patched_host(ready=lambda *args, **kwargs: None)
                with stack, self.assertRaises(controller.BranchHeadError):
                    controller.deploy(COMMIT)
                self.head_checks.assert_not_called()
                commands.assert_not_called()
                self.assert_previous_release_intact()
                self.assert_workflow_token_not_persisted()

    def test_workflow_metadata_cannot_smuggle_the_token_into_a_backup_or_state(self):
        files = dict(self.bundle_files)
        metadata = json.loads(files['deployment.json'])
        metadata['github_token'] = GITHUB_TOKEN
        files['deployment.json'] = json.dumps(metadata).encode()
        self.bundle = tar_bytes(files)
        stack, commands = self.patched_host(ready=lambda *args, **kwargs: None)
        with stack, self.assertRaisesRegex(ValueError, 'Unexpected workflow metadata'):
            controller.deploy(COMMIT)
        self.head_checks.assert_not_called()
        commands.assert_not_called()
        self.assert_previous_release_intact()
        self.assert_workflow_token_not_persisted()

    def test_second_authenticated_head_failure_preserves_safe_diagnostics_without_activation(self):
        message = 'GitHub branch verification failed (HTTP 403): authenticated API quota exhausted.'
        stack, commands = self.patched_host(
            ready=lambda *args, **kwargs: self.fail('Rejected preparation cannot reach readiness'),
            branch=[None, controller.BranchHeadError(message)],
        )
        output = io.StringIO()
        with stack, redirect_stdout(output), self.assertRaises(controller.BranchHeadError) as caught:
            controller.deploy(COMMIT)
        self.assertIn('HTTP 403', str(caught.exception))
        self.assertIn('Private audit:', str(caught.exception))
        self.assertNotIn(GITHUB_TOKEN, str(caught.exception) + output.getvalue())
        self.assertEqual(self.head_checks.call_args_list,
                         [unittest.mock.call(COMMIT, GITHUB_TOKEN)] * 2)
        self.assertFalse(any(call.args[0][0] == '/usr/bin/systemctl'
                             for call in commands.call_args_list))
        self.assert_previous_release_intact()
        self.assert_workflow_token_not_persisted()


class QAReleaseRollbackTests(ApplyReleaseRollbackTests):
    """The same real-file rollback boundary must hold for isolated QA state."""
    target = 'qa'

    def test_qa_activation_cannot_use_production_services_users_or_metadata(self):
        stack, commands = self.patched_host(ready=lambda *args, **kwargs: None)
        with stack, redirect_stdout(io.StringIO()):
            controller.deploy(COMMIT)
        metadata = json.loads(((self.public / 'current').resolve() / 'release.json').read_text())
        self.assertEqual(metadata['environment'], 'qa')
        self.assertEqual(metadata['branch'], 'qa')
        self.assertEqual(metadata['storage'], 'duckdb')
        self.assertEqual(metadata['public_hostname'], 'qa.linearproduct.co')
        self.assertNotIn('firebase_project_id', metadata)
        self.assertNotIn('database_id', metadata)
        self.assertNotIn('firebase_database_edition', metadata)
        self.assertEqual(set(self.new_runtime), {'backend.env'})
        for invocation in commands.call_args_list:
            args = invocation.args[0]
            self.assertNotIn('ingenium', args)
            self.assertNotIn('ingenium:ingenium', args)
            self.assertNotIn('ingenium-backend', args)
        self.assert_workflow_token_not_persisted()

    def test_qa_rejects_production_credential_bundle_before_any_preparation(self):
        for member in ('firestore-runtime.json', 'prism.env'):
            with self.subTest(member=member):
                self.bundle = tar_bytes({**self.bundle_files, member: b'synthetic forbidden production config'})
                stack, commands = self.patched_host(ready=lambda *args, **kwargs: None)
                with stack, self.assertRaisesRegex(ValueError, 'Unexpected deployment bundle'):
                    controller.deploy(COMMIT)
                self.head_checks.assert_not_called()
                commands.assert_not_called()
                self.assert_previous_release_intact()


if __name__ == '__main__':
    unittest.main()
