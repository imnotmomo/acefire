import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from backend.integrations.nicrron import NicrronClient, NicrronError, parse_extraction_response
from backend.evidence.extract_nicrron import run_batch
from backend.evidence.prepare_circle import register, sha256, write_json


def completion(content='{"claims": [], "open_questions": []}', finish="stop"):
    return {"id": "request-test", "model": "actual-vision-model", "provider": "test-provider",
            "choices": [{"message": {"content": content}, "finish_reason": finish}],
            "usage": {"total_tokens": 10}}


class Response(io.BytesIO):
    headers = {"x-request-id": "header-request", "x-nicrron-cache": "MISS"}


class NicrronTests(unittest.TestCase):
    @patch("backend.integrations.nicrron.urlopen")
    def test_gateway_auth_and_json_response(self, open_url):
        open_url.return_value = Response(json.dumps(completion()).encode())
        record = NicrronClient("secret").complete([{"role": "user", "content": "JSON please"}], model="vision-model")
        request = open_url.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.nicrron.ai/v1/chat/completions")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(json.loads(request.data)["response_format"], {"type": "json_object"})
        self.assertNotIn("secret", json.dumps(record))
        self.assertEqual(record["request_id"], "header-request")
        self.assertEqual(parse_extraction_response(record)["claims"], [])

    @patch("backend.integrations.nicrron.urlopen")
    def test_missing_key_and_error_no_retries(self, open_url):
        with self.assertRaises(NicrronError):
            NicrronClient("").complete([])
        open_url.assert_not_called()
        open_url.side_effect = HTTPError("url", 402, "secret", {}, io.BytesIO(b'{"error":{"message":"quota secret"}}'))
        with self.assertRaisesRegex(NicrronError, "HTTP 402") as caught:
            NicrronClient("secret").complete([], model="vision-model")
        self.assertNotIn("secret", str(caught.exception))
        self.assertEqual(caught.exception.details["message"], "quota [REDACTED]")
        self.assertEqual(open_url.call_count, 1)

    def test_truncation_and_invalid_json_rejected(self):
        for response in [completion(finish="length"), completion(content="not JSON"), {"choices": []}]:
            with self.assertRaises(NicrronError):
                parse_extraction_response({"response": response})

    def test_whole_json_fence_accepted_but_surrounding_prose_rejected(self):
        payload = '{"claims": [], "open_questions": []}'
        self.assertEqual(parse_extraction_response({"response": completion(content='```json\n'+payload+'\n```')}), json.loads(payload))
        with self.assertRaises(NicrronError):
            parse_extraction_response({"response": completion(content='Explanation\n```json\n'+payload+'\n```')})


class BatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = register()

    def prepare_fixture(self, run):
        run.mkdir()
        image = run / "page.png"
        image.write_bytes(b"image-fixture-bytes")
        packet = {"source_sha256": self.registry["contract"]["sha256"],
                  "pages": [{"physical_page": 367, "image": "page.png", "image_sha256": sha256(image),
                             "page_role": "source", "text": "test document text"}],
                  "batches": [{"batch_id": "fixture", "target_pages": [367], "context_pages": [367]}]}
        write_json(run / "packet.json", packet)
        write_json(run / "registry.json", self.registry)

    @patch("backend.integrations.nicrron.urlopen")
    def test_dry_run_never_calls_gateway_and_checks_image_hash(self, open_url):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.prepare_fixture(root / "run")
            result = run_batch(root / "run", "fixture", root / "out", "vision-model", dry_run=True)
            self.assertFalse(result["network_called"])
            open_url.assert_not_called()
            (root / "run/page.png").write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                run_batch(root / "run", "fixture", root / "out2", "vision-model", dry_run=True)

    def test_batch_preserves_raw_response_and_actual_model(self):
        class FakeClient:
            api_key = "fixture"

            def complete(self, messages, model):
                self.messages = messages
                return {"request_id": "fixture-request", "response": completion()}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.prepare_fixture(root / "run")
            client = FakeClient()
            run_batch(root / "run", "fixture", root / "out", "vision-model", client=client)
            bundle = json.loads((root / "out/handoff.json").read_text())
            self.assertEqual(bundle["extraction_run"]["actual_model"], "actual-vision-model")
            self.assertTrue((root / "out/raw-response.json").exists())
            parts = client.messages[1]["content"]
            self.assertTrue(any(p["type"] == "image_url" for p in parts))

    def test_invalid_model_output_keeps_raw_response_without_handoff(self):
        class FakeClient:
            api_key = "fixture"

            def complete(self, messages, model):
                return {"request_id": "fixture-request", "response": completion(content="invalid JSON")}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.prepare_fixture(root / "run")
            with self.assertRaises(NicrronError):
                run_batch(root / "run", "fixture", root / "out", "vision-model", client=FakeClient())
            self.assertTrue((root / "out/raw-response.json").exists())
            self.assertFalse((root / "out/handoff.json").exists())
            self.assertEqual(json.loads((root / "out/status.json").read_text())["status"], "failed_requires_review")
