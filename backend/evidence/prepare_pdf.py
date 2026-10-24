"""Prepare any local PDF for multimodal extraction, without making model calls."""

import argparse
import hashlib
import json
import re
import shutil
from datetime import date, datetime, timezone
from pathlib import Path

from .prepare_circle import sha256, write_json


def validate_entities(entities):
    if not isinstance(entities, list):
        raise ValueError("Entities must be a JSON list")
    ids = set()
    for entity in entities:
        if not isinstance(entity, dict) or not all(isinstance(entity.get(k), str) and entity[k].strip()
                                                  for k in ("entity_id", "legal_name")):
            raise ValueError("Each known entity needs nonempty entity_id and legal_name")
        if entity["entity_id"] in ids:
            raise ValueError("Entity IDs must be unique")
        ids.add(entity["entity_id"])
    return entities


def prepare_pdf(pdf, deal_id, output, *, company_name=None, entities=None, first=1, last=None,
                batch_size=5, context_pages=1, scale=1.5, source_url=None,
                publication_date=None, document_type="other"):
    from pypdf import PdfReader
    import pypdfium2 as pdfium

    pdf, output = Path(pdf).expanduser().resolve(), Path(output).expanduser().resolve()
    if not deal_id or not deal_id.strip():
        raise ValueError("deal_id must not be empty")
    if output.exists():
        raise ValueError("Output exists; choose a new run directory")
    if not pdf.is_file() or pdf.suffix.lower() != ".pdf":
        raise ValueError("Input must be an existing PDF file")
    with pdf.open("rb") as stream:
        if b"%PDF-" not in stream.read(1024):
            raise ValueError("Input does not contain a PDF header")
    if not 1 <= batch_size <= 10 or not 0 <= context_pages <= 2 or not 0.5 <= scale <= 3:
        raise ValueError("Use batch_size 1–10, context_pages 0–2 and scale 0.5–3")
    if publication_date is not None:
        if date.fromisoformat(publication_date).isoformat() != publication_date:
            raise ValueError("publication_date must use YYYY-MM-DD")
    entities = validate_entities([] if entities is None else entities)
    before = sha256(pdf)
    reader = PdfReader(pdf)
    if reader.is_encrypted:
        raise ValueError("Encrypted PDFs require an unlocked copy before ingestion")
    total = len(reader.pages)
    last = total if last is None else last
    if not 1 <= first <= last <= total:
        raise ValueError(f"Page range must be within 1–{total}")
    # Parse and render the original only after validating options. Preserve an
    # independent immutable-in-practice snapshot, never modify the input PDF.
    output.mkdir(parents=True)
    snapshot = output / "sources" / "original.pdf"
    snapshot.parent.mkdir()
    shutil.copyfile(pdf, snapshot)
    if sha256(snapshot) != before or sha256(pdf) != before:
        raise ValueError("Source changed during ingestion; discard this incomplete run and retry")
    identity = json.dumps([deal_id, str(pdf), source_url, before], ensure_ascii=False)
    file_id = "file_" + hashlib.sha256(identity.encode()).hexdigest()[:20]
    source_id = "source_" + file_id.removeprefix("file_")
    created_at = datetime.now(timezone.utc).isoformat()
    document = {"source_id": source_id, "file_id": file_id, "file_path": str(snapshot),
                "original_filename": pdf.name, "title": pdf.stem, "document_type": document_type,
                "sha256": before, "source_url": source_url, "publication_date": publication_date,
                "physical_page_range": [first, last], "total_pdf_pages": total,
                "excluded_evidence_pages": [], "metadata_status": "user_supplied_not_independently_verified"}
    registry = {"schema_version": "b-handoff-draft-v2", "created_at": created_at,
                "deal": {"deal_id": deal_id, "name": company_name or deal_id}, "entities": entities,
                "files": [{"file_id": file_id, "path": str(snapshot), "original_path": str(pdf),
                           "sha256": before, "bytes": snapshot.stat().st_size, "media_type": "application/pdf"}],
                "document": document, "sources": [document], "akta_snapshots": [],
                "storage_status": "local_json_not_shared_database",
                "limitations": ["Entity list and source metadata are user-supplied, not automatic identity verification.",
                                "Unknown entities stay unresolved; document extraction does not imply independent verification."]}
    pages = []
    # All later parsing uses the stored snapshot, not the original mutable path.
    reader = PdfReader(snapshot)
    doc = pdfium.PdfDocument(snapshot)
    try:
        for n in range(first, last + 1):
            text_error = None
            try:
                text = reader.pages[n - 1].extract_text() or ""
            except Exception as exc:
                text, text_error = "", type(exc).__name__
            image_path = output / "pages" / f"page-{n:04d}.png"
            image_path.parent.mkdir(exist_ok=True)
            page = doc[n - 1]
            bitmap = page.render(scale=scale)
            try:
                bitmap.to_pil().save(image_path)
            finally:
                bitmap.close()
                page.close()
            # Conservative heading detection only, never exclude arbitrary page numbers.
            heading = "\n".join(text.strip().splitlines()[:3])
            contents = bool(re.search(r"(?im)^\s*(?:table\s+of\s+contents|contents|目\s*录)\s*$", heading))
            if contents:
                document["excluded_evidence_pages"].append(n)
            pages.append({"physical_page": n, "image": str(image_path.relative_to(output)),
                          "image_sha256": sha256(image_path), "text": text,
                          "text_extraction_error": text_error, "text_available": bool(text.strip()),
                          "requires_visual_quote_review": not bool(text.strip()),
                          "contains_redaction_marker": "[*****]" in text,
                          "page_role": "contents" if contents else "source"})
    finally:
        doc.close()
    batches = []
    for start in range(first, last + 1, batch_size):
        end = min(start + batch_size - 1, last)
        batches.append({"batch_id": f"pages-{start}-{end}", "target_pages": list(range(start, end + 1)),
                        "context_pages": list(range(max(first, start - context_pages), min(last, end + context_pages) + 1))})
    write_json(output / "registry.json", registry)
    write_json(output / "packet.json", {"deal_id": deal_id, "file_id": file_id, "source_sha256": before,
                                       "extraction_status": "prepared_not_model_extracted", "pages": pages, "batches": batches})
    return {"output": str(output), "total_pdf_pages": total, "prepared_pages": len(pages),
            "batches": len(batches), "pages_without_text": [p["physical_page"] for p in pages if not p["text_available"]],
            "model_called": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--deal-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--company-name")
    parser.add_argument("--entities", type=Path, help="JSON list of known entities (entity_id, legal_name)")
    parser.add_argument("--first-page", type=int, default=1)
    parser.add_argument("--last-page", type=int)
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--context-pages", type=int, default=1)
    parser.add_argument("--document-type", choices=("contract", "report", "pitch_deck", "other"), default="other")
    parser.add_argument("--source-url")
    parser.add_argument("--publication-date")
    args = parser.parse_args()
    entities = json.loads(args.entities.read_text()) if args.entities else []
    print(json.dumps(prepare_pdf(args.pdf, args.deal_id, args.output, company_name=args.company_name,
                                entities=entities, first=args.first_page, last=args.last_page,
                                batch_size=args.batch_size, context_pages=args.context_pages,
                                source_url=args.source_url, publication_date=args.publication_date,
                                document_type=args.document_type), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
