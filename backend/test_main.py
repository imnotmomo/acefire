import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from backend.main import app


class AskTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"NICRRON_API_KEY": "test-server-secret"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = self.enterContext(TestClient(app))

    def upstream_response(self, status=200, payload=None):
        return httpx.Response(
            status,
            json=payload,
            request=httpx.Request("POST", "https://api.nicrron.ai/v1/chat/completions"),
        )

    def test_answer_and_server_side_authorization(self):
        response = self.upstream_response(payload={"choices": [{"message": {"content": "Answer"}}]})
        with patch.object(app.state.http_client, "post", AsyncMock(return_value=response)) as post:
            result = self.client.post("/ask", json={"question": " Where is the evidence? "})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), {"answer": "Answer"})
        self.assertEqual(post.call_args.args[0], "https://api.nicrron.ai/v1/chat/completions")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer test-server-secret")
        self.assertEqual(post.call_args.kwargs["json"], {
            "model": "nicrron/auto",
            "messages": [{"role": "user", "content": "Where is the evidence?"}],
            "stream": False,
        })

    def test_missing_key(self):
        os.environ.pop("NICRRON_API_KEY")
        self.assertEqual(self.client.post("/ask", json={"question": "Hello"}).status_code, 503)

    def test_invalid_questions_do_not_call_upstream(self):
        with patch.object(app.state.http_client, "post", AsyncMock()) as post:
            for body in ({}, {"question": ""}, {"question": "  "}, {"question": "x" * 20_001}):
                self.assertEqual(self.client.post("/ask", json=body).status_code, 422)
            post.assert_not_awaited()

    def test_upstream_failure_is_sanitized(self):
        response = self.upstream_response(401, {"error": "test-server-secret"})
        with patch.object(app.state.http_client, "post", AsyncMock(return_value=response)):
            result = self.client.post("/ask", json={"question": "Hello"})
        self.assertEqual(result.status_code, 502)
        self.assertNotIn("test-server-secret", result.text)

    def test_timeout(self):
        with patch.object(app.state.http_client, "post", AsyncMock(side_effect=httpx.ReadTimeout("secret"))):
            result = self.client.post("/ask", json={"question": "Hello"})
        self.assertEqual(result.status_code, 504)
        self.assertNotIn("secret", result.text)

    def test_invalid_upstream_answer(self):
        for payload in ({}, {"choices": []}, {"choices": [{"message": {"content": None}}]}):
            with patch.object(app.state.http_client, "post", AsyncMock(return_value=self.upstream_response(payload=payload))):
                self.assertEqual(self.client.post("/ask", json={"question": "Hello"}).status_code, 502)

    def test_upstream_echoed_key_is_redacted(self):
        response = self.upstream_response(payload={"choices": [{"message": {"content": "Key: test-server-secret"}}]})
        with patch.object(app.state.http_client, "post", AsyncMock(return_value=response)):
            result = self.client.post("/ask", json={"question": "Hello"})
        self.assertEqual(result.json(), {"answer": "Key: [REDACTED]"})


if __name__ == "__main__":
    unittest.main()
