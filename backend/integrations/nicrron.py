"""Nicrron sponsor gateway client for image-based evidence extraction."""

import json
import os
import re
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "https://api.nicrron.ai/v1"
DEFAULT_VISION_MODEL = "openai/gpt-4.1"


class NicrronError(RuntimeError):
    """Sanitized gateway failure; never includes request headers or credentials."""

    def __init__(self, message, details=None):
        super().__init__(message)
        self.details = details or {}


class NicrronClient:
    def __init__(self, api_key=None, timeout=120):
        if api_key is None:
            api_key = os.environ.get("NICRRON_API_KEY", "").strip()
            if not api_key:
                filename = os.environ.get("NICRRON_API_KEY_FILE")
                if filename:
                    api_key = Path(filename).expanduser().read_text(encoding="utf-8").strip()
        self.api_key = (api_key or "").strip()
        self.timeout = timeout

    def complete(self, messages, model=None, max_tokens=12000):
        if not self.api_key:
            raise NicrronError("Set NICRRON_API_KEY or NICRRON_API_KEY_FILE in the backend environment.")
        model = model or os.environ.get("NICRRON_VISION_MODEL", DEFAULT_VISION_MODEL)
        if model.startswith("nicrron/"):
            raise ValueError("Pin a vision-capable model for extraction; generic routing may select a text-only model.")
        body = {"model": model, "messages": messages, "max_tokens": max_tokens,
                "response_format": {"type": "json_object"}, "stream": False}
        request = Request(BASE_URL + "/chat/completions", data=json.dumps(body).encode(),
                          headers={"Authorization": "Bearer " + self.api_key,
                                   "Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=self.timeout) as response:
                payload = json.load(response)
                request_id = response.headers.get("x-request-id")
                cache = response.headers.get("x-nicrron-cache")
        except HTTPError as exc:
            raw = exc.read(16000).decode("utf-8", errors="replace").replace(self.api_key, "[REDACTED]")
            try:
                error = json.loads(raw).get("error", {})
                detail = str(error.get("message", error) if isinstance(error, dict) else error)[:2000]
            except (ValueError, AttributeError):
                detail = raw[:2000]
            details = {"http_status": exc.code, "message": detail,
                       "request_id": exc.headers.get("x-request-id") if exc.headers else None}
            raise NicrronError(f"Nicrron HTTP {exc.code}: {detail or 'no error body'}", details) from None
        except (URLError, OSError, TimeoutError):
            raise NicrronError("Nicrron network request failed; no automatic retry was made.") from None
        except (ValueError, UnicodeError):
            raise NicrronError("Nicrron returned invalid JSON.") from None
        if not isinstance(payload, dict):
            raise NicrronError("Nicrron returned an unexpected response type.")
        return {"gateway": "nicrron", "endpoint": BASE_URL + "/chat/completions",
                "requested_model": model, "request_id": request_id or payload.get("id"),
                "cache": cache, "response": payload}


def parse_extraction_response(record):
    """Do not silently accept truncated, refused or non-JSON completions."""
    try:
        choice = record["response"]["choices"][0]
        if choice.get("finish_reason") != "stop":
            raise NicrronError("Model did not finish normally; inspect saved raw response before retrying.")
        content = choice["message"]["content"]
        if not isinstance(content, str):
            raise NicrronError("Model returned no JSON text; inspect saved raw response.")
        fenced = re.fullmatch(r"\s*```(?:json)?\s*\n(.*?)\n```\s*", content, re.DOTALL)
        result = json.loads(fenced.group(1) if fenced else content)
    except (KeyError, IndexError, TypeError, ValueError):
        raise NicrronError("Model output is not a JSON extraction; inspect saved raw response.") from None
    return result
