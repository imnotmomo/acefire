"""Validate model output against original PDF text and export a B-to-C bundle."""

import argparse
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from .models import Extraction
from .prepare_circle import ROOT, sha256, write_json
from .source import source_metadata, verify_original_representation


def normalize(text):
    # PDF/vision extraction may render quotation marks differently; retain all
    # words, digits and redaction markers. Never tolerate omissions/paraphrases.
    text = unicodedata.normalize("NFKC", text).translate(str.maketrans({
        "“": "'", "”": "'", "‘": "'", "’": "'", '"': "'"}))
    return re.sub(r"\s+", "", text)


def validate_claims(payload, registry, packet, model):
    payload = Extraction.model_validate(payload).model_dump()
    source = source_metadata(registry)
    verify_original_representation(source)
    native = json.loads(Path(source["native_blocks_file"]).read_text()) if source.get("native_blocks_file") else None
    # Reload the original: a modified packet must not validate invented quotations.
    from pypdf import PdfReader
    if sha256(ROOT / source["file_path"]) != source["sha256"] or packet["source_sha256"] != source["sha256"]:
        raise ValueError("Source hash mismatch; prepare a new extraction packet.")
    reader = PdfReader(ROOT / source["file_path"])
    pages = {p["physical_page"]: p for p in packet["pages"]}
    entities = {e["entity_id"] for e in registry["entities"]}
    claims, evidence = [], []
    for item in payload["claims"]:
        if item["subject_entity_id"] is not None and item["subject_entity_id"] not in entities:
            raise ValueError("Unknown entity ID")
        evidence_ids = []
        if item.get("numeric"):
            raw = normalize(item["numeric"]["raw_value"])
            pattern = r"(?<![\d.,])" + re.escape(raw) + r"(?!\d|[.,]\d)"
            if not any(re.search(pattern, normalize(s["quote"])) for s in item["evidence"]):
                raise ValueError("Numeric raw_value is not a complete token in source quotes")
        for support in item["evidence"]:
            n = support["physical_page"]
            lo, hi = source["physical_page_range"]
            if n not in pages or not lo <= n <= hi or n in source.get("excluded_evidence_pages", []) or pages.get(n, {}).get("page_role") == "contents":
                raise ValueError(f"Unsupported page (outside document or table of contents): {n}")
            original_text = reader.pages[n - 1].extract_text() or ""
            if normalize(support["quote"]) not in normalize(original_text):
                raise ValueError(f"Quote not found on original PDF page {n}; requires review")
            key = f"{source['sha256']}:{n}:{normalize(support['quote'])}"
            if "document" in registry:
                key = source["file_id"] + ":" + key
            eid = "evidence_" + hashlib.sha256(key.encode()).hexdigest()[:20]
            evidence_ids.append(eid)
            evidence.append({"evidence_id": eid, "file_id": source["file_id"],
                             "source_id": source["source_id"], "quote": support["quote"],
                             "locator": {"physical_page": n, "section": support["section"]},
                             "source_sha256": source.get("original_sha256", source["sha256"]),
                             "source_url": source["source_url"],
                             "publication_date": source["publication_date"],
                             "local_viewer_target": source["file_path"] + f"#page={n}",
                             "location_status": "quote_located_in_pdf_text"})
            evidence[-1]["quote_match_rule"] = "NFKC_whitespace_quote_typography_v1"
            if native is not None:
                matches = [block["locator"] for block in native["blocks"]
                           if normalize(support["quote"]) in normalize(block["text"])]
                evidence[-1].update(representation_sha256=source["sha256"],
                                    representation_kind="converted_pdf",
                                    original_file_path=source["original_file_path"],
                                    original_locator_origin=source["original_locator_origin"],
                                    original_locators=matches[:20],
                                    original_locator_status="unique" if len(matches) == 1 else
                                    ("ambiguous" if matches else "requires_native_location_review"),
                                    original_locator_match_count=len(matches))
        subject_key = item["subject_entity_id"] or {"unresolved_name": item["subject_entity_name"]}
        key = json.dumps([subject_key, item["claim_type"], item["statement"], sorted(evidence_ids), item.get("numeric")], ensure_ascii=False)
        cid = "claim_" + hashlib.sha256(key.encode()).hexdigest()[:20]
        claims.append({**{k: v for k, v in item.items() if k != "evidence"},
                       "claim_id": cid, "deal_id": registry["deal"]["deal_id"],
                       "evidence_ids": evidence_ids, "extraction_method": "model_output_import",
                       "entity_resolution_status": "known_id" if item["subject_entity_id"] else "unresolved",
                       "model": model, "verification_status": "source_located_requires_semantic_review"})
    return {"schema_version": registry["schema_version"], "created_at": datetime.now(timezone.utc).isoformat(),
            "deal": registry["deal"], "entities": registry["entities"],
            "claims": list({c["claim_id"]: c for c in claims}.values()),
            "evidence": list({e["evidence_id"]: e for e in evidence}.values()),
            "open_questions": payload["open_questions"],
            "limitations": ["Quote checks validate location, not semantic entailment or factual truth.",
                            "B-side handoff draft; not yet written to C's shared database."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--response", type=Path, required=True)
    parser.add_argument("--model", required=True, help="Actual model/provider version used")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Output already exists; choose a new bundle path.")
    bundle = validate_claims(json.loads(args.response.read_text()),
                             json.loads((args.run / "registry.json").read_text()),
                             json.loads((args.run / "packet.json").read_text()), args.model)
    bundle["model_response_sha256"] = sha256(args.response)
    write_json(args.output, bundle)
    print(f"Saved {len(bundle['claims'])} claims and {len(bundle['evidence'])} evidence records: {args.output}")


if __name__ == "__main__":
    main()
