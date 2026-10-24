"""Process every prepared contract batch and retain per-claim validation failures."""

import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from .extract_nicrron import run_batch
from .import_claims import validate_claims
from .prepare_circle import write_json, sha256
from .source import source_metadata
from ..integrations.nicrron import DEFAULT_VISION_MODEL


def collect_batch(path, registry, packet):
    """Keep valid claims even when another claim in a response fails validation."""
    raw_path = path / "raw-response.json"
    payload_path = path / "model-output.json"
    manifest = json.loads((path / "request-manifest.json").read_text())
    batch = manifest["batch"]
    result = {"batch_id": batch["batch_id"], "target_pages": batch["target_pages"],
              "status": "failed", "claims": [], "evidence": [], "rejected": [], "open_questions": []}
    if not payload_path.exists() or not raw_path.exists():
        result["error"] = json.loads((path / "status.json").read_text()) if (path / "status.json").exists() else {"error": "No model output"}
        return result
    raw = json.loads(raw_path.read_text())
    payload = json.loads(payload_path.read_text())
    if not isinstance(payload, dict) or not isinstance(payload.get("claims"), list):
        result["error"] = {"error": "Malformed top-level extraction"}
        return result
    model = raw["response"].get("model")
    if not model:
        result["error"] = {"error": "Actual model identity missing"}
        return result
    provenance = {"gateway": "nicrron", "model": model, "requested_model": manifest["requested_model"],
                  "request_id": raw.get("request_id"), "usage": raw["response"].get("usage"),
                  "raw_response_sha256": sha256(raw_path), "manifest_sha256": sha256(path / "request-manifest.json")}
    questions = payload.get("open_questions", [])
    if not isinstance(questions, list) or not all(isinstance(q, str) for q in questions):
        result["error"] = {"error": "Malformed open_questions"}
        return result
    result["open_questions"] = questions
    result["provenance"] = provenance
    allowed = set(batch["context_pages"])
    target = set(batch["target_pages"])
    for index, item in enumerate(payload["claims"]):
        try:
            # Full schema and independent PDF quote checks still apply to each item.
            bundle = validate_claims({"claims": [item], "open_questions": []}, registry, packet, model)
            pages = {e["locator"]["physical_page"] for e in bundle["evidence"]}
            if not pages.issubset(allowed):
                raise ValueError("Evidence outside supplied pages")
            for claim in bundle["claims"]:
                claim["extraction_batch_ids"] = [batch["batch_id"]]
                claim["request_ids"] = [raw.get("request_id")]
                # Context pages are part of the same whole-contract source.
                # Retain located facts, but expose when the model extracted only
                # a neighbor rather than its assigned target pages.
                claim["batch_page_role"] = "target_supported" if pages.intersection(target) else "context_only"
            result["claims"].extend(bundle["claims"])
            result["evidence"].extend(bundle["evidence"])
        except (ValueError, TypeError, KeyError) as exc:
            # Store model output and reason as review material, never as validated evidence.
            result["rejected"].append({"index": index, "claim": item,
                                       "reason": str(exc)[:1800], "batch_id": batch["batch_id"]})
    result["status"] = "processed_with_review_items" if result["rejected"] else "source_located_requires_semantic_review"
    return result


def aggregate(results, registry, expected_pages):
    claims, evidence, questions, rejected = {}, {}, [], []
    batches, covered = [], set()
    for result in sorted(results, key=lambda r: r["target_pages"][0]):
        if result["status"] != "failed":
            covered.update(result["target_pages"])
        for e in result["evidence"]:
            evidence[e["evidence_id"]] = e
        for claim in result["claims"]:
            # Exact dedup only; never merge distinct conditions based on a similar topic.
            subject_key = claim["subject_entity_id"] or {"unresolved_name": claim.get("subject_entity_name")}
            key = json.dumps([subject_key, claim["claim_type"], claim["statement"], sorted(claim["evidence_ids"]), claim.get("numeric")], sort_keys=True)
            if key in claims:
                for field in ("extraction_batch_ids", "request_ids"):
                    claims[key][field] = sorted(set(claims[key][field] + claim[field]))
            else:
                claims[key] = claim
        questions.extend(result["open_questions"])
        rejected.extend(result["rejected"])
        batches.append({k: v for k, v in result.items() if k not in ("claims", "evidence", "rejected", "open_questions")})
    expected = set(expected_pages)
    return {"schema_version": registry["schema_version"], "created_at": datetime.now(timezone.utc).isoformat(),
            "deal": registry["deal"], "entities": registry["entities"],
            ("document" if "document" in registry else "contract"): source_metadata(registry),
            "claims": list(claims.values()), "evidence": list(evidence.values()),
            "open_questions": list(dict.fromkeys(questions)), "rejected_claims": rejected,
            "coverage": {"expected_pages": sorted(expected), "model_processed_target_pages": sorted(covered),
                         "failed_target_pages": sorted(expected - covered),
                         "pages_with_located_claims": sorted({e["locator"]["physical_page"] for e in evidence.values()}),
                         "all_batches_processed": expected == covered,
                         "meaning": "Processing coverage only; not exhaustive clause extraction or semantic verification."},
            "batches": batches,
            "limitations": ["Every accepted claim still requires semantic review, including conditions, exceptions and entity roles.",
                            "Redactions, definitions and referenced agreements may prevent interpretation; never fill unknown values.",
                            "Statements are source-time observations; current truth or effectiveness and later amendments are unverified.",
                            "No calculations, investment conclusions or shared database writes performed.",
                            "Only identical statements with identical evidence are deduplicated; related claims remain separate."]}


def write_report(output, bundle):
    coverage = bundle["coverage"]
    document = bundle.get("document") or bundle.get("contract") or {}
    title = document.get("title") or bundle["deal"].get("name") or bundle["deal"].get("deal_id", "PDF")
    lines = [f"# {title}：文档处理记录", "",
             f"- PDF 读取视图范围：第 {min(coverage['expected_pages'])}–{max(coverage['expected_pages'])} 页。",
             f"- 模型处理目标页：{len(coverage['model_processed_target_pages'])}/{len(coverage['expected_pages'])}。",
             f"- 来源定位通过：{len(bundle['claims'])} 条 Claim、{len(bundle['evidence'])} 条 Evidence。",
             f"- 未通过提取校验：{len(bundle['rejected_claims'])} 条（见 review-items.json）。",
             f"- 未成功处理的目标页：{coverage['failed_target_pages']}。", "",
             "所有通过记录仍待语义复核；处理全部页面不代表每条条款均已完整提取或独立核实。", "",
             "## Claim 索引", "", "| 类型 | 实体 | PDF 读取视图页 | 内容 |", "| --- | --- | --- | --- |"]
    evidence = {e["evidence_id"]: e for e in bundle["evidence"]}
    for c in bundle["claims"]:
        pages = sorted({evidence[e]["locator"]["physical_page"] for e in c["evidence_ids"]})
        statement = c["statement"].replace("|", "\\|").replace("\n", " ")
        subject = (c["subject_entity_id"] or c.get("subject_entity_name") or "待确认").replace("|", "\\|")
        lines.append(f"| {c['claim_type']} | {subject} | {', '.join(map(str,pages))} | {statement} |")
    lines += ["", "## 待确认问题", ""] + [f"- {q}" for q in bundle["open_questions"]]
    (output / "REPORT.md").write_text("\n".join(lines) + "\n")


def process_prepared(run, output, model=DEFAULT_VISION_MODEL, workers=2, collect_only=False):
    run, output = Path(run), Path(output)
    if workers not in (1, 2):
        raise ValueError("Use one or two workers")
    packet = json.loads((run / "packet.json").read_text())
    registry = json.loads((run / "registry.json").read_text())
    if output.exists() and not collect_only:
        raise ValueError("Output exists; use a new run directory or --collect-only")
    if collect_only and not output.is_dir():
        raise ValueError("No existing run to collect")
    output.mkdir(parents=True, exist_ok=True)
    if not collect_only:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(run_batch, run, b["batch_id"], output / b["batch_id"], model): b
                       for b in packet["batches"]}
            for future in as_completed(futures):
                batch = futures[future]
                try:
                    result = future.result()
                    print(json.dumps({"batch": batch["batch_id"], **result}), flush=True)
                except Exception as exc:
                    print(json.dumps({"batch": batch["batch_id"], "status": "requires_review", "error_type": type(exc).__name__}), flush=True)
    results = []
    for batch in packet["batches"]:
        try:
            results.append(collect_batch(output / batch["batch_id"], registry, packet))
        except (OSError, ValueError, KeyError, TypeError) as exc:
            results.append({"batch_id": batch["batch_id"], "target_pages": batch["target_pages"],
                            "status": "failed", "claims": [], "evidence": [], "rejected": [],
                            "open_questions": [], "error": {"error_type": type(exc).__name__,
                            "message": "Missing or malformed batch artifacts; inspect the batch directory."}})
    expected = [p["physical_page"] for p in packet["pages"]]
    bundle = aggregate(results, registry, expected)
    write_json(output / "handoff.json", {k: v for k, v in bundle.items() if k != "rejected_claims"})
    write_json(output / "review-items.json", {"rejected_claims": bundle["rejected_claims"] , "open_questions": bundle["open_questions"]})
    write_json(output / "coverage.json", bundle["coverage"])
    write_report(output, bundle)
    return {"claims": len(bundle["claims"]), "evidence": len(bundle["evidence"]),
            "rejected": len(bundle["rejected_claims"]), "coverage": bundle["coverage"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default=DEFAULT_VISION_MODEL)
    parser.add_argument("--workers", type=int, choices=(1, 2), default=2)
    parser.add_argument("--collect-only", action="store_true", help="Revalidate saved batches without further API calls")
    args = parser.parse_args()
    print(json.dumps(process_prepared(args.run, args.output, args.model, args.workers, args.collect_only)), flush=True)


if __name__ == "__main__":
    main()
