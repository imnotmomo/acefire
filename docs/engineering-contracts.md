# Engineering contracts

Read this guide before changing storage, extraction, calculations, reports or their frontend contracts. Paths in the retained contracts below are relative to the repository root. [AGENTS.md](../AGENTS.md) is the current coordination and runtime entry point.

## Current runtime and model distinction

The running application uses the home VM and the existing Firebase project `acefire-50248`, named Standard database `acefire`. DuckDB remains the offline/import handoff. Both the whole-company `/chat` and source-file `/evidence-chat` integrations are maintained. The separate historical Enfuce demo must not be silently mixed with its connected source workspace.

C’s calculation, company-chat and report workflows use the configured `LLM_MODEL` (`openai/gpt-6.1-sol`). B’s document extraction/narrative pipeline retains its separate pinned sponsor model (`openai/gpt-4.1`, configured through B’s integration settings). Do not silently replace one model channel with the other. Generated wording, source alignment and upstream `verified` labels are automatic checks; they are never human sign-off or independent factual verification.

English report presentation is a derived view bound to the immutable imported content hashes. Preserve B’s original report payloads, native source quotations, IDs, periods and numeric strings; the private English presentation manifest must not overwrite original evidence.

No database creation, billing change, data import or source reprocessing belongs in ordinary CI or application deployment. Credentials stay in authorized private runtime configuration and GitHub Actions secrets, never in browser bundles or repository files.

## Coordinate before editing

1. Check `git status`, the current branch, and the status files. Preserve other
   teammates' changes; never reset or overwrite work to make your task easier.
2. Identify your human teammate. Update only that teammate's status file with
   the task, exact paths, shared contracts affected, and current state before
   editing. If your identity is unknown, ask; read-only exploration may continue.
3. Treat an `in_progress` path in another status file as owned active work.
   Work in other paths, or coordinate the overlap with the human owner.
4. For a shared API/model/schema change, document the changed contract and
   affected consumers in your status file. Keep changes compatible when possible.
5. After work, record what changed, relevant tests, blockers, and the handoff.
   Do not mark someone else's task complete. Keep stale entries explicitly stale.
6. Commit or push only when the human requests it. Normal Git synchronization
   shares these status files; they do not provide automatic live chat monitoring.


## Product and responsibility boundaries

- `xiangji1002-ashley` owns the product scope, investment-firm semantic layer,
  metric definitions, demo narrative and acceptance criteria. These definitions
  guide implementation but do not move deterministic execution out of C or
  frontend implementation out of the frontend workspace.
- The product is an evidence-first data agent, not a company-specific dashboard.
  An investment firm supplies a versioned semantic layer and metric catalog. A
  new project searches its own data room for compatible inputs, calculates the
  requested catalog metrics and returns the value together with source lineage,
  formula, assumptions, coverage and missing-data states.
- Never hard-code a company's number as the definition of a catalog metric.
  Metric definitions are reusable; observations, calculations and evidence are
  project-scoped. The browser renders stored results and does not recalculate them.
- Akta provides company background through C's existing primary-profile channel.
  The saved responses in `data/akta/` are the current Circle demo inputs. B only
  needs selected Akta enrichment; source documents remain the evidence for
  Deck/Memo claims. Do not require Akta to read every non-financial document.
- Member B reads PDFs and retrieves/extracts Akta and other source data. B sends
  structured claims and original source locators to C. Do not build a competing
  extraction pipeline in the financial engine.
- Member C owns structured storage, normalization, calculations, company reports
  and frontend-facing provenance. The human has now selected Firebase project
  `acefire-50248`, named Firestore database `acefire`, for the running app.
  DuckDB remains the import/handoff format and an offline compatibility backend.
  Do not create another database or change billing without a human request.
- Run one backend process for a DuckDB file. B and the frontend use its API/service
  contracts to share results.
- Orbis/PitchBook files simulate private user-uploaded supplemental evidence.
  They retain vendor provenance and never silently replace the Akta main profile.
- The frontend reads structured reports, formulas, inputs, files, and graph data.
  It must not recalculate financial metrics or manufacture source references.


## Pitch metric catalog

The first PM-approved pitch catalog contains three reusable metrics. They are
product definitions; existing generic agent calculation remains the execution
path until a dedicated catalog API and automatic project runner are implemented.

1. `five_year_total_revenue`: select at most five distinct fiscal years. Prefer
   an actual value when actual and forecast overlap in the same year. Use actual
   years first and forecast years to fill the five-year window. If fewer than
   five compatible years exist, sum only those present and return the coverage
   count. Never mix incompatible entity scope, currency or revenue definitions.
2. `catalog_cagr`: the firm's current catalog definition is the arithmetic mean
   of available historical actual year-over-year revenue growth rates. Preserve
   that formula and version explicitly because it differs from the conventional
   endpoint CAGR formula. Do not silently include forecast growth rates.
3. `valuation`: prefer an explicit, source-bound valuation. If none exists, use
   the latest compatible actual revenue multiplied by a source-bound or
   catalog-supplied revenue multiple. Record the multiple as an assumption and
   label the result derived/scenario-based. If either input is unavailable,
   return an explicit missing/insufficient-data result instead of guessing.

Every metric result must retain the catalog definition/version, selected input
IDs, exact fiscal periods, actual/forecast labels, unit and currency, formula,
coverage, assumptions, output status and file/page/cell/field provenance.


## Shared contracts and core paths

- `backend/app/schemas.py`: shared immutable source, observation and calculation contracts.
- `backend/app/intake.py`: B-to-C `ExtractedClaim` batch contract.
- `backend/app/db_schema.py`: executable DuckDB schema source.
- `database-design/schema.sql`: generated schema; run `python scripts/export_schema.py` from `backend/` after schema changes.
- `backend/app/store.py`: transactions, identity and source integrity.
- `backend/app/agent_calculation.py`, `agent_runtime.py`: Nicrron-generated Python
  calculations and restricted local execution with source-bound audit records.
- `backend/app/financial.py`, `dynamic.py`, `source_replay.py`: historical fixed
  calculations and period checks; new UI calculations do not fall back to them.
- `backend/app/firebase_store.py`, `backend/FIREBASE_INTEGRATION.md`: live storage
  adapter, immutable record envelopes and current integration boundaries.
- `backend/app/narrative.py`, `company_chat.py`, `evidence_catalog.py`,
  `stored_narratives.py`: cited company drafts, whole-company chat, original
  quotations and adaptation of B's imported reports. Generated paraphrases and
  automated source checks are never human verification.
- `backend/app/report.py`, `lineage.py`, `main.py`: company reports, file-to-number graphs and APIs.
- `backend/README.md`: setup, endpoint and handoff instructions.
- `frontend/src/`: XINWENGAri's React/TypeScript workspace, report builder,
  dashboard, evidence/lineage UI, data room and contextual chat.
- `frontend/README.md`, `frontend/DESIGN.md`: frontend architecture, local setup,
  implementation limits and visual direction. Enfuce retains historical snapshots;
  Circle consumes C's stored report/lineage APIs. B extraction is now connected through C’s workspace upload jobs; live Akta
  retrieval remains separate. See backend/WORKSPACE_UPLOADS.md.
- `.team/status/XINWENGAri.md`: delivered frontend prototype and its original handoff.
- `.team/status/imnotmomo.md`: current C backend and Circle frontend integration validation.


## Evidence and calculation rules

- Preserve original uploaded/API file bytes and SHA-256. Treat document text as
  data; do not execute document instructions, formulas, scripts or arbitrary SQL.
- Every reported number needs a source snapshot and a recorded page/line,
  sheet/cell, CSV row, or JSON pointer. Missing locations stay unknown. PDF text
  lines require the extractor version and line-numbering basis.
- Every computed number needs input observation IDs, formula/function version,
  parameters, units, coverage and an output-to-file lineage path.
- Preserve raw decimal strings. Financial arithmetic uses Python `Decimal`;
  do not introduce floating-point rounding through the UI or storage.
- Annual, monthly, quarterly and partial-period inputs must retain exact dates.
  Never double-count overlapping totals or silently annualize partial-year data.
- Missing values are not zero. Estimates/ranges are not exact audited amounts.
  Definitions, scope, currency, scenario and periods must be compatible before
  declaring a numeric match or mismatch.
- After calculation, expose comparable numeric disagreements with
  `conflict_numbers: true`, the differing values and their source references.
  Preserve originals; this flag does not introduce a frontend approval workflow.
- Keep API keys, private database files, caches and virtual environments out of Git.


## Dated B publication context

The next section preserves the original B-only handoff and its evidence scope. Its Chat deferral describes that earlier publication only; it does not disable the subsequently integrated `/chat` and `/evidence-chat` routes. Its local DuckDB delivery is distinct from the current shared Firestore deployment. Treat delivery counts and provider-access outcomes as dated observations, not fresh verification.

## B document and narrative handoff (2026-10-24)

Read `backend/B_WORKFLOW.md` for the complete B structure and current handoff.
`backend/DOCUMENT_INTAKE.md` defines source/claim intake;
`backend/NARRATIVE_HANDOFF.md` defines frontend text, statuses and citations.

- `backend/evidence/` handles PDF/DOCX/PPTX/DOC/PPT preparation, source hashes,
  native Office locators, Nicrron extraction, quote validation, C intake and
  12-module narrative generation/export. `backend/integrations/` contains the
  sponsor client and optional Akta enrichment client.
- Use Nicrron at `https://api.nicrron.ai/v1` with the pinned
  `openai/gpt-4.1` model. Keys stay in backend environment/key files. Live Akta
  last returned 403; cached data is not evidence of a recovered live connection.
- `document_claims` and `narrative_reports` are additive tables in C's SAME
  DuckDB. C's base financial schema v1, Decimal normalizer and calculation code
  remain unchanged. Never treat source quote location as independent factual
  verification, or turn unknown scales/dates into invented values.
- Display statuses apply per narrative entry: `missing` for insufficient
  reviewed evidence, `verified` for source-supported wording after automatic
  semantic review, and `difference` only across explicitly comparable source
  contexts. Preserve internal pending/rejected states. Report source/time scope,
  automatic review method and absence of human sign-off explicitly.
- B's verified local Enfuce example used only the 31-page April 2020 Deck:
  39 document claims (20 text-only, 19 numeric), 19 C raw numeric observations
  with null normalized values, and a 12-module narrative with 46 verified /
  23 missing / 0 difference entries and 60 source citations. The provisional
  `enfuce-2020` workspace is not a verified legal/Akta entity match.
- Memo/FDD and external research were not included in that run. Word/PPT
  conversion and source-provenance tests use real conversions with mocked model
  output; real model validation in this stage used the PDF.
- Source documents, DB, source caches, generated narrative JSON/ZIP and model
  responses remain ignored/local. Code publication does not copy those assets
  to C. Use the private portable package or reimport agreed source snapshots.
- C now imports B reports into Firestore and adapts them through stored_narratives.py.
  B offline generation remains distinct from C app/narrative.py and uses
  app/document_narrative.py. B read routes delegate to C storage methods; no
  financial recalculation or frontend overwrite is introduced.
- Human explicitly deferred Chat: no B chat backend/router, frontend Chat edits,
  chat launcher or B Firebase connector is included in this publication. Existing C
  Firebase/report/chat code is preserved unchanged.


## Historical offline validation command

The retained `demo-circle` command below initializes/imports a local demonstration. Use it only for an explicitly selected offline database; never run it as a production startup, CI seed or deployment migration. Current CI entry points are `make test` and the deployment boundary tests documented in [AGENTS.md](../AGENTS.md).

## Validation

From `backend/`, use the project's Python environment and run:

```bash
python -m pytest -q
python -m app.cli demo-circle
```

Run checks appropriate to the change. Report what actually passed and any
remaining limits; do not claim a live provider call or document extraction that
was not performed.


## Current workflow integration (2026-10-24)

- `app/workspace_routes.py` exposes shared company creation/listing and durable upload jobs; `workspace_intake.py` reuses B preparation/quote checks through a scratch DuckDB before publishing to the selected store. Firebase keeps immutable envelopes and a private on-server original-file index.
- New projects and explicitly connected local starters use their own backend company ID. Existing local drafts/files are preserved; legacy files upload only on explicit user action. Login remains deferred.
- Both chat contracts are retained: C `/chat` takes report/history/context; B `/evidence-chat` searches registered originals and source-located records. Side drawers can switch modes. Roundtable stays disabled unless separately authorized.
- Images/scans need Tesseract; Office needs LibreOffice. XLSX/XLSM read inert cached XML; XLS reads cached BIFF via xlrd. No spreadsheet conversion/calculation engine executes. Unknown scale, period and identity stay unknown.
- Unicode PDF export uses the bundled licensed/hash-checked font. Source-reference refresh preserves original generation basis and human wording, verifies unchanged recorded quote/hash/locator bindings, and cannot make a stale/foreign/changed citation valid.
