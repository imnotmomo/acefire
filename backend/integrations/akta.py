"""Download company evidence: python -m backend.integrations.akta --company circle.com."""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ENDPOINT = "https://api.akta.pro/api/v1/company/enrichment/"
DEFAULT_SECTIONS = ("firmographic", "location", "product_offering", "industry")
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "data" / "akta"


class AktaError(RuntimeError):
    """A provider failure safe to expose without request credentials."""


def validate_payload(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict) or not payload["data"]:
        raise AktaError("Akta returned no company object; check company identity and provider response.")
    if payload.get("success") is False or payload.get("error"):
        raise AktaError("Akta reported an application error; no company evidence saved.")
    return payload


def save_snapshot(record, output_dir=DEFAULT_OUTPUT):
    """Preserve provider bytes as JSON evidence, never overwrite an earlier snapshot."""
    validate_payload(record.get("response"))
    company = str(record.get("request_parameters", {}).get("company", "company"))
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", company).strip("_")[:80] or "company"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{slug}_{stamp}.json"
    with path.open("x", encoding="utf-8") as handle:
        json.dump(record, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return path


class AktaClient:
    def __init__(self, api_key=None, timeout=120):
        if api_key is None:
            api_key = os.environ.get("AKTA_API_KEY", "").strip()
            if not api_key:
                configured_file = os.environ.get("AKTA_API_KEY_FILE")
                root = Path(__file__).resolve().parents[2]
                candidates = [Path(configured_file).expanduser()] if configured_file else [
                    root / ".akta_api_key", root.parent / ".akta_api_key",
                ]
                for path in candidates:
                    if path.is_file():
                        api_key = path.read_text(encoding="utf-8").strip()
                        if api_key:
                            break
        self.api_key = (api_key or "").strip()
        self.timeout = timeout

    def fetch_company(self, company, sections=DEFAULT_SECTIONS):
        """One explicit API request; no automatic credit-consuming retries.

        company is a provider-supported company name, website or identifier.
        A name match is a candidate identity, not independent verification.
        """
        company = company.strip()
        if isinstance(sections, str):
            sections = sections.split(",")
        sections = tuple(dict.fromkeys(s.strip() for s in sections if s.strip()))
        if not company or not sections:
            raise ValueError("Company and sections must not be empty.")
        if not self.api_key:
            raise AktaError("Set AKTA_API_KEY or configure a local .akta_api_key file.")
        params = {"company": company, "sections": ",".join(sections)}
        request = Request(ENDPOINT + "?" + urlencode(params), headers={"x-api-key": self.api_key})
        started = datetime.now(timezone.utc).isoformat()
        try:
            with urlopen(request, timeout=self.timeout) as response:
                status = response.status
                payload = json.load(response)
        except HTTPError as exc:
            raise AktaError(f"Akta HTTP {exc.code}; check credentials, quota and company input.") from None
        except (URLError, TimeoutError, OSError):
            raise AktaError("Akta network request failed; retry explicitly if needed.") from None
        except (ValueError, UnicodeError):
            raise AktaError("Akta returned invalid JSON; no evidence saved.") from None
        validate_payload(payload)
        return {
            "provider": "akta.pro",
            "endpoint": ENDPOINT,
            "requested_at": started,
            "received_at": datetime.now(timezone.utc).isoformat(),
            "request_parameters": params,
            "http_status": status,
            "identity_status": "provider_match_unverified",
            "response": payload,
        }

    def download_company(self, company, sections=DEFAULT_SECTIONS, output_dir=DEFAULT_OUTPUT):
        return save_snapshot(self.fetch_company(company, sections), output_dir)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--company", help="Company name, website or provider identifier")
    source.add_argument("--import-snapshot", type=Path, help="Import an existing response without an API call")
    parser.add_argument("--sections", default=",".join(DEFAULT_SECTIONS))
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        if args.import_snapshot:
            raw = args.import_snapshot.read_bytes()
            record = json.loads(raw)
            if record.get("provider") != "akta.pro":
                raise AktaError("Snapshot must identify akta.pro as its provider.")
            record["imported_at"] = datetime.now(timezone.utc).isoformat()
            record["imported_source_sha256"] = hashlib.sha256(raw).hexdigest()
            record.setdefault("identity_status", "provider_match_unverified")
            path = save_snapshot(record, args.output_dir)
        else:
            path = AktaClient().download_company(args.company, args.sections, args.output_dir)
    except (AktaError, ValueError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    print(f"Saved: {path.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
