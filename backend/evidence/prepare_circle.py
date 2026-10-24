"""Register Circle sources and prepare images for multimodal contract extraction."""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CASE = ROOT / "data/additional-cases/circle-2025-ipo"
SOURCE_ID = "circle_s1_20250401_with_exhibits"
CONTRACT_ID = "circle_coinbase_collaboration_20230818"
DEAL_ID = "circle-2025-ipo"
FIRST, LAST = 350, 392


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def register(case=CASE):
    provenance = json.loads((case / "provenance.json").read_text())
    files = []
    for item in provenance["files"]:
        path = case / item["path"]
        actual = sha256(path)
        if actual != item["sha256"] or path.stat().st_size != item["bytes"]:
            raise ValueError(f"Source integrity mismatch: {item['path']}")
        files.append({"file_id": "file_" + hashlib.sha256(item["path"].encode()).hexdigest()[:16],
                      "path": str(path.relative_to(ROOT)), "sha256": actual,
                      "bytes": path.stat().st_size, "integrity_status": "matches_manifest"})
    source = next(s for s in provenance["sources"] if s["id"] == SOURCE_ID)
    contract = next(s for s in provenance["sources"] if s["id"] == CONTRACT_ID)
    file = next(f for f in files if f["path"] == str((case / source["relative_path"]).relative_to(ROOT)))
    snapshots = []
    for path in sorted((ROOT / "data/akta").glob("*.json")):
        record = json.loads(path.read_text())
        profile = record.get("response", {}).get("data", {})
        firm = profile.get("firmographic", {})
        snapshots.append({"path": str(path.relative_to(ROOT)), "sha256": sha256(path),
                          "provider_uuid": profile.get("uuid"), "legal_name": firm.get("legal_name"),
                          "website": firm.get("website"),
                          "retrieved_at": record.get("received_at", record.get("fetched_at")),
                          "mode": "existing_snapshot", "identity_status": "candidate_requires_review",
                          "historical_case_evidence": False})
    return {
        "schema_version": "b-handoff-draft-v1", "created_at": datetime.now(timezone.utc).isoformat(),
        "deal": {"deal_id": DEAL_ID, "name": "Circle", "website": "circle.com",
                 "historical_cutoff": provenance["historical_case_cutoff"]},
        "entities": [
            {"entity_id": "circle_issuer", "legal_name": provenance["legal_entity"], "role": "issuer"},
            {"entity_id": "circle_contracting", "legal_name": "Circle Internet Financial, LLC", "role": "contracting_party"},
            {"entity_id": "coinbase_contracting", "legal_name": "Coinbase Global, Inc.", "role": "contracting_party"}],
        "files": files, "sources": provenance["sources"], "akta_snapshots": snapshots,
        "contract": {"source_id": CONTRACT_ID, "parent_source_id": SOURCE_ID,
                     "file_id": file["file_id"], "file_path": file["path"], "sha256": file["sha256"],
                     "source_url": contract["source_url"], "publication_date": contract["publication_date"],
                     "effective_date": contract["effective_date"], "physical_page_range": [FIRST, LAST],
                     "excluded_evidence_pages": [351, 352], "document_type": "contract"},
        "storage_status": "local_json_not_shared_database",
        "limitations": ["Field names are a B-side draft pending agreement with C.",
                        "Source manifest integrity is not independent factual verification.",
                        "Issuer and contracting parties remain distinct; corporate relationship is not inferred."]}


def prepare(output, scale=1.5):
    from pypdf import PdfReader
    import pypdfium2 as pdfium
    if output.exists():
        raise ValueError("Output already exists; select a new directory to preserve previous runs.")
    registry = register()
    path = ROOT / registry["contract"]["file_path"]
    reader = PdfReader(path)
    if len(reader.pages) < LAST:
        raise ValueError("Source is shorter than the registered contract range.")
    first_text = reader.pages[FIRST - 1].extract_text() or ""
    if "COLLABORATION AGREEMENT" not in first_text:
        raise ValueError("Contract cover does not match expected physical page.")
    output.mkdir(parents=True)
    pages = []
    doc = pdfium.PdfDocument(path)
    try:
        for n in range(FIRST, LAST + 1):
            image_path = output / "pages" / f"page-{n:04d}.png"
            image_path.parent.mkdir(exist_ok=True)
            page = doc[n - 1]
            bitmap = page.render(scale=scale)
            try:
                bitmap.to_pil().save(image_path)
            finally:
                bitmap.close()
                page.close()
            text = reader.pages[n - 1].extract_text() or ""
            pages.append({"physical_page": n, "image": str(image_path.relative_to(output)),
                          "image_sha256": sha256(image_path), "text": text,
                          "contains_redaction_marker": "[*****]" in text,
                          "page_role": "contents" if n in (351, 352) else "source"})
    finally:
        doc.close()
    batches = []
    for start in range(FIRST, LAST + 1, 5):
        end = min(start + 4, LAST)
        batches.append({"batch_id": f"pages-{start}-{end}", "target_pages": list(range(start, end + 1)),
                        "context_pages": list(range(max(FIRST, start - 1), min(LAST, end + 1) + 1))})
    write_json(output / "registry.json", registry)
    write_json(output / "packet.json", {"deal_id": DEAL_ID, "file_id": registry["contract"]["file_id"],
                                       "source_sha256": registry["contract"]["sha256"],
                                       "extraction_status": "prepared_not_model_extracted",
                                       "pages": pages, "batches": batches})
    return {"output": str(output.resolve()), "registered_files": len(registry["files"]),
            "prepared_pages": len(pages), "batches": len(batches), "model_called": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "runtime/circle-contract-v1")
    args = parser.parse_args()
    print(json.dumps(prepare(args.output), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
