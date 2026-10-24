"""Fetch only the fixed public SEC source documents for this case.

No source scripts are executed. Stop after any HTTP access denial.
"""
import datetime
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
SOURCES = [
    {
        "id": "circle_s1a_20250527",
        "filename": "d737521ds1a.htm",
        "url": "https://www.sec.gov/Archives/edgar/data/1876042/000119312525126208/d737521ds1a.htm",
        "title": "Circle Internet Group, Inc. S-1/A Amendment No. 3",
        "filing_accession": "0001193125-25-126208",
        "filing_date": "2025-05-27",
        "effective_date": None,
        "redacted": False,
    },
    {
        "id": "circle_coinbase_collaboration_20230818",
        "filename": "d737521dex101.htm",
        "url": "https://www.sec.gov/Archives/edgar/data/1876042/000119312525070481/d737521dex101.htm",
        "title": "Circle-Coinbase Collaboration Agreement, Exhibit 10.1",
        "filing_accession": "0001193125-25-070481",
        "filing_date": None,
        "effective_date": "2023-08-18",
        "redacted": True,
    },
    {
        "id": "circle_coinbase_ecosystem_20241114",
        "filename": "d737521dex102.htm",
        "url": "https://www.sec.gov/Archives/edgar/data/1876042/000119312525070481/d737521dex102.htm",
        "title": "Circle-Coinbase Stablecoin Ecosystem Agreement, Exhibit 10.2",
        "filing_accession": "0001193125-25-070481",
        "filing_date": None,
        "effective_date": "2024-11-14",
        "redacted": True,
    },
]

results = []
halted = False
for source in SOURCES:
    item = dict(source)
    path = ROOT / source["filename"]
    if halted:
        item.update(status="not_attempted_after_access_denial")
        results.append(item)
        continue
    if path.exists():
        item.update(status="existing_file_preserved", sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        results.append(item)
        continue
    try:
        with urllib.request.urlopen(source["url"], timeout=45) as response:
            payload = response.read(30_000_001)
            if len(payload) > 30_000_000:
                raise ValueError("Unexpected source size above 30 MB limit")
            if b"<html" not in payload[:10000].lower():
                raise ValueError("Response not identified as HTML")
            if b"undeclared automated tool" in payload.lower() or b"request rate threshold exceeded" in payload.lower():
                raise PermissionError("SEC access/rate-limit page, source not saved")
            path.write_bytes(payload)
            item.update(
                status="downloaded_original",
                bytes=len(payload),
                sha256=hashlib.sha256(payload).hexdigest(),
                fetched_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                final_url=response.url,
                content_type=response.headers.get("Content-Type"),
            )
    except urllib.error.HTTPError as error:
        item.update(status="http_error", http_status=error.code, error=str(error))
        halted = error.code in (401, 403, 429)
    except PermissionError as error:
        item.update(status="access_denied", error=str(error))
        halted = True
    except Exception as error:
        item.update(status="error", error=repr(error))
    results.append(item)

log = {
    "case_id": "circle-2025-ipo",
    "downloaded_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "halted_after_access_denial": halted,
    "sources": results,
}
(ROOT / "download_results.json").write_text(json.dumps(log, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"sources": [{"id": x["id"], "status": x["status"], "bytes": x.get("bytes")} for x in results], "halted": halted}))
