import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from integrations.nicrron import NicrronClient, NicrronError, parse_extraction_response


def completion(content='{"claims": [], "open_questions": []}', finish="stop"):
    return {"id": "request-test", "model": "actual-vision-model", "provider": "test-provider",
            "choices": [{"message": {"content": content}, "finish_reason": finish}],
            "usage": {"total_tokens": 10}}


class Response(io.BytesIO):
    headers = {"x-request-id": "header-request", "x-nicrron-cache": "MISS"}


class NicrronTests(unittest.TestCase):
    @patch("integrations.nicrron.urlopen")
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

    @patch("integrations.nicrron.urlopen")
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
