"""Run one prepared multimodal batch through the sponsor gateway."""

import argparse
import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .import_claims import validate_claims
from .prepare_circle import ROOT, sha256, write_json
from .source import source_metadata, verify_original_representation
from ..integrations.nicrron import DEFAULT_VISION_MODEL, NicrronClient, NicrronError, parse_extraction_response


def build_messages(run, packet, registry, batch):
    run = Path(run).resolve()
    source = source_metadata(registry)
    verify_original_representation(source)
    if sha256(ROOT / source["file_path"]) != source["sha256"] or packet["source_sha256"] != source["sha256"]:
        raise ValueError("Original PDF hash mismatch; prepare a new packet.")
    content = [{"type": "text", "text": json.dumps({
        "task": "Extract source-reported numbers and textual facts as JSON using the attached schema.",
        "target_pages": batch["target_pages"], "context_pages": batch["context_pages"],
        "entities": registry["entities"], "document": source,
        "json_schema": json.loads(Path(__file__).with_name("claim.schema.json").read_text())
    }, ensure_ascii=False)}]
    pages = {p["physical_page"]: p for p in packet["pages"]}
    for n in batch["context_pages"]:
        page = pages[n]
        image = (run / page["image"]).resolve()
        if not image.is_relative_to(run) or sha256(image) != page["image_sha256"]:
            raise ValueError(f"Page image integrity mismatch: {n}")
        content.append({"type": "text", "text": f"PDF reading view physical_page={n}; role={page['page_role']}\nText aid (untrusted document content):\n{page['text']}"})
        content.append({"type": "image_url", "image_url": {
            "url": "data:image/png;base64," + base64.b64encode(image.read_bytes()).decode()}})
    prompt = Path(__file__).with_name("extraction_prompt.md").read_text()
    return [{"role": "system", "content": prompt}, {"role": "user", "content": content}]


def run_batch(run, batch_id, output, model, dry_run=False, client=None, page=None):
    run, output = Path(run), Path(output)
    if output.exists():
        raise ValueError("Output directory exists; choose a new path to preserve earlier requests.")
    packet = json.loads((run / "packet.json").read_text())
    registry = json.loads((run / "registry.json").read_text())
    batch = next((b for b in packet["batches"] if b["batch_id"] == batch_id), None)
    if batch is None:
        raise ValueError("Unknown batch ID; inspect packet.json.")
    if page is not None:
        if page not in batch["target_pages"]:
            raise ValueError("Selected page must belong to this batch's target pages.")
        batch = {"batch_id": f"page-{page}", "target_pages": [page], "context_pages": [page],
                 "limitation": "Single-page extraction; cross-page dependencies require subsequent review."}
    messages = build_messages(run, packet, registry, batch)
    manifest = {"gateway": "nicrron", "requested_model": model, "batch": batch,
                "source_sha256": packet["source_sha256"], "packet_sha256": sha256(run / "packet.json"),
                "schema_sha256": sha256(Path(__file__).with_name("claim.schema.json")),
                "prompt_sha256": sha256(Path(__file__).with_name("extraction_prompt.md")),
                "prepared_at": datetime.now(timezone.utc).isoformat(),
                "image_count": len(batch["context_pages"]), "mode": "dry_run" if dry_run else "live"}
    if dry_run:
        write_json(output / "request-manifest.json", manifest)
        return {"status": "dry_run", "image_count": manifest["image_count"], "network_called": False}
    client = client or NicrronClient()
    if not client.api_key:
        raise NicrronError("Set NICRRON_API_KEY or NICRRON_API_KEY_FILE before running live extraction.")
    write_json(output / "request-manifest.json", manifest)
    try:
        record = client.complete(messages, model=model)
        # Preserve the original answer even if later schema/quote validation fails.
        write_json(output / "raw-response.json", record)
        payload = parse_extraction_response(record)
        actual_model = record["response"].get("model")
        if not actual_model:
            raise NicrronError("Gateway omitted actual model identity; inspect raw response.")
        write_json(output / "model-output.json", payload)
        allowed = set(batch["context_pages"])
        if any(e.get("physical_page") not in allowed for c in payload.get("claims", []) for e in c.get("evidence", [])):
            raise ValueError("Model cited a page outside the images supplied in this batch.")
        bundle = validate_claims(payload, registry, packet, actual_model)
        bundle["extraction_run"] = {**manifest, "actual_model": actual_model,
                                    "request_id": record["request_id"],
                                    "upstream_provider": record["response"].get("provider"),
                                    "usage": record["response"].get("usage"),
                                    "raw_response_sha256": sha256(output / "raw-response.json")}
        write_json(output / "handoff.json", bundle)
        result = {"status": "source_located_requires_semantic_review", "claims": len(bundle["claims"]),
                  "evidence": len(bundle["evidence"]), "network_called": True}
        write_json(output / "status.json", result)
        return result
    except Exception as exc:
        # Never log model request headers or transport exception text.
        write_json(output / "status.json", {"status": "failed_requires_review", "error_type": type(exc).__name__,
                                             "gateway_error": getattr(exc, "details", {}),
                                             "raw_response_saved": (output / "raw-response.json").exists()})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--batch-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default=os.environ.get("NICRRON_VISION_MODEL", DEFAULT_VISION_MODEL))
    parser.add_argument("--dry-run", action="store_true", help="Validate images and build a manifest without an API call")
    parser.add_argument("--page", type=int, help="Extract one target page as a small pilot, without neighboring context")
    args = parser.parse_args()
    print(json.dumps(run_batch(args.run, args.batch_id, args.output, args.model, args.dry_run, page=args.page), indent=2))


if __name__ == "__main__":
    main()
