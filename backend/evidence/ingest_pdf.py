"""General PDF entry point: prepare locally, optionally extract via Nicrron."""

import argparse
import json
import os
from pathlib import Path

from .prepare_pdf import prepare_pdf
from .prepare_circle import write_json
from .process_contract import process_prepared
from ..integrations.nicrron import DEFAULT_VISION_MODEL, NicrronClient, NicrronError


def ingest(pdf, deal_id, output, *, extract=False, model=DEFAULT_VISION_MODEL, workers=2, **options):
    output = Path(output).expanduser().resolve()
    if extract and not NicrronClient().api_key:
        raise NicrronError("Configure NICRRON_API_KEY or NICRRON_API_KEY_FILE before --extract")
    preparation = prepare_pdf(pdf, deal_id, output, **options)
    status = {"status": "prepared_not_model_extracted", "preparation": preparation, "network_called": False}
    write_json(output / "job-status.json", status)
    if extract:
        result = process_prepared(output, output / "results", model, workers)
        status = {"status": "processed_requires_review" if result["coverage"]["all_batches_processed"] else "partial_failure",
                  "preparation": preparation, "extraction": result, "network_called": True}
        write_json(output / "job-status.json", status)
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--deal-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--company-name")
    parser.add_argument("--entities", type=Path)
    parser.add_argument("--first-page", type=int, default=1)
    parser.add_argument("--last-page", type=int)
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--context-pages", type=int, default=1)
    parser.add_argument("--document-type", choices=("contract", "report", "pitch_deck", "other"), default="other")
    parser.add_argument("--source-url")
    parser.add_argument("--publication-date")
    parser.add_argument("--extract", action="store_true", help="Actually send the prepared PDF pages to Nicrron for extraction")
    parser.add_argument("--model", default=os.environ.get("NICRRON_VISION_MODEL", DEFAULT_VISION_MODEL))
    parser.add_argument("--workers", type=int, choices=(1, 2), default=2)
    args = parser.parse_args()
    entities = json.loads(args.entities.read_text()) if args.entities else []
    print(json.dumps(ingest(args.pdf, args.deal_id, args.output, extract=args.extract, model=args.model,
                           workers=args.workers, company_name=args.company_name, entities=entities,
                           first=args.first_page, last=args.last_page, batch_size=args.batch_size,
                           context_pages=args.context_pages, document_type=args.document_type,
                           source_url=args.source_url, publication_date=args.publication_date), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
