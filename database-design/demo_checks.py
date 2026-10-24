#!/usr/bin/env python3
"""Replay narrow Enfuce arithmetic checks from inspected OOXML evidence.

Reads cached source values; does not execute Excel formulas or external links.
This is not a general importer, an ARR definition, or an independent ledger audit.
"""

from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import hashlib
import json


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
WORKBOOK_EVIDENCE = HERE / "evidence/workbooks.json"
REPORT_EVIDENCE = HERE / "evidence/reports.json"
PL = "data/Enfuce/Enfuce 09-07/B. Financial and Tax Information/Enfuce P_L  2017- 2022F by Qs.xlsx"
JUNE = "data/Enfuce/M. Supplmental FDD/June  2020 Finacials.xlsx"
CENT = Decimal("0.01")
K_EUR_PRECISION = Decimal("0.00001")


def main():
    workbooks = json.loads(WORKBOOK_EVIDENCE.read_text())
    reports = json.loads(REPORT_EVIDENCE.read_text())
    samples = workbooks["financial_samples"]
    source_records = {r["path"]: r for r in workbooks["inventory"]}
    source_records.update({r["path"]: r for r in reports["source_files"]})
    used = {PL, JUNE, *[r["path"] for r in reports["source_files"]]}
    for source in used:
        actual = hashlib.sha256((PROJECT / source).read_bytes()).hexdigest()
        if actual != source_records[source]["sha256"]:
            raise ValueError(f"Source changed; re-inspect before replay: {source}")

    def number(file, sheet, cell):
        obj = samples[file][sheet][cell]
        if obj.get("type") != "n" or obj.get("raw_value") is None:
            raise ValueError(f"Missing numeric cached source: {sheet}!{cell}")
        return Decimal(str(obj["raw_value"]))

    def amount(file, sheet, cell, precision=CENT):
        return number(file, sheet, cell).quantize(precision, rounding=ROUND_HALF_UP)

    def trace(file, sheet, cells):
        return {"file": file, "file_sha256": source_records[file]["sha256"],
                "sheet": sheet, "cells": cells}

    # Explicit fixture mappings from inspected headers, styles, and row labels.
    # Never infer these from every workbook's filename or a global EUR default.
    net_sales = sum(amount(JUNE, "P&L - Group", f"{c}4") for c in "CDEFGH")
    other_income = sum(amount(JUNE, "P&L - Group", f"{c}5") for c in "CDEFGH")
    total_income = amount(JUNE, "P&L - Group", "I6")
    assert net_sales + other_income == total_income
    summary_as_eur = (number(JUNE, "近五年财务情况", "F4") * 1000).quantize(CENT)
    assert summary_as_eur == total_income
    assert summary_as_eur != net_sales

    pl_revenue = amount(PL, "PL", "F7", K_EUR_PRECISION)
    pl_cogs_signed = amount(PL, "PL", "F8", K_EUR_PRECISION)
    pl_gross_margin = amount(PL, "PL", "F9", K_EUR_PRECISION)
    observed_formula = samples[PL]["PL"]["F9"]["formula_raw"].replace(" ", "")
    assert observed_formula.lstrip("+=").upper() == "F7+F8+50"
    assert pl_revenue + pl_cogs_signed + Decimal("50") == pl_gross_margin

    # The source SUM range includes one blank row. Preserve it as blank evidence;
    # apply SUM's ignore-blank behavior only for this explicitly inspected range.
    mrr_cells = [f"Q{row}" for row in range(5, 14)]
    mrr_blank_cells = [c for c in mrr_cells if samples[PL]["MRR"][c]["raw_value"] is None]
    assert mrr_blank_cells == ["Q13"]
    mrr_sum = sum(amount(PL, "MRR", c) for c in mrr_cells if c not in mrr_blank_cells)
    mrr_total = amount(PL, "MRR", "Q14")
    assert mrr_sum == mrr_total
    mrr_format = samples[PL]["MRR"]["Q14"]["number_format"]
    assert mrr_format == "#,##0,"
    mrr_display_k_eur = (mrr_total / 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP)

    fdd = next(c for c in reports["claims"] if c["id"] == "fdd_fy2019_revenue")
    fdd_rounding_consistent = pl_revenue.quantize(Decimal("1"), rounding=ROUND_HALF_UP) == Decimal(fdd["numeric_value"])
    assert fdd_rounding_consistent

    results = {
        "scope": "Explicit narrow fixtures, supplied workbook cached values only. No formulas or external workbook links executed.",
        "source_hashes_verified": {s: source_records[s]["sha256"] for s in sorted(used)},
        "normalization": "Preserve raw decimals; quantize EUR source amounts to cents or kEUR to0.00001 before arithmetic, using Decimal ROUND_HALF_UP.",
        "checks": [
            {"id": "h1_income_reconciliation", "status": "arithmetic_reproduced",
             "entity_scope": "Enfuce Group as labeled by source", "period": "2020H1", "unit": "EUR",
             "net_sales": str(net_sales), "other_operating_income": str(other_income),
             "calculated_income_total": str(net_sales + other_income), "source_income_total": str(total_income),
             "sources": [trace(JUNE, "P&L - Group", "C4:H5,I6")],
             "limit": "Internal arithmetic of supplied values; underlying external monthly source not independently verified."},
            {"id": "summary_revenue_definition", "status": "not_comparable",
             "reason": "Summary label营业收入 maps numerically to Income total, not pure Revenue; metric definition requires review.",
             "summary_value_as_eur": str(summary_as_eur), "pure_revenue_eur": str(net_sales),
             "income_total_eur": str(total_income), "delta_for_investment_conclusion": None,
             "sources": [trace(JUNE, "近五年财务情况", "A4,F4"), trace(JUNE, "P&L - Group", "B4:I6")],
             "open_question": "Should the report's revenue include other operating income?"},
            {"id": "gross_margin_formula_lineage", "status": "arithmetic_reproduced",
             "unit": "kEUR", "period": "2019", "source_formula": observed_formula,
             "revenue": str(pl_revenue), "signed_cogs": str(pl_cogs_signed),
             "explicit_unlabeled_adjustment": "50", "calculated": str(pl_gross_margin),
             "sources": [trace(PL, "PL", "F7:F9,AF9,AH9")],
             "open_question": "Explain the50kEUR constant. The formula does not itself identify its business meaning."},
            {"id": "mrr_detail_reconciliation", "status": "arithmetic_reproduced",
             "unit": "EUR", "calculated": str(mrr_sum), "source_total": str(mrr_total),
             "number_format": mrr_format, "stored_scale_to_eur": "1", "display_divisor": "1000",
             "blank_source_cells": mrr_blank_cells, "blank_policy": "Ignore blank Q13 within this explicit SUM range only; do not replace unknown required inputs with zero.",
             "displayed_integer_k_eur": str(mrr_display_k_eur),
             "sources": [trace(PL, "MRR", "Q4:Q14")],
             "arr": None, "arr_limit": "No automatic x12; confirm recurring revenue, customer scope, as-of date and ARR definition first."},
            {"id": "fdd_rounded_2019_revenue", "status": "candidate_rounding_consistency",
             "pl_value_k_eur": str(pl_revenue), "fdd_value_k_eur": fdd["numeric_value"],
             "rounding_rule": "Nearest whole kEUR", "numeric_rounding_consistent": fdd_rounding_consistent,
             "sources": [trace(PL, "PL", "F7"), fdd["evidence"]],
             "comparison_status": "insufficient_evidence",
             "limit": "Report group-vs-parent scope is unresolved; numeric proximity alone does not authorize a final matched comparison."}
        ],
        "passed_checks": 5,
        "investment_conclusions_generated": False,
    }
    output = HERE / "demo_results.json"
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"checks": len(results["checks"]), "status": "passed", "output": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
