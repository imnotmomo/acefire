"""GitHub head verification uses one scoped credential and safe diagnostics."""
import importlib.util
import io
import json
from pathlib import Path
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request


spec = importlib.util.spec_from_file_location(
    'head_check_controller', Path(__file__).resolve().parents[1] / 'apply_release.py',
)
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)
COMMIT = 'ab' * 20
TOKEN = 'synthetic_head_check_token_123456789'
URL = 'https://api.github.com/repos/imnotmomo/acefire/git/ref/heads/main'


class AuthenticatedHeadTests(unittest.TestCase):
    def check_response(self, response=None, error=None):
        fetch = Mock(return_value=io.BytesIO(response or b''), side_effect=error)
        opener = SimpleNamespace(open=fetch)
        return patch.object(controller.urllib.request, 'build_opener', return_value=opener), fetch

    def assert_safe_error(self, error):
        self.assertNotIn(TOKEN, str(error))
        self.assertNotIn(TOKEN, ''.join(traceback.format_exception(error)))

    def test_reads_the_exact_repository_head_with_scoped_authentication_and_redirect_blocking(self):
        context, fetch = self.check_response(json.dumps({'object': {'sha': COMMIT}}).encode())
        with context as build:
            controller.require_branch_head(COMMIT, TOKEN)
        fetch.assert_called_once()
        request = fetch.call_args.args[0]
        self.assertEqual(request.full_url, URL)
        self.assertEqual(request.get_method(), 'GET')
        headers = {key.lower(): value for key, value in request.header_items()}
        self.assertEqual(headers['authorization'], 'Bearer ' + TOKEN)
        self.assertEqual(headers['accept'], 'application/vnd.github+json')
        self.assertEqual(headers['x-github-api-version'], '2026-03-10')
        self.assertTrue(headers['user-agent'])
        self.assertEqual(fetch.call_args.kwargs['timeout'], 20)
        self.assertIsInstance(build.call_args.args[0], controller.NoApiRedirect)

    def test_bad_token_or_quota_errors_are_actionable_without_anonymous_retry_or_token_echo(self):
        cases = [
            (401, {}, 'job token was rejected'),
            (403, {'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1800000000'},
             'authenticated workflow API quota is exhausted'),
            (429, {'X-RateLimit-Remaining': '0'}, 'authenticated workflow API quota is exhausted'),
            (403, {}, 'contents:read'),
            (302, {'Location': 'https://outside.invalid/'}, 'redirects are not permitted'),
        ]
        for status, headers, message in cases:
            with self.subTest(status=status, message=message):
                failure = urllib.error.HTTPError(
                    URL, status, 'Provider text containing ' + TOKEN,
                    headers, io.BytesIO(('Provider body containing ' + TOKEN).encode()),
                )
                context, fetch = self.check_response(error=failure)
                with context, self.assertRaises(controller.BranchHeadError) as caught:
                    controller.require_branch_head(COMMIT, TOKEN)
                self.assertIn('HTTP ' + str(status), str(caught.exception))
                self.assertIn(message, str(caught.exception))
                self.assert_safe_error(caught.exception)
                self.assertTrue(failure.closed)
                fetch.assert_called_once()

    def test_all_redirect_targets_are_refused(self):
        request = urllib.request.Request(URL, headers={'Authorization': 'Bearer ' + TOKEN})
        handler = controller.NoApiRedirect()
        for status in (301, 302, 303, 307, 308):
            for destination in ('https://outside.invalid/collect', URL + '?redirected=true'):
                with self.subTest(status=status, destination=destination):
                    self.assertIsNone(handler.redirect_request(request, None, status, '', {}, destination))

    def test_network_failures_hide_provider_details_and_do_not_retry_anonymously(self):
        context, fetch = self.check_response(error=urllib.error.URLError('Failure containing ' + TOKEN))
        with context, self.assertRaises(controller.BranchHeadError) as caught:
            controller.require_branch_head(COMMIT, TOKEN)
        self.assertIn('could not complete', str(caught.exception))
        self.assert_safe_error(caught.exception)
        fetch.assert_called_once()

    def test_stale_commit_is_still_rejected_after_authentication(self):
        context, fetch = self.check_response(json.dumps({'object': {'sha': 'cd' * 20}}).encode())
        with context, self.assertRaisesRegex(controller.BranchHeadError, 'newer main commit') as caught:
            controller.require_branch_head(COMMIT, TOKEN)
        self.assert_safe_error(caught.exception)
        fetch.assert_called_once()

    def test_invalid_credentials_are_rejected_before_any_network_operation(self):
        invalid = (None, '', b'', 'short', 123, b'\xff' * 30,
                   TOKEN + '\n', TOKEN + '\r\nX-Injected: yes', TOKEN + ' value', 'a' * 8193)
        for value in invalid:
            with self.subTest(value_type=type(value).__name__):
                with patch.object(controller.urllib.request, 'build_opener') as build:
                    with self.assertRaises(controller.BranchHeadError) as caught:
                        controller.require_branch_head(COMMIT, value)
                build.assert_not_called()
                self.assert_safe_error(caught.exception)
        self.assertEqual(controller.validate_github_token(TOKEN.encode()), TOKEN)

    def test_malformed_responses_are_sanitized_without_becoming_stale_branch_claims(self):
        malformed = (b'not-json', b'{}', b'[]', b'{"object":null}',
                     b'{"object":{"sha":null}}', b'{"object":{"sha":123}}')
        for response in malformed:
            with self.subTest(response=response):
                context, fetch = self.check_response(response)
                with context, self.assertRaises(controller.BranchHeadError) as caught:
                    controller.require_branch_head(COMMIT, TOKEN)
                self.assertIn('could not complete', str(caught.exception))
                self.assert_safe_error(caught.exception)
                fetch.assert_called_once()


if __name__ == '__main__':
    unittest.main()
