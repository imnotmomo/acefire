"""Unified PDF / Word / PowerPoint ingestion, with optional Nicrron extraction."""

import argparse
import json
import os
from pathlib import Path

from .prepare_pdf import prepare_pdf
from .prepare_office import prepare_office
from .prepare_circle import write_json
from .process_contract import process_prepared
from ..integrations.nicrron import DEFAULT_VISION_MODEL, NicrronClient, NicrronError

SUPPORTED = (".pdf", ".docx", ".pptx", ".doc", ".ppt")


def ingest_document(file, deal_id, output, *, extract=False, model=DEFAULT_VISION_MODEL, workers=2, **options):
    file, output = Path(file).expanduser().resolve(), Path(output).expanduser().resolve()
    if file.suffix.lower() not in SUPPORTED:
        raise ValueError("Supported formats: PDF, DOCX, PPTX, DOC and PPT")
    if extract and not NicrronClient().api_key:
        raise NicrronError("Configure NICRRON_API_KEY or NICRRON_API_KEY_FILE before --extract")
    if file.suffix.lower() == ".pdf":
        summary = prepare_pdf(file, deal_id, output, **options)
        prepared_run = output
    else:
        summary = prepare_office(file, deal_id, output, **options)
        prepared_run = Path(summary["prepared_run"])
    status = {"status": "prepared_not_model_extracted", "source_format": file.suffix.lower()[1:],
              "prepared_run": str(prepared_run), "preparation": summary, "network_called": False}
    write_json(output / "job-status.json", status)
    if extract:
        result = process_prepared(prepared_run, output / "results", model, workers)
        status.update(status="processed_requires_review" if result["coverage"]["all_batches_processed"] else "partial_failure",
                      extraction=result, network_called=True)
        write_json(output / "job-status.json", status)
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, required=True)
    parser.add_argument("--deal-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--company-name")
    parser.add_argument("--entities", type=Path)
    parser.add_argument("--first-page", type=int, default=1, help="PDF reading view page, also for rendered Office files")
    parser.add_argument("--last-page", type=int)
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--context-pages", type=int, default=1)
    parser.add_argument("--document-type", choices=("contract", "report", "pitch_deck", "other"), default="other")
    parser.add_argument("--source-url")
    parser.add_argument("--publication-date")
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--model", default=os.environ.get("NICRRON_VISION_MODEL", DEFAULT_VISION_MODEL))
    parser.add_argument("--workers", type=int, choices=(1, 2), default=2)
    args = parser.parse_args()
    entities = json.loads(args.entities.read_text()) if args.entities else []
    print(json.dumps(ingest_document(args.file, args.deal_id, args.output, extract=args.extract,
                                    model=args.model, workers=args.workers, company_name=args.company_name,
                                    entities=entities, first=args.first_page, last=args.last_page,
                                    batch_size=args.batch_size, context_pages=args.context_pages,
                                    document_type=args.document_type, source_url=args.source_url,
                                    publication_date=args.publication_date), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
