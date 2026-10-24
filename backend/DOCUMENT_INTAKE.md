# B → C: document numbers and text

Scope: extract source-reported numbers and textual facts from PDF/Word/PowerPoint,
locate their quotations, and store them in C's DuckDB for C to read. No embedding,
semantic retrieval, thematic report generation, or chat is included.

## Current implementation

- `evidence/ingest_document.py` preserves originals, builds PDF reading views,
  and sends page batches through Nicrron with `openai/gpt-4.1`.
- `evidence/import_claims.py` checks source hashes and continuous quotations.
  Unmatched quotations and numeric tokens are review items, not accepted facts.
- `evidence/save_to_db.py` rechecks the prepared source and quotations, registers
  immutable uploads using C's existing source intake, and stores document claims.
- `app/document_intake.py` adds `document_claims` in the **same DuckDB file**.
  The base financial tables, schema version 1 and calculation code are unchanged.
  DDL is in `database-design/document-intake.sql`. The extension is initialized
  explicitly on first document ingestion; C's existing databases remain readable.
- Each document claim contains its text, subject/name (possibly unresolved),
  original and reading-view snapshot IDs, quote/page, native Office locators,
  model, extractor version, limitations and `needs_review` status.
- Numeric candidates retain raw values and the model's original metadata in
  `numeric_source`. An incomplete/invalid period becomes unknown without adding
  dates; an invalid scale becomes null without interpreting words or separators.
  These changes carry explicit notes. The original raw output is also preserved.
- `--submit-numbers` passes candidates through C's existing `ExtractedClaim`,
  `ingest_b_claims` and `Store.ingest` into `source_observations`. C owns Decimal
  normalization and calculation. No reviewed definition key is inferred.

Registration, the document claim batch, and optional numeric intake are separate
idempotent transactions. A document batch is atomic. If interrupted between
stages, rerun the same inputs with a new receipt filename. Existing IDs cannot
be silently rewritten. Run the CLI with the API stopped: only one process may
write a given DuckDB file. Do not run a second database service for B.

## Run on a document

From the repository root, install `backend/requirements.txt` in a Python 3.10+
environment. Word/PowerPoint conversion requires LibreOffice; `SOFFICE_BIN` can
point to its executable. Model credentials remain local environment variables.

```bash
export PYTHONPATH=.:backend
export NICRRON_API_KEY_FILE=/path/to/nicrron_key.txt
python -m backend.evidence.ingest_document \
  --file /path/to/deck.pdf --deal-id selected-deal \
  --output runtime/deck-v1 --document-type pitch_deck --extract
```

Prepare a `company.json` following C's `app.schemas.Company`. Deal/entity mapping
is explicit, not invented by the model. For an existing deal, use its exact C
mapping. For Office, `--run` is the `prepared_run` shown by preparation (usually
`runtime/deck-v1/prepared`); results remain `runtime/deck-v1/results`.

```bash
python -m backend.evidence.save_to_db \
  --run runtime/deck-v1 \
  --handoff runtime/deck-v1/results/handoff.json \
  --company /path/to/company.json \
  --database runtime/acefire.duckdb --cache runtime/source-cache \
  --receipt runtime/deck-v1/db-receipt.json --submit-numbers
```

The source documents, credentials, runtime output, source cache, database and
local environment are excluded from Git. This integration lives in a separate
local checkout (`acefire-integration`) to preserve the original B working files.
This publication includes the code, additive table and read routes for C to
integrate. Private source data and runtime artifacts remain local; cloning the
repository does not populate the Enfuce database.

## C reads the saved records

Start the **same** backend process against the saved database, from repo root:

```bash
DUCKDB_PATH="$PWD/runtime/acefire.duckdb" PYTHONPATH=backend \
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

| Read endpoint | Contents |
| --- | --- |
| `GET /deals/{id}/document-claims` | Textual and numeric document claims with evidence |
| `GET /deals/{id}/document-numeric-packet` | Existing C-compatible `{"claims": [...]}` numeric request body |
| `GET /deals/{id}/observations` | Numeric candidates saved through C's existing intake |
| `GET /sources/{snapshot_id}/file` | Hash-checked source file or reading view |

The two document endpoints accept `snapshot_id`, `limit` (1–2000) and `offset`.
Numeric packet pagination refers to underlying document-claim rows; page through
all document rows, even when one page has no numeric candidates. A packet from
the numeric endpoint can be sent to the existing `POST /deals/{id}/claims/batch`.

Office reading-view PDF page locators reference the PDF snapshot. Original
paragraph/table/slide coordinates reference the Office snapshot separately.
Never label a converted PDF page as an original Word page or slide.

## Actual Enfuce run, 2026-10-24

- Input: the 31-page April 2020 Enfuce Deck. All 11 batches processed via the
  sponsor gateway; this is processing coverage, not exhaustive fact extraction.
- Accepted into the local database: 39 document claims (20 text-only, 19 numeric)
  with 36 distinct source-located evidence records. Numeric candidates also
  appear as 19 C `source_observations`.
- All 19 normalized numeric `value` fields remain null. Sources use bounds,
  textual units/scales or insufficient normalization context; no exact decimal
  value is invented. Raw numeric strings and period/scenario labels are saved.
- 45 rejected extraction records remain in `results/review-items.json`; they
  were not admitted as accepted evidence. There are duplicates/related claims
  from overlapping batches; no semantic deduplication is claimed.
- All accepted facts still require semantic review, including forecast/actual
  classification, conditions, quoted context and entity relationships. Enfuce's
  workspace mapping is provisional (`enfuce-document-workspace`); it is not a
  verified legal-entity/Akta match. Subjects remain unresolved unless identified.
- Local artifacts: `runtime/acefire.duckdb`, `runtime/source-cache/`, and
  `runtime/enfuce-deck-v3/{db-receipt.json,results/,c-handoff/}`. Source cache paths
  in the database are absolute to this host. Moving the database alone does not
  transfer source files; C should access this backend or reimport the prepared
  artifacts on its own host with an agreed company mapping.
- Persistent API verification read back all 39 claims and downloaded the
  registered original PDF. Office DB provenance uses real conversions with
  mocked extraction in tests; only this PDF used a real model in this change.

## Tests

From root: `PYTHONPATH=.:backend:backend/tests python -m pytest backend/tests -q`.
Tests need `pytest`, `httpx` and `reportlab` in addition to requirements; the
real conversion tests require LibreOffice. Existing financial fixtures are kept.

Final validation: **231 passed, 1 skipped** with the repository's saved Circle
fixtures and LibreOffice. The 13 new DB tests passed, including Word/PPT
original-versus-representation provenance. A diagnostic run pointed at B's older
single-file Akta cache produced 7 fixture-expectation failures (C expects both
the enrichment and financial saved responses); restoring the repository fixture
path resolved them without changing C's tests or application logic.

## Current C integration

C's latest running backend uses Firestore, with DuckDB as B's import/handoff and
an offline compatible backend. This CLI writes DuckDB; it does not push to cloud.
C already imports the original B claim/report payloads and exposes adapted reports;
see `FIREBASE_INTEGRATION.md`. Added B read routes use C's storage interface and
work for DuckDB or imported Firestore records. Actual original-file preview on
C's machine requires its source-file manifest/assets; quotations alone do not
transfer the PDF. No B Chat or separate Firebase connector is included here.
