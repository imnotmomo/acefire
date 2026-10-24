#!/usr/bin/env python3
"""Inventory local case packets and provider exports without downloading or repairing.

Only manifest.json is written. Metadata and source files are untrusted data, never code.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent
EXPECTED_CASES = {"marqeta-2024", "circle-2025-ipo", "backerkit-2025-offering"}
EXPECTED_PROVIDERS = {"orbis-coverage": "Orbis", "pitchbook-coverage": "PitchBook"}
ROLES = ("original", "provider_export", "derived", "support", "unclassified")
SUPPORT_NAMES = {"README.md", "metadata.json", "verification.json", "download_results.json"}
SYSTEM_METADATA_NAMES = {".DS_Store"}
HASH_COLLECTIONS = {
    "local_files", "evidence_files", "export_files", "provider_exports",
    "provider_export_files", "original_files", "source_files", "files",
}
PATH_KEYS = ("relative_path", "path", "local_path", "saved_path")
issues: list[dict] = []


def issue(severity: str, code: str, packet: str, detail: str) -> None:
    issues.append({"severity": severity, "code": code, "packet": packet, "detail": detail})


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path, packet: str) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("top-level JSON value is not an object")
        return value
    except (OSError, ValueError) as error:
        issue("error", "invalid_json", packet, f"{path.name}: {error}")
        return None


def safe_path(base: Path, raw: object, packet: str) -> Path | None:
    if not isinstance(raw, str) or not raw or "\x00" in raw:
        issue("error", "invalid_local_path", packet, repr(raw))
        return None
    candidate = Path(raw)
    if ".." in candidate.parts:
        issue("error", "unsafe_local_path", packet, raw)
        return None
    candidate = candidate if candidate.is_absolute() else base / candidate
    resolved = candidate.resolve()
    if not resolved.is_relative_to(base.resolve()):
        issue("error", "path_outside_packet", packet, raw)
        return None
    if not resolved.is_file():
        issue("error", "missing_local_file", packet, raw)
        return None
    return resolved


def declarations(value: object, collection: str = ""):
    """Read explicit local-file records, including nested provider metadata schemas."""
    if isinstance(value, dict):
        if collection in HASH_COLLECTIONS and any(value.get(k) for k in PATH_KEYS):
            yield collection, value
        for key, child in value.items():
            yield from declarations(child, key if key in HASH_COLLECTIONS else collection)
    elif isinstance(value, list):
        for child in value:
            yield from declarations(child, collection)


def explicit_role(record: dict, collection: str) -> str | None:
    kind = str(record.get("kind") or record.get("source_kind") or record.get("role") or "").lower()
    if "readme" in kind or "metadata" in kind or "provenance" in kind or "verification" in kind:
        return "support"
    if record.get("is_provider_export") is True or "provider_export" in kind or collection in {
        "export_files", "provider_exports", "provider_export_files"
    }:
        return "provider_export"
    if any(record.get(key) is True for key in ("is_original", "original_document", "is_original_saved")):
        return "original"
    if "derived" in kind or "excerpt" in kind or "extraction" in kind or collection == "evidence_files":
        return "derived"
    return None


def source_records(metadata: dict) -> list[dict]:
    for key in ("sources", "source_list", "source_files"):
        values = metadata.get(key)
        if isinstance(values, list):
            return [x for x in values if isinstance(x, dict)]
    return []


def country_of(metadata: dict) -> str | None:
    for value in (
        metadata.get("country"),
        metadata.get("issuer", {}).get("country") if isinstance(metadata.get("issuer"), dict) else None,
        metadata.get("company_jurisdiction", {}).get("country") if isinstance(metadata.get("company_jurisdiction"), dict) else None,
    ):
        if isinstance(value, str):
            return value
    return None


def entity_keys(metadata: dict, sources: list[dict]) -> dict:
    issuer = metadata.get("issuer", {})
    if not isinstance(issuer, dict):
        issuer = {}
    keys = {
        "case_id": metadata.get("case_id"),
        "legal_entity": metadata.get("legal_entity") or issuer.get("legal_name") or metadata.get("company"),
        "brand": metadata.get("company_brand"),
        "cik": metadata.get("cik") or metadata.get("reference_cik"),
        "bvd_id": metadata.get("bvd_id") or metadata.get("bvd_id_number"),
        "pitchbook_id": metadata.get("pitchbook_id"),
    }
    if not keys["cik"]:
        for source in sources:
            match = re.search(r"sec\.gov/Archives/edgar/data/(\d+)/", str(source.get("source_url") or source.get("url") or ""))
            if match:
                keys["cik"] = match.group(1)
                keys["cik_basis"] = "SEC source URL; verify before using as a join"
                break
    if keys["cik"]:
        keys["cik"] = str(keys["cik"]).zfill(10)
    return {key: value for key, value in keys.items() if value is not None}


def evidence_dates(directory: Path, files: list[dict], packet: str) -> list[dict]:
    fields = {"period_start", "period_end", "as_of", "publication_date", "effective_date", "financial_statements_available_for_issue_date"}
    found = set()
    def scan(value: object, field: str = "") -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                scan(child, key)
        elif isinstance(value, list):
            for child in value:
                scan(child, field)
        elif field in fields and isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            found.add((field, value))
    result = []
    for file in files:
        if file["role"] != "derived" or not file["path"].endswith(".json") or file["bytes"] > 5_000_000:
            continue
        value = load_json(directory / file["path"], packet)
        if value is None:
            continue
        found.clear()
        scan(value)
        result.extend({"path": file["path"], "field": field, "date": date} for field, date in sorted(found))
    return result


def observation_inventory(directory: Path, files: list[dict], packet: str) -> list[dict]:
    """Count explicit JSON observation arrays once; CSV copies are not added again."""
    result = []
    for file in files:
        if file["role"] != "derived" or not file["path"].endswith(".json") or file["bytes"] > 5_000_000:
            continue
        value = load_json(directory / file["path"], packet)
        if value is None:
            continue
        for array_key, count_key in (("observations", "observation_count"), ("financial_observations", "financial_observation_count")):
            observations = value.get(array_key)
            if not isinstance(observations, list):
                continue
            declared = value.get(count_key)
            actual = len(observations)
            if isinstance(declared, int) and not isinstance(declared, bool) and declared != actual:
                issue("error", "observation_count_mismatch", packet, f"{file['path']}: {declared} declared, {actual} observed")
            result.append({"path": file["path"], "array_key": array_key, "count": actual, "declared_count": declared,
                           "use_for_case_financial_analysis": value.get("use_for_case_financial_analysis")})
            break
    return result


def inspect_packet(directory: Path, kind: str) -> dict:
    packet = directory.name
    if not (directory / "metadata.json").resolve().is_relative_to(directory.resolve()):
        issue("error", "metadata_outside_packet", packet, "metadata.json resolves outside its packet")
        return {"packet_id": packet, "kind": kind, "status": "unsafe_metadata_path"}
    metadata = load_json(directory / "metadata.json", packet)
    if metadata is None:
        return {"packet_id": packet, "kind": kind, "status": "invalid_metadata"}
    records = source_records(metadata)
    declared_roles: dict[Path, str] = {}
    attestations: list[dict] = []
    seen_attestations = set()
    local_declarations = list(declarations(metadata))
    # Circle's metadata names a derivative; its separate verification file attests hashes.
    verification = directory / "verification.json"
    if verification.is_file() and verification.resolve().is_relative_to(directory.resolve()):
        verification_data = load_json(verification, packet)
        if verification_data:
            local_declarations.extend(declarations(verification_data))
    elif verification.exists():
        issue("error", "verification_outside_packet", packet, "verification.json resolves outside its packet")
    for collection, record in local_declarations:
        raw_path = next((record[k] for k in PATH_KEYS if record.get(k)), None)
        path = safe_path(directory, raw_path, packet)
        if path is None or path.name in SYSTEM_METADATA_NAMES:
            continue
        role = explicit_role(record, collection)
        if role:
            existing_role = declared_roles.get(path)
            if existing_role and existing_role != role:
                issue("error", "conflicting_file_roles", packet, str(path.relative_to(directory)))
            declared_roles[path] = role
        expected_hash = record.get("sha256")
        expected_bytes = record.get("bytes", record.get("byte_size"))
        if expected_hash is None and collection in {"local_files", "evidence_files", "export_files", "provider_exports", "provider_export_files"}:
            issue("warning", "declared_file_without_sha256", packet, str(path.relative_to(directory)))
        stamp = (str(path), str(expected_hash), str(expected_bytes))
        if stamp in seen_attestations:
            continue
        seen_attestations.add(stamp)
        check = {"path": str(path.relative_to(directory)), "collection": collection}
        if expected_hash is not None:
            check["sha256_expected"] = expected_hash
            check["sha256_actual"] = sha256(path)
            check["sha256_match"] = isinstance(expected_hash, str) and check["sha256_actual"] == expected_hash.lower()
            if not check["sha256_match"]:
                issue("error", "hash_mismatch", packet, check["path"])
        if expected_bytes is not None:
            check["bytes_expected"] = expected_bytes
            check["bytes_actual"] = path.stat().st_size
            check["bytes_match"] = check["bytes_actual"] == expected_bytes
            if not check["bytes_match"]:
                issue("error", "byte_size_mismatch", packet, check["path"])
        attestations.append(check)
    for raw_path in metadata.get("derivative_evidence_files", []):
        path = safe_path(directory, raw_path, packet)
        if path and path.name not in SYSTEM_METADATA_NAMES:
            declared_roles[path] = "derived"
    # Unsuccessful remote records contain expected filenames, not local-file promises.
    for source in records:
        saved = any(source.get(key) is True for key in ("original_saved", "is_original_saved", "is_original"))
        if saved:
            raw_path = next((source[k] for k in (*PATH_KEYS, "filename", "expected_original_filename") if source.get(k)), None)
            path = safe_path(directory, raw_path, packet)
            if path and path.name not in SYSTEM_METADATA_NAMES:
                declared_roles[path] = "original"
    files = []
    for path in sorted(directory.rglob("*")):
        if not path.is_file() or path.name in SYSTEM_METADATA_NAMES:
            continue
        resolved = path.resolve()
        if not resolved.is_relative_to(directory.resolve()):
            issue("error", "symlink_outside_packet", packet, str(path.relative_to(directory)))
            continue
        relative = str(path.relative_to(directory))
        role = declared_roles.get(resolved)
        if role is None:
            if path.name in SUPPORT_NAMES or path.suffix in (".py", ".md") or "download" in path.stem:
                role = "support"
            else:
                role = "unclassified"
                issue("warning", "unclassified_local_file", packet, relative)
        files.append({"path": relative, "role": role, "bytes": path.stat().st_size, "sha256": sha256(path)})
    counts = {role: sum(f["role"] == role for f in files) for role in ROLES}
    counts["total"] = len(files)
    declared_originals = {key: metadata[key] for key in ("original_count", "saved_original_count", "original_source_file_count", "original_documents_saved") if isinstance(metadata.get(key), int)}
    for key, count in declared_originals.items():
        if count != counts["original"]:
            issue("error", "original_count_mismatch", packet, f"{key}={count}, observed={counts['original']}")
    for key in ("native_export_count", "native_provider_export_count", "native_provider_exports_saved"):
        count = metadata.get(key)
        if isinstance(count, int) and not isinstance(count, bool) and count != counts["provider_export"]:
            issue("error", "native_export_count_mismatch", packet, f"{key}={count}, observed={counts['provider_export']}")
    observations = observation_inventory(directory, files, packet) if kind == "supplemental_provider" else []
    observation_count = sum(item["count"] for item in observations)
    if kind == "supplemental_provider":
        for key in ("observation_count", "financial_observation_count"):
            count = metadata.get(key)
            if isinstance(count, int) and not isinstance(count, bool) and count != observation_count:
                issue("error", "provider_observation_count_mismatch", packet, f"{key}={count}, observed JSON rows={observation_count}")
    country = country_of(metadata)
    if kind == "case" and str(country).lower() not in ("united states", "usa", "us", "u.s."):
        issue("error", "us_issuer_not_confirmed", packet, str(country))
    blocked = [s for s in records if "403" in json.dumps(s) or s.get("http_status") == 403]
    missing_originals = [s.get("id") or s.get("source_id") or s.get("title") for s in records if not any(s.get(k) is True for k in ("original_saved", "is_original_saved", "is_original"))]
    dates = evidence_dates(directory, files, packet)
    period = metadata.get("case_period") or metadata.get("fiscal_periods_referenced")
    if period is None and dates:
        period = {"period_ends_in_saved_evidence": sorted({x["date"] for x in dates if x["field"] == "period_end"}), "basis": "dates in labeled derivative evidence; not a declared frozen case cutoff"}
    return {
        "packet_id": packet,
        "kind": kind,
        "metadata_path": str((directory / "metadata.json").relative_to(ROOT)),
        "metadata_sha256": sha256(directory / "metadata.json"),
        "entity_keys": entity_keys(metadata, records),
        "country": country,
        "status": metadata.get("validation_status") or metadata.get("status") or metadata.get("completeness") or metadata.get("packet_completeness"),
        "complete_internal_data_room": False,
        "case_period": period,
        "case_information_cutoff": metadata.get("case_information_cutoff") or metadata.get("disclosure_snapshot_cutoff"),
        "case_cutoff_note": "A missing cutoff is not inferred from the packet name or 2026 retrieval time. Live pages may contain later updates.",
        "dated_facts_in_saved_evidence": dates,
        "retrieval_or_creation_time_utc": metadata.get("retrieved_at_utc") or metadata.get("created_at_utc") or metadata.get("snapshot_created_at_utc") or metadata.get("checked_at_utc"),
        "temporal_note": "Case periods and disclosure dates remain separate from the 2026 acquisition timestamp. Provider exports are later retrieval snapshots unless their historical as-of is documented.",
        "source_document_record_count": len(records),
        "source_urls": sorted({str(s.get("source_url") or s.get("url")) for s in records if s.get("source_url") or s.get("url")}),
        "reference_urls": [metadata["reference_filing_index_url"]] if metadata.get("reference_filing_index_url") else [],
        "blocked_http_403_source_record_count": len(blocked),
        "unacquired_original_source_ids": missing_originals,
        "local_counts": counts,
        "files": files,
        "listed_file_attestations": attestations,
        "blockers": metadata.get("blockers") or metadata.get("acquisition_blocker") or metadata.get("acquisition_attempt_summary") or metadata.get("observed_ui_result"),
        "access_outcome": metadata.get("access_outcome"),
        "coverage_targets": metadata.get("targets"),
        "provider_observation_inventory": observations,
        "provider_observation_count": observation_count if kind == "supplemental_provider" else None,
        "provider_count_metadata": {key: metadata[key] for key in (
            "verified_profile_count", "full_profile_content_checked_count", "verified_company_count",
            "quarantined_company_candidate_count", "financial_observation_count_by_subject",
            "observation_count_by_subject", "numeric_financial_observation_count", "numeric_observation_count",
            "missing_value_count", "financing_claim_count", "arithmetic_replay_check_count"
        ) if key in metadata} if kind == "supplemental_provider" else {},
        "provider_operation_metadata": {key: value for key, value in metadata.items() if kind == "supplemental_provider" and any(term in key.lower() for term in ("export", "download", "approval", "pending", "resume")) and key not in HASH_COLLECTIONS},
        "omissions": metadata.get("omissions") or metadata.get("missing") or metadata.get("additional_omissions"),
    }


def build_manifest() -> dict:
    packets = []
    for directory in sorted(ROOT.iterdir()):
        if directory.is_dir() and (directory / "metadata.json").is_file():
            if not directory.resolve().is_relative_to(ROOT):
                issue("error", "packet_outside_root", directory.name, "packet resolves outside additional-cases")
                continue
            kind = "supplemental_provider" if directory.name in EXPECTED_PROVIDERS or "coverage" in directory.name else "case"
            packets.append(inspect_packet(directory, kind))
    found_cases = {p["packet_id"] for p in packets if p["kind"] == "case"}
    for missing in sorted(EXPECTED_CASES - found_cases):
        issue("error", "missing_expected_case_metadata", missing, "metadata.json not found")
    found_provider_dirs = {p["packet_id"] for p in packets if p["kind"] == "supplemental_provider"}
    pending = [{"directory": directory, "provider": provider, "status": "pending_metadata", "provider_export_count": 0} for directory, provider in EXPECTED_PROVIDERS.items() if directory not in found_provider_dirs]
    totals = Counter()
    case_totals = Counter()
    provider_totals = Counter()
    urls = set()
    source_count = 0
    attestations = []
    for packet in packets:
        counts = packet.get("local_counts", {})
        totals.update(counts)
        (case_totals if packet["kind"] == "case" else provider_totals).update(counts)
        urls.update(packet.get("source_urls", []))
        source_count += packet.get("source_document_record_count", 0)
        attestations.extend(packet.get("listed_file_attestations", []))
    index_support = []
    for name in ("README.md", "verify_cases.py"):
        path = ROOT / name
        if path.is_file():
            index_support.append({"path": name, "role": "support", "bytes": path.stat().st_size, "sha256": sha256(path)})
    errors = [x for x in issues if x["severity"] == "error"]
    warnings = [x for x in issues if x["severity"] == "warning"]
    return {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "scope": "US companies, independent real-company cases; local partial evidence inventories",
        "is_complete_data_room_collection": False,
        "case_count": len(found_cases),
        "supplemental_provider_packet_count": len(found_provider_dirs),
        "pending_supplemental_providers": pending,
        "source_document_record_count": source_count,
        "unique_source_document_url_count": len(urls),
        "case_file_counts": {role: case_totals.get(role, 0) for role in (*ROLES, "total")},
        "provider_file_counts": {role: provider_totals.get(role, 0) for role in (*ROLES, "total")},
        "all_packet_file_counts": {role: totals.get(role, 0) for role in (*ROLES, "total")},
        "provider_financial_observation_count": sum(packet.get("provider_observation_count") or 0 for packet in packets),
        "provider_observation_note": "Counts explicit saved JSON observation arrays once; CSV representations and the source PNG are not counted again. Missing cells are included. Quarantined observations remain excluded from case analysis.",
        "index_support_files": index_support,
        "generated_manifest_excluded_from_counts_and_hashes": True,
        "excluded_root_system_metadata_files": [path.name for path in ROOT.iterdir() if path.name == ".DS_Store" and path.is_file()],
        "excluded_system_metadata_files": sorted(str(path.relative_to(ROOT)) for path in ROOT.rglob(".DS_Store") if path.is_file()),
        "system_metadata_exclusion_note": "All .DS_Store files are preserved at every directory level; they are excluded from evidence/source file counts and content hashing.",
        "packets": packets,
        "validation": {
            "passed": not errors,
            "error_count": len(errors),
            "warning_count": len(warnings),
            "listed_local_file_attestations": len(attestations),
            "listed_sha256_checks": sum("sha256_match" in x for x in attestations),
            "listed_sha256_passed": sum(x.get("sha256_match") is True for x in attestations),
            "listed_byte_size_checks": sum("bytes_match" in x for x in attestations),
            "listed_byte_size_passed": sum(x.get("bytes_match") is True for x in attestations),
            "issues": issues,
            "meaning": "Validates inventory, safe local paths, declared file hashes/sizes and US-issuer metadata. It does not establish source completeness, independent financial accuracy, legal conclusions or historical point-in-time provider coverage.",
        },
        "provider_join_rules": [
            "Match case_id to verified legal entity and CIK; retain BvD/PitchBook IDs as separate provider identifiers.",
            "Brand similarity alone does not establish identity; retain parent/subsidiary/SPV and consolidation distinctions.",
            "Keep financial period, document publication, provider data as-of and retrieval timestamp separately.",
            "Store 2026 provider exports as supplements; never overwrite 2024/2025 historical case claims.",
            "Provider values and public filings may share sources; agreement is consistency, not independent ledger verification.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-only", action="store_true", help="Validate and print summary without replacing manifest.json")
    args = parser.parse_args()
    manifest = build_manifest()
    if not args.check_only:
        (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "case_count": manifest["case_count"],
        "source_document_records": manifest["source_document_record_count"],
        "case_counts": manifest["case_file_counts"],
        "provider_counts": manifest["provider_file_counts"],
        "provider_financial_observations": manifest["provider_financial_observation_count"],
        "pending_providers": [p["provider"] for p in manifest["pending_supplemental_providers"]],
        "sha256_passed": manifest["validation"]["listed_sha256_passed"],
        "sha256_checked": manifest["validation"]["listed_sha256_checks"],
        "errors": manifest["validation"]["error_count"],
        "warnings": manifest["validation"]["warning_count"],
    }, ensure_ascii=False))
    return 0 if manifest["validation"]["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
