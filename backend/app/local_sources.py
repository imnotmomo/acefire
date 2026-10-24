"""Read-only, provenance-preserving adapters for the local Circle case.

Vendor representations are observations, not independent issuer verification.
Only the native Orbis workbook and the two PitchBook observation datasets emit
numeric observations. Other files are inventoried without pretending to parse
their financial contents. No workbook formulas or source instructions execute.
"""
from __future__ import annotations

import hashlib
import json
import posixpath
import re
import unicodedata
import zipfile
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from .schemas import CIRCLE, IngestionResult, Observation, SourceSnapshot, stable_id

_NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_MISSING = {"", "n.a.", "n.a", "n/a", "n.s.", "n.s", "na", "null"}
_PB_DATASETS = {"circle_ttm_financial_observations.json", "circle_balance_sheet_observations.json"}

# Explicit row/definition mappings avoid merging similarly named measures.
# s = closing stock, f = annual flow, u = period basis remains unverified.
_ORBIS_ROWS: dict[int, tuple[str, str, str]] = {
    49: ("non_current_assets", "money", "s"),
    50: ("intangible_assets", "money", "s"),
    51: ("tangible_fixed_assets", "money", "s"),
    52: ("other_non_current_assets", "money", "s"),
    53: ("current_assets", "money", "s"),
    54: ("inventory", "money", "s"),
    55: ("debtors", "money", "s"),
    56: ("other_current_assets", "money", "s"),
    57: ("cash_and_cash_equivalents", "money", "s"),
    58: ("total_assets", "money", "s"),
    61: ("shareholders_funds", "money", "s"),
    62: ("capital", "money", "s"),
    63: ("other_shareholders_funds", "money", "s"),
    64: ("non_current_liabilities", "money", "s"),
    65: ("long_term_debt", "money", "s"),
    66: ("other_non_current_liabilities", "money", "s"),
    67: ("provisions", "money", "s"),
    68: ("current_liabilities", "money", "s"),
    69: ("loans_and_short_term_debt", "money", "s"),
    70: ("creditors", "money", "s"),
    71: ("other_current_liabilities", "money", "s"),
    72: ("total_shareholders_funds_and_liabilities", "money", "s"),
    75: ("working_capital", "money", "s"),
    76: ("net_current_assets", "money", "s"),
    77: ("enterprise_value", "money", "u"),
    78: ("employees", "count", "u"),
    81: ("operating_revenue", "money", "f"),
    82: ("sales", "money", "f"),
    83: ("costs_of_goods_sold", "money", "f"),
    84: ("gross_profit", "money", "f"),
    85: ("other_operating_expense_income", "money", "f"),
    86: ("operating_profit_ebit", "money", "f"),
    87: ("financial_profit_loss", "money", "f"),
    88: ("financial_revenue", "money", "f"),
    89: ("financial_expenses", "money", "f"),
    90: ("profit_before_tax", "money", "f"),
    91: ("income_tax_expenses_benefit", "money", "f"),
    92: ("profit_after_tax", "money", "f"),
    93: ("net_extraordinary_revenues_expenses", "money", "f"),
    94: ("extraordinary_revenues", "money", "f"),
    95: ("extraordinary_expenses", "money", "f"),
    96: ("net_income", "money", "f"),
    99: ("export_revenue", "money", "f"),
    100: ("material_costs", "money", "f"),
    101: ("costs_of_employees", "money", "f"),
    102: ("depreciation_amortization", "money", "f"),
    103: ("other_operating_items", "money", "f"),
    104: ("interest_paid", "money", "f"),
    105: ("research_development_expenses", "money", "f"),
    106: ("net_income_before_da", "money", "f"),
    107: ("added_value", "money", "f"),
    108: ("ebitda", "money", "f"),
    123: ("roe_pretax_percent", "percent", "f"),
    124: ("roce_pretax_percent", "percent", "f"),
    125: ("roa_pretax_percent", "percent", "f"),
    126: ("roe_net_income_percent", "percent", "f"),
    127: ("roce_net_income_percent", "percent", "f"),
    128: ("roa_net_income_percent", "percent", "f"),
    129: ("profit_margin_percent", "percent", "f"),
    130: ("gross_margin_percent", "percent", "f"),
    131: ("ebitda_margin_percent", "percent", "f"),
    132: ("ebit_margin_percent", "percent", "f"),
    133: ("cash_flow_operating_revenue_percent", "percent", "f"),
    134: ("enterprise_value_ebitda", "ratio", "u"),
    135: ("market_cap_operating_cash_flow", "ratio", "u"),
    138: ("net_assets_turnover", "ratio", "f"),
    139: ("interest_coverage", "ratio", "f"),
    140: ("inventory_turnover", "ratio", "f"),
    141: ("collection_period_days", "days", "f"),
    142: ("credit_period_days", "days", "f"),
    143: ("export_revenue_operating_revenue_percent", "percent", "f"),
    144: ("research_development_operating_revenue_percent", "percent", "f"),
    147: ("current_ratio", "ratio", "s"),
    148: ("liquidity_ratio", "ratio", "s"),
    149: ("shareholders_liquidity_ratio", "ratio", "s"),
    150: ("solvency_assets_percent", "percent", "s"),
    151: ("solvency_liabilities_percent", "percent", "s"),
    152: ("gearing_percent", "percent", "s"),
    155: ("pretax_profit_per_employee", "money_per_employee", "f"),
    156: ("operating_revenue_per_employee", "money_per_employee", "f"),
    157: ("costs_employees_operating_revenue_percent", "percent", "f"),
    158: ("average_cost_per_employee", "money_per_employee", "f"),
    159: ("shareholders_funds_per_employee", "money_per_employee", "s"),
    160: ("working_capital_per_employee", "money_per_employee", "s"),
    161: ("total_assets_per_employee", "money_per_employee", "s"),
}


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"), parse_float=Decimal)
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object in {path.name}")
    return value


def _decimal(raw: object) -> Decimal | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if text.lower() in _MISSING:
        return None
    text = text.replace(",", "").replace("%", "").replace("−", "-")
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    try:
        value = Decimal(text)
        return value if value.is_finite() else None
    except InvalidOperation:
        return None


def _date(raw: object) -> date | None:
    if raw is None:
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def _datetime(raw: object) -> datetime | None:
    if raw is None or "T" not in str(raw):
        return None  # A known date does not establish an exact retrieval time.
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def _name(raw: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", raw).casefold() if c.isalnum())


def _provider_records(provenance: dict[str, Any], provider: str) -> list[dict[str, Any]]:
    return provenance.get("providers", {}).get(provider, {}).get("sources", [])


def _metadata_for_file(relative: str, provenance: dict[str, Any], provider: str) -> list[dict[str, Any]]:
    candidates = _provider_records(provenance, provider) if provider != "uploaded" else provenance.get("sources", [])
    found = []
    for item in candidates:
        paths = [item.get("relative_path"), item.get("native_export_relative_path")]
        paths.extend(item.get("local_derived_files", []))
        if relative in paths:
            found.append(item)
    return found


def _snapshot(path: Path, root: Path, provenance: dict[str, Any]) -> SourceSnapshot:
    relative = path.relative_to(root).as_posix()
    provider = "orbis" if relative.startswith("orbis/") else "pitchbook" if relative.startswith("pitchbook/") else "uploaded"
    metadata = _metadata_for_file(relative, provenance, provider)
    primary = metadata[0] if metadata else {}
    if path.suffix.lower() == ".xlsx":
        kind = "native_provider_export_xlsx"
    elif provider == "pitchbook" and path.suffix.lower() == ".png":
        kind = "native_provider_export_image"
    elif path.name in _PB_DATASETS:
        kind = "derived_provider_observations_json"
    elif provider == "orbis" and path.suffix.lower() in {".json", ".csv"}:
        kind = "manual_capture_snapshot_only"
    elif path.suffix.lower() == ".pdf":
        kind = "issuer_document_unextracted"
    else:
        kind = "case_context_snapshot_only"
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    uri = primary.get("source_url") or primary.get("source_ui_url") or primary.get("url") or path.as_uri()
    context: dict[str, Any] = {
        "relative_path": relative,
        "source_metadata": metadata,
        "numeric_extraction_performed": False,
        "fixture_simulates_private_user_upload": True,
    }
    if provider != "uploaded":
        provider_context = provenance.get("providers", {}).get(provider, {})
        context["provider_limits"] = {k: v for k, v in provider_context.items() if k != "sources"}
    if kind == "manual_capture_snapshot_only":
        context["duplicate_numeric_ingestion_excluded"] = True
        context["manual_monetary_scale_remains_unresolved"] = True
    return SourceSnapshot(
        id=stable_id(CIRCLE.deal_id, relative, sha), deal_id=CIRCLE.deal_id,
        entity_key=CIRCLE.entity_key, provider=provider, source_kind=kind,
        ingestion_channel='user_upload', data_role='supplemental_evidence',
        visibility='deal_private', original_filename=path.name,
        source_uri=uri, local_path=str(path), sha256=sha,
        retrieved_at=_datetime(primary.get("retrieved_at") or primary.get("captured_at_utc")),
        provider_as_of=_date(primary.get("provider_last_updated_date") or primary.get("profile_UI_last_updated_date")),
        context=context,
    )


def _xml(archive: zipfile.ZipFile, name: str) -> ET.Element:
    info = archive.getinfo(name)
    if info.file_size > 25_000_000:
        raise ValueError(f"Oversized workbook XML member: {name}")
    return ET.fromstring(archive.read(name))


def _workbook(path: Path) -> tuple[dict[str, dict[str, dict[str, Any]]], bool]:
    """Read native cell values as text; never evaluate formulas or load links."""
    with zipfile.ZipFile(path) as archive:
        workbook = _xml(archive, "xl/workbook.xml")
        props = workbook.find("s:workbookPr", _NS)
        date1904 = props is not None and props.get("date1904") in {"1", "true"}
        strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(node.itertext()) for node in _xml(archive, "xl/sharedStrings.xml").findall("s:si", _NS)]
        formats: dict[str, str] = {}
        styles: list[str] = []
        if "xl/styles.xml" in archive.namelist():
            style_root = _xml(archive, "xl/styles.xml")
            formats = {node.get("numFmtId", ""): node.get("formatCode", "") for node in style_root.findall("s:numFmts/s:numFmt", _NS)}
            styles = [node.get("numFmtId", "0") for node in style_root.findall("s:cellXfs/s:xf", _NS)]
        relationships = {
            item.get("Id"): item.get("Target")
            for item in _xml(archive, "xl/_rels/workbook.xml.rels")
            if item.get("TargetMode") != "External"
        }
        sheets: dict[str, dict[str, dict[str, Any]]] = {}
        for sheet in workbook.findall("s:sheets/s:sheet", _NS):
            target = relationships.get(sheet.get(f"{{{_REL}}}id"))
            if not target:
                continue
            member = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
            if not member.startswith("xl/worksheets/"):
                continue
            cells: dict[str, dict[str, Any]] = {}
            for cell in _xml(archive, member).findall(".//s:sheetData/s:row/s:c", _NS):
                node = cell.find("s:v", _NS)
                raw = node.text if node is not None else None
                if cell.get("t") == "s" and raw is not None:
                    raw = strings[int(raw)]
                elif cell.get("t") == "inlineStr":
                    inline = cell.find("s:is", _NS)
                    raw = "".join(inline.itertext()) if inline is not None else None
                style = int(cell.get("s", "0"))
                fmt = styles[style] if style < len(styles) else "0"
                formula = cell.find("s:f", _NS)
                cells[cell.get("r", "")] = {
                    "raw": raw, "type": cell.get("t"),
                    "formula": formula.text if formula is not None else None,
                    "number_format": formats.get(fmt, fmt),
                }
            sheets[sheet.get("name", "")] = cells
        return sheets, date1904


def _excel_date(raw: str | None, date1904: bool) -> date | None:
    number = _decimal(raw)
    if number is None or number != number.to_integral_value():
        return None
    try:
        return (date(1904, 1, 1) if date1904 else date(1899, 12, 30)) + timedelta(days=int(number))
    except (OverflowError, ValueError):
        return None


def _orbis(path: Path, snapshot: SourceSnapshot, warnings: list[str]) -> list[Observation]:
    sheets, date1904 = _workbook(path)
    result: list[Observation] = []
    for sheet, cells in sheets.items():
        def raw(address: str) -> str | None:
            return cells.get(address, {}).get("raw")

        # Entity attribution is verified from workbook contents, never its name.
        id_text = str(raw("A4") or "")
        identifiers = re.fullmatch(r"BvD ID:\s*(\S+)\s+Orbis ID:\s*(\d+)\s*", id_text)
        if not (identifiers and identifiers.group(1) == CIRCLE.identifiers["bvd"]
                and identifiers.group(2) == CIRCLE.identifiers["orbis"]
                and _name(str(raw("C1") or "")) == _name(CIRCLE.legal_name)):
            continue
        snapshot.context["identity_verification"] = {
            "status": "matched_native_identifiers", "sheet": sheet,
            "legal_name_cell": "C1", "provider_ids_cell": "A4",
            "bvd": CIRCLE.identifiers["bvd"], "orbis": CIRCLE.identifiers["orbis"],
            "cik": raw("M28"), "filename_used_for_identity": False,
        }
        # This is an explicit adapter for the retained Summary layout, not a
        # guess based on row numbers in an arbitrary future vendor workbook.
        expected_anchors = {
            "A58": "Total assets",
            "A81": "Operating revenue (Turnover)",
            "A106": "Cash flow [Net Income before D&A]",
            "A129": "Profit margin (%)",
            "A147": "Current ratio (x)",
        }
        if any(_name(str(raw(cell) or "")) != _name(label) for cell, label in expected_anchors.items()):
            raise ValueError("Verified Circle workbook uses an unsupported financial row layout; no row-number guesses imported.")
        retrieval = _date(next((m.get("retrieval_date_utc") for m in snapshot.context["source_metadata"] if m.get("retrieval_date_utc")), None))
        for column in ("F", "I", "N", "P"):
            for row, (metric, family, period_type) in _ORBIS_ROWS.items():
                address = f"{column}{row}"
                if address not in cells or not raw(f"A{row}"):
                    continue
                ratio_section = row >= 123
                base = 114 if ratio_section else 40
                end = _excel_date(raw(f"{column}{base}"), date1904)
                header_unit = raw(f"{column}{base + 1}")
                duration = raw(f"{column}{base + 2}")
                scope_label = raw("A112" if ratio_section else "A38")
                accounting = raw(f"{column}{base + 5}")
                source_reference = raw(f"{column}{base + 6}")
                text = raw(address)
                number = _decimal(text)
                missing = text is None or text.strip().casefold() in _MISSING
                formula = cells[address]["formula"]
                notes = [
                    "Provider summary; underlying issuer filing version and consolidation perimeter are unverified.",
                    "Definition equivalence has not been reviewed; scenario is not explicitly stated.",
                ]
                if retrieval and CIRCLE.historical_cutoff and retrieval > CIRCLE.historical_cutoff:
                    notes.append("Retrieved after the historical IPO cutoff; not a point-in-time IPO archive.")
                if end and CIRCLE.historical_cutoff and end > CIRCLE.historical_cutoff:
                    notes.append("Reporting period ends after the historical IPO cutoff.")
                if metric == "net_income_before_da":
                    notes.append("Cash flow [Net Income before D&A] is not operating cash flow.")
                if metric == "profit_margin_percent":
                    notes.append("Provider profit margin uses a pretax profit basis; not mapped to net margin.")
                if metric == "shareholders_funds":
                    notes.append("Not assumed equivalent to another provider's total equity.")
                if metric == "sales":
                    notes.append("Distinct source row; do not add Sales and Operating revenue together.")
                if period_type == "u":
                    notes.append("Exact valuation/headcount period basis is unknown despite annual column context.")
                unit, multiplier, currency = None, None, None
                basis = None
                if family in {"money", "money_per_employee"} and header_unit == "th USD":
                    unit = "USD" if family == "money" else "USD/employee"
                    currency, multiplier = "USD", Decimal("1000")
                    basis = f"Explicit {column}{base + 1}=th USD; native XML numeric multiplied by 1000 without rounding."
                elif family == "percent":
                    unit, multiplier = "ratio", Decimal("0.01")
                    basis = "Native row label explicitly states (%); percentage points converted to a fraction."
                elif family in {"count", "ratio", "days"}:
                    unit = {"count": "employees", "ratio": "ratio", "days": "days"}[family]
                    multiplier = Decimal("1")
                    basis = "Explicit native metric label; dimensionless/count/day values are not monetary-scaled."
                if formula is not None:
                    notes.append("Cell contains a formula; cached result retained as raw evidence only, not recalculated.")
                confirmed = number is not None and multiplier is not None and formula is None
                known_period = end is not None and duration == "12 months"
                period_kind = "instant" if known_period and period_type == "s" else "duration" if known_period and period_type == "f" else "unknown"
                result.append(Observation(
                    id=stable_id(snapshot.id, sheet, address), deal_id=CIRCLE.deal_id,
                    entity_key=CIRCLE.entity_key, snapshot_id=snapshot.id, provider="orbis",
                    metric_key=f"orbis.{metric}", raw_label=str(raw(f"A{row}")), raw_value=text,
                    value=number * multiplier if confirmed else None,
                    unit=unit, currency=currency, scale_multiplier=multiplier if confirmed else None,
                    normalization_status="missing" if missing else "confirmed" if confirmed else "unresolved",
                    normalization_basis=basis if confirmed else None,
                    definition_key=None, scope="consolidated" if scope_label == "Consolidated, Annual report" else None,
                    accounting_basis=accounting, period_kind=period_kind,
                    period_label=f"FY {end.year}" if end else str(raw(f"{column}{base}") or ""),
                    period_start=date(end.year, 1, 1) if period_kind == "duration" and end and end.month == 12 and end.day == 31 else None,
                    period_end=end if period_kind != "unknown" else None,
                    scenario="unknown", information_as_of=retrieval,
                    verification_status="source_located", quarantined=formula is not None,
                    locator={
                        "kind": "xlsx_cell", "sheet": sheet, "cell": address,
                        "label_cell": f"A{row}", "period_cell": f"{column}{base}",
                        "unit_cell": f"{column}{base + 1}", "duration_cell": f"{column}{base + 2}",
                        "scope_cell": "A112" if ratio_section else "A38",
                        "accounting_basis_cell": f"{column}{base + 5}",
                        "source_reference_cell": f"{column}{base + 6}",
                        "raw_period_header": raw(f"{column}{base}"),
                        "raw_unit_header": header_unit, "raw_duration_header": duration,
                        "raw_scope_header": scope_label, "raw_accounting_basis_header": accounting,
                        "raw_audit_opinion_header": raw(f"{column}{base + 3}"),
                        "raw_record_version_header": raw(f"{column}{base + 4}"),
                        "source_reference": source_reference,
                        "raw_xml_value": text, "excel_number_format": cells[address]["number_format"],
                        "formula": formula,
                    }, notes=notes,
                ))
    if not result:
        snapshot.context["identity_verification"] = {"status": "no_matching_native_identifiers", "filename_used_for_identity": False}
        warnings.append(f"Orbis workbook {path.name} has no verified Circle identity; no financial observations imported.")
    snapshot.context["numeric_extraction_performed"] = bool(result)
    return result


def _pitchbook(path: Path, snapshot: SourceSnapshot, provenance: dict[str, Any], warnings: list[str]) -> list[Observation]:
    document = _load_json(path)
    entity = document.get("subject_entity", {})
    profile = entity.get("provider_profile_id")
    legal_name = entity.get("legal_name_from_root_verified_ui") or entity.get("legal_name_from_source_ui_context")
    if document.get("subject_case_id") != CIRCLE.deal_id or profile != CIRCLE.identifiers["pitchbook"] or _name(str(legal_name)) != _name(CIRCLE.legal_name):
        warnings.append(f"PitchBook dataset {path.name} lacks a verified Circle profile mapping; skipped.")
        return []
    snapshot.context["identity_verification"] = {"status": "matched_recorded_provider_profile", "pitchbook": profile, "basis": "Retained authenticated-UI provenance; JSON is a derivative source."}
    snapshot.context["definition_limits"] = document.get("definition_limits", document.get("limitations", []))
    snapshot.context["period_interpretation"] = document.get("period_interpretation", {})
    retrieval = _date(document.get("source", {}).get("capture_date_utc") or document.get("source", {}).get("document_created_on_date") or document.get("created_at_utc"))
    result: list[Observation] = []
    for index, item in enumerate(document.get("observations", [])):
        raw = item.get("raw_display_value")
        number = _decimal(item.get("display_numeric_value"))
        missing = bool(item.get("missing")) or raw is None or str(raw).strip().casefold() in _MISSING
        inconsistent_numeric = not missing and _decimal(raw) != number
        family = item.get("value_kind")
        unit, multiplier, currency, value = None, None, None, None
        basis = item.get("normalization_basis")
        if not missing:
            if family == "monetary_amount" and item.get("explicit_monetary_scale_multiplier") == "1000":
                unit, multiplier, currency = "USD", Decimal("1000"), "USD"
            elif family == "percentage" and item.get("display_unit") == "percent":
                unit, multiplier = "ratio", Decimal("0.01")
                basis = "Explicit percent label; percentage points normalized to fraction, without monetary scaling."
            elif family == "ratio" and item.get("display_unit") == "ratio":
                unit, multiplier = "ratio", Decimal("1")
            if number is not None and multiplier is not None:
                value = number * multiplier
        if inconsistent_numeric:
            value, multiplier = None, None
        notes = [
            "Exact period start/end and consolidated reporting scope are not established; raw TTM/month labels are preserved.",
            "Current provider snapshot is later than the May 27, 2025 historical IPO cutoff.",
            "Provider metric definition has not been reviewed for cross-source equivalence.",
        ]
        if item.get("value_basis") == "analyst_normalized":
            notes.append("Analyst Normalized measure; not equivalent to reported GAAP profit or adjacent margins.")
        if family == "per_share_metric":
            notes.append("EPS currency/share basis is unverified; the table's thousand-USD scale is not applied.")
        if missing:
            notes.append("Source cell is missing; retained as missing, never zero.")
        if inconsistent_numeric:
            notes.append("Raw display text disagrees with the recorded numeric field; normalization is quarantined.")
        locator: dict[str, Any] = {"kind": "json_pointer", "pointer": f"/observations/{index}", "observation_id": item.get("observation_id"), "source_id": item.get("source_id"), "display_unit": item.get("display_unit")}
        png_source_id = item.get("source_id") if path.name == "circle_balance_sheet_observations.json" else "pitchbook_circle_cash_flow_image_20261024" if item.get("table") == "cash_flow" else None
        if png_source_id:
            png = next((record for record in _provider_records(provenance, "pitchbook") if record.get("source_id") == png_source_id), None)
            if png and png.get("native_export_relative_path"):
                locator["source_png_relative_path"] = png["native_export_relative_path"]
                locator["source_png_link_basis"] = "Recorded provider UI/download context; no new image extraction performed."
        result.append(Observation(
            id=stable_id(snapshot.id, item.get("observation_id") or index), deal_id=CIRCLE.deal_id,
            entity_key=CIRCLE.entity_key, snapshot_id=snapshot.id, provider="pitchbook",
            metric_key=f"pitchbook.{item['metric_id']}", raw_label=item["raw_metric_label"],
            raw_value=raw, value=value, unit=unit, currency=currency, scale_multiplier=multiplier,
            normalization_status="missing" if missing else "confirmed" if value is not None else "unresolved",
            normalization_basis=basis if value is not None else None,
            definition_key=None, scope=None,
            accounting_basis="analyst_normalized" if item.get("value_basis") == "analyst_normalized" else "US GAAP unless otherwise stated",
            period_kind="unknown", period_label=item.get("raw_period_header"),
            period_start=None, period_end=None, scenario="unknown", information_as_of=retrieval,
            verification_status="manual_capture", locator=locator,
            quarantined=inconsistent_numeric or bool(item.get("quarantined")) or item.get("use_for_case_financial_analysis") is False,
            notes=notes,
        ))
    snapshot.context["numeric_extraction_performed"] = bool(result)
    return result


def ingest_local_circle(case_root: Path) -> IngestionResult:
    """Inventory Circle sources and ingest immutable native/derived observations.

    ``case_root`` is the existing ``circle-2025-ipo`` directory. Missing files
    yield a partial result with explicit warnings; source bytes are never edited.
    """
    root = Path(case_root).resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Circle case directory does not exist: {root}")
    warnings: list[str] = []
    provenance_path = root / "provenance.json"
    provenance = _load_json(provenance_path) if provenance_path.is_file() else {}
    if not provenance:
        warnings.append("No provenance manifest; provider attribution/URL context may be incomplete.")
    elif provenance.get("case_id") != CIRCLE.deal_id:
        raise ValueError("Provenance manifest belongs to a different case.")
    snapshots: list[SourceSnapshot] = []
    observations: list[Observation] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name.startswith(".") or path.suffix.lower() not in {".json", ".csv", ".xlsx", ".png", ".pdf", ".txt"}:
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            warnings.append(f"Skipped linked source outside immutable local inventory: {path.name}")
            continue
        snapshot = _snapshot(path, root, provenance)
        snapshots.append(snapshot)
        try:
            if snapshot.provider == "orbis" and path.suffix.lower() == ".xlsx":
                observations.extend(_orbis(path, snapshot, warnings))
            elif snapshot.provider == "pitchbook" and path.name in _PB_DATASETS:
                observations.extend(_pitchbook(path, snapshot, provenance, warnings))
        except (ValueError, KeyError, InvalidOperation, zipfile.BadZipFile, ET.ParseError) as error:
            snapshot.context["ingestion_error"] = str(error)
            warnings.append(f"Could not ingest {path.relative_to(root)}: {error}")
    if not any(item.provider == "orbis" for item in observations):
        warnings.append("No native Orbis financial observations available.")
    if not any(item.provider == "pitchbook" for item in observations):
        warnings.append("No attributed PitchBook observations available.")
    warnings.append("This local adapter does not ingest Akta; Akta results require a separately configured provider adapter.")
    return IngestionResult(company=CIRCLE, snapshots=snapshots, observations=observations, warnings=warnings)
