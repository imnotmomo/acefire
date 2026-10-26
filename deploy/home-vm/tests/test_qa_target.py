"""QA deployment must keep branch, private paths and runtime separate."""
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


COMMIT = 'ab' * 20
TOKEN = 'synthetic_qa_head_check_token_12345'


def load_controller():
    spec = importlib.util.spec_from_file_location(
        'qa_target_controller', Path(__file__).resolve().parents[1] / 'apply_release.py',
    )
    controller = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(controller)
    return controller


class QATargetTests(unittest.TestCase):
    def setUp(self):
        self.controller = load_controller()
        self.controller.configure_target('qa')

    def environment(self, updates=None):
        values = {**self.controller.REQUIRED_ENV, 'NICRRON_API_KEY': 'synthetic-model-key',
                  'NICRRON_BASE_URL': 'https://api.nicrron.ai/v1', 'LLM_MODEL': 'synthetic-model'}
        values.update(updates or {})
        return {'backend.env': ''.join(key + '=' + json.dumps(value) + '\n'
                                      for key, value in values.items()).encode()}

    def test_qa_accepts_only_its_fixed_duckdb_and_private_storage_paths(self):
        self.controller.validate_runtime(self.environment())
        self.assertEqual(self.controller.RUNTIME_FILES, ('backend.env',))
        invalid = (
            {'DATA_STORE': 'firestore'},
            {'DUCKDB_PATH': '/var/lib/ingenium/acefire.duckdb'},
            {'UPLOAD_CACHE_ROOT': '/var/lib/ingenium/uploads'},
            {'SOURCE_CACHE_DIR': '/var/lib/ingenium/sources'},
            {'DATA_ROOT': '/srv/ingenium/current/data/additional-cases'},
            {'GOOGLE_APPLICATION_CREDENTIALS': '/etc/ingenium/firestore-runtime.json'},
            {'FIREBASE_PROJECT_ID': 'acefire-50248'},
            {'SOURCE_FILE_MANIFEST': '/etc/ingenium/source-files.json'},
        )
        for values in invalid:
            with self.subTest(values=values), self.assertRaisesRegex(ValueError, 'different store or private path'):
                self.controller.validate_runtime(self.environment(values))

    def test_profiles_cannot_be_selected_with_archive_paths_or_arbitrary_names(self):
        for name in ('production', 'main', '../ingenium', 'qa;id', '', None):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.controller.configure_target(name)
        self.assertEqual(self.controller.APP, Path('/srv/ingenium-qa'))
        self.assertEqual(self.controller.PUBLIC, Path('/var/www/ingenium-qa'))
        self.assertEqual(self.controller.ETC, Path('/etc/ingenium-qa'))
        self.assertEqual(self.controller.STATE, Path('/var/lib/ingenium-qa-cd'))
        self.assertEqual(self.controller.APPLICATION_USER, 'ingenium-qa')
        self.assertEqual(self.controller.SERVICE, 'ingenium-qa-backend')
        self.assertEqual(self.controller.LOCK, '/run/ingenium-qa-deploy.lock')

    def test_qa_head_authenticates_against_qa_branch_instead_of_main(self):
        fetch = Mock(return_value=io.BytesIO(json.dumps({'object': {'sha': COMMIT}}).encode()))
        with patch.object(self.controller.urllib.request, 'build_opener',
                          return_value=SimpleNamespace(open=fetch)):
            self.controller.require_branch_head(COMMIT, TOKEN)
        request = fetch.call_args.args[0]
        self.assertEqual(request.full_url, 'https://api.github.com/repos/imnotmomo/acefire/git/ref/heads/qa')
        self.assertEqual(request.get_header('Authorization'), 'Bearer ' + TOKEN)

    def test_superseded_qa_head_is_rejected_without_suggesting_main_changed(self):
        fetch = Mock(return_value=io.BytesIO(json.dumps({'object': {'sha': 'cd' * 20}}).encode()))
        with patch.object(self.controller.urllib.request, 'build_opener',
                          return_value=SimpleNamespace(open=fetch)):
            with self.assertRaisesRegex(self.controller.BranchHeadError, 'newer qa commit'):
                self.controller.require_branch_head(COMMIT, TOKEN)

    def test_qa_readiness_targets_qa_health_and_its_public_release(self):
        files = {'public/index.html': b'synthetic html', 'public/assets/qa.js': b'synthetic bundle'}
        metadata = json.dumps({'commit': COMMIT, 'release_id': 'ci-qa'}).encode()
        for public, base in ((False, 'http://127.0.0.1:8081'), (True, 'https://qa.linearproduct.co')):
            responses = {
                base + '/api/health': b'{"status":"ok","storage":"duckdb"}',
                base + '/release.json': metadata,
                base + '/index.html': files['public/index.html'],
                base + '/assets/qa.js': files['public/assets/qa.js'],
            }
            with self.subTest(public=public), patch.object(
                self.controller, 'get', side_effect=lambda url, deadline=None: responses[url],
            ) as get:
                self.controller.ready(COMMIT, 'ci-qa', files, public=public)
            self.assertTrue(all(call.args[0].startswith(base + '/') for call in get.call_args_list))


if __name__ == '__main__':
    unittest.main()
