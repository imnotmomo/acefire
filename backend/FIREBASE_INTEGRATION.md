# Firebase and LLM workflow handoff

The running local app uses project **acefire-50248**, named Firestore database
**acefire**, in **us-east1**, using **Standard edition**. The database reports
`freeTier: true`; project billing is disabled and no billing account is linked.
No billing upgrade, Cloud Functions deployment or Storage bucket was added.

## Imported data

The latest supplied `acefire.duckdb` was copied and opened read-only. SHA-256:
`f6e20f79e152e9d12824139b8dd2a8d5aa5f3c09c148eafaa0b4161984fbd14a`.
It contains Enfuce (`enfuce-2020`): one company, one source snapshot, 19 numeric
observations, 39 extracted document claims and two narrative reports. All 19
normalized values remain null; raw values and unknown dates are preserved.
Circle's existing 436 observations, 16 snapshots, two profiles and stored
asset-component calculation are also available, under `circle-2025-ipo`.

The import verified 519 records including its provenance marker; a complete
replay created zero records. The reusable importer independently verified all
62 records from the latest DuckDB with zero writes. A subsequent live LLM
calculation created an additional immutable calculation record in Firestore.

## Collections

```text
companies/{deal_id}                              Company
  source_snapshots/{snapshot_id}                 SourceSnapshot
  source_observations/{observation_id}            Observation
  company_profiles/{snapshot_id}                 {snapshot_id, provider, profile}
  document_claims/{claim_id}                      B's original claim payload
  narrative_reports/{report_id}                  B's original report payload
  calculations/{calculation_id}                  Calculation + execution audit
  comparisons/{comparison_id}                    Comparison
  report_drafts/{draft_id}                        Shared generated draft + mutable editor state/revision
  workspace_settings/current                     Mutable display labels and reversible archive state
imports/{original_database_sha256}               Import provenance
```

Every document uses `{schema_version: 1, record_sha256, record}`. The digest is
SHA-256 of sorted, compact UTF-8 JSON for `record`. Financial amounts are decimal
strings or null. Original IDs remain unchanged. Writes are create-only; an
existing ID with different content fails rather than overwriting evidence.
Source records remain create-only. The two application-workspace collections
above are separate mutable state with atomic update preconditions; they never
replace imported reports or legal/source identities. See `SHARED_REPORTS.md`
and `WORKSPACE_UPLOADS.md` for API contracts.
Company reports are assembled by the API from individual evidence records, not saved as
one oversized aggregate document.

Migration:

```bash
cd backend
python -m pip install -r requirements.txt
python scripts/import_firestore.py /path/to/acefire.duckdb --dry-run
export GOOGLE_APPLICATION_CREDENTIALS=/private/path/to/adc.json
python scripts/import_firestore.py /path/to/acefire.duckdb
```

The original binary database is not uploaded. Machine-local source paths are
removed from cloud records. Source file hashes, original names and locators stay
intact. Original-file bytes are still served locally through the existing
hash-checking endpoint; `SOURCE_FILE_MANIFEST` optionally maps snapshot IDs to
local `{path, sha256}` objects. Enfuce's source PDF is absent on this computer,
so the UI marks it unavailable while preserving stored quotes and page numbers.

## Local start and access

Configure private `backend/.env` using `.env.example`:

```dotenv
DATA_STORE=firestore
FIREBASE_PROJECT_ID=acefire-50248
FIRESTORE_DATABASE_ID=acefire
GOOGLE_APPLICATION_CREDENTIALS=/private/path/to/adc.json
SOURCE_FILE_MANIFEST=/private/path/to/source-files.json
ACEFIRE_PORT=8017
```

Keep the existing private Nicrron credential there. Run `python run_local.py`
from `backend/`; the launcher loads the allowlisted private configuration and
listens only on `127.0.0.1`. Set frontend `ACEFIRE_BACKEND_URL` to
`http://127.0.0.1:8017` in ignored `.env.local`, then run `npm run dev` or
`npm run build` followed by `npm run preview`.

`GET /health` reports the active storage, project and database. Server SDK access
uses ADC/IAM; no Google OAuth credential or model key is sent to the browser.
An unauthenticated direct read of the imported company document returned 403.
The local API is a development service, not a deployed multi-tenant auth layer.
Each teammate needs their own authorized credentials; do not commit/share ADC.

## Frontend and model contracts

- `GET /deals/{id}/report` returns the existing typed report plus
  `document_claims`, `narrative_evidence`, `stored_reports` and `persistence`.
  Native B claims remain distinct from `report_source_quotation` records, which
  bind additional quotations from B's stored reports. These derived quotation
  records do not create extra extracted claims in the database.
- `GET /deals/{id}/stored-reports/{report_id}/draft` adapts a stored B report to
  frontend sections, preserving exact quotes and file/page/hash bindings.
  B's automated `verified` label maps to **Verify / needs review**; differences
  map to Conflict and missing evidence stays Missing. Human edits remain local
  and prior text is retained in version history when loading a saved report.
- `POST /deals/{id}/report/draft` accepts `based_on_report_id` and configured
  sections. Nicrron generates supported summaries/inferences with checked exact
  quotations. Source passages are evidence; generated wording is not a source
  quote. Current working drafts and revisions are saved in browser storage.
- `POST /deals/{id}/calculate/agent` accepts `question`, numeric `input_ids`,
  optional `premise_ids` and decimal-string `parameters`. Generated Python runs
  in a restricted local subprocess; the returned value, code, inputs, source
  manifest, hashes, logs and assumptions are saved as a Firestore Calculation.
  It is not a hardware sandbox or independent financial verification. Old fixed
  formulas remain compatibility routes, not automatic model fallbacks.
- `POST /deals/{id}/chat` accepts `question`, `report_id`,
  `context_scope: "entire_company"`, history and an explicitly unverified working
  draft. The server loads all company sources, profiles, observations, claims,
  stored reports, calculations, comparisons, gaps and period coverage. It omits
  repeated display graphs and host paths. Oversized context fails explicitly;
  records are not silently dropped. Answers include checked exact quote IDs and
  Missing / Verify / Conflict. Chat does not invent new financial calculations.

The original Enfuce project remains a labeled historical demo. Use
`#/project/enfuce-documents/report/build` for the imported Firebase company;
`circle` still maps to `circle-2025-ipo`. Upload processing and new Akta retrieval
remain pending for B. This integration does not introduce another extractor.

## Validation

Backend: `python -m pytest -q`. Frontend: `npm test`, `npm run build`,
`npm run test:calculation`, `npm run test:narrative`, `npm run test:chat`,
`npm run test:integration`, `npm run test:e2e`, `npm run test:landing`.

`npm run test:firebase` reads the real configured Firestore backend and checks
saved reports, citations, edits and export. `LIVE_COMPANY_CHAT=1` additionally
makes a paid model call through the real browser chat. Other browser contract
tests mock model responses and do not claim live generation. Chrome can be
selected with `PLAYWRIGHT_BROWSER_PATH`.


## Standard edition replacement — 2026-10-24

The human explicitly approved replacing the Enterprise database with Standard while keeping billing disabled. The project, database name and region remain unchanged, so existing application configuration and scoped service-account access still work.

A consistent, typed backup was taken after application writers were paused and replicated privately. All 521 documents were restored with create-only writes, including both companies, 455 observations, 17 source snapshots, 39 document claims, three calculations, two profiles, two saved narrative reports and the import provenance marker. Independent field-hash/envelope verification and a complete recursive inventory found no missing, extra or changed records. Original system document creation/update times remain in the audit backup; the replacement has new system timestamps. Business/source timestamps and all persisted IDs are unchanged.

The named security rules and project IAM policy were preserved. Standard index exemptions exclude the unqueried `record` map in the eight used collection groups. Billing remains disabled, free-tier eligibility is enabled and deletion protection is enabled. Private backups, credentials, source files, upload receipts and migration logs stay outside Git.

Application checks verified both company reports, 16 available original files by SHA-256, two saved Enfuce drafts with 24 sections and 128 source citations, three calculation lineages and unchanged model runtime settings. The absent original Enfuce PDF remains unavailable. Standard returns collection records in a different order: Enfuce's generated report version is unchanged; Circle's generated inventory version changed because profile enumeration and graph layout changed. Its stored values, observations, source references, calculations and saved IDs did not change. Open Circle sessions may need Refresh/rebind using the existing reference-check flow.

The website was reopened after verification. Its existing logo-only frontend and backend code/PRISM configuration were preserved. No new model calls or source extraction were required for this migration.
