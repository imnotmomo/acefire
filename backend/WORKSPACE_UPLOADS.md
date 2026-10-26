# Company workspaces and source uploads

`app.workspace_routes.workspace_router(store)` supplies the same workflow for
DuckDB and Firebase. Include it in the existing FastAPI application; it adds no
login requirement and does not replace C's report/calculation/chat routes.

- `GET /deals` → `{companies: [Company, ...]}`. Archived workspaces are hidden;
  `?include_archived=true` includes them for restoring.
- `PATCH /deals/{deal_id}` accepts any nonempty subset of
  `{display_name, sector, geography, archived}` and returns `{company}`.
  Labels must be nonblank strings; `archived` is a boolean. These are mutable
  workspace labels stored separately in `workspace_settings`, overlaid in
  `Company.identifiers.workspace_display_name/workspace_sector/workspace_geography/workspace_archived`.
  Legal name, legal entity, original sources, observations and reports remain
  intact. Archive is reversible and existing report/source URLs remain usable.
- `POST /deals` body `{name, sector?, geography?, deal_id?}` → HTTP 201 `{company}`.
  Omitted IDs become `deal-<UUID>`. Supplied IDs allow lowercase letters, digits,
  underscores and hyphens. Retrying the same ID and name/sector/geography returns
  the existing company unchanged; conflicting metadata returns 409. Names/sector/geography are
  user-supplied, unverified metadata in `identifiers.workspace_*`; no Akta lookup
  or legal-entity verification is implied by creation.
- `POST /deals/{deal_id}/uploads` accepts multipart `file` and optional multipart
  `provider` (`uploaded`, `orbis`, `pitchbook`) → HTTP 202 job object.
- `GET /deals/{deal_id}/uploads` → `{uploads: [job, ...]}`.
- `GET /deals/{deal_id}/uploads/{job_id}` → job object; another company's job is
  not returned. A job has `id`, `deal_id`, `filename`, `sha256`, `snapshot_id`,
  `status`, `warnings`, `observations` and `claims` counts. Failed jobs add `error`.
  Status progresses queued → processing → completed/failed. Poll until terminal.

Originals are registered before extraction; failed extraction never becomes a
successful empty result. The source file remains available for inspection/retry.
Two local worker threads handle at most eight accepted jobs; overflow returns
429. An identical company/provider/filename/content upload reuses its active or
completed job ID, so Office/OCR rendering and model extraction run once. Failed
jobs may be retried with the same original. PDF/Office rendering is serialized.
An OS file lease identifies each queued/running worker; process ID reuse cannot
leave a crashed job permanently processing. Startup fails abandoned jobs while
preserving a live worker's lease. Shutdown marks cancelled queued jobs failed.
Jobs/status and the source index are local durable files; this is
not a distributed queue and must run in a single backend process.

## Source formats and numeric boundaries

PDF, DOC/DOCX, PPT/PPTX reuse B's unchanged preparation, Nicrron extraction,
independent PDF quotation validator and source-bound B-to-C numeric normalizer.
The original and converted reading view are separate source snapshots. B's
SQL-only handoff validates in an ephemeral DuckDB, then its exact validated
records are published through the chosen store. No competing model extractor
or fixed financial-calculation fallback is introduced.

Images (PNG/JPEG/WebP/GIF/TIFF/BMP) and PDF pages without text need Tesseract OCR.
They receive a separate OCR PDF reading view, then use B's existing extraction
and quote validator. Original bytes/hash and image frame/PDF page order remain
recorded. OCR quotations require review against the original; OCR text is never
presented as native text or human verification. Documents are limited to 80
pages/frames; images to 40 million pixels per frame. `OCR_LANGUAGES` defaults to
`eng`; extra languages require corresponding installed Tesseract data files.

CSV/TSV and XLSX expose exact original row/cell quotations and raw numeric
observations. Arbitrary numeric tokens do not acquire a guessed unit, scale,
period, actual/forecast classification or reviewed definition. XLSX and XLSM use cached
XML values; formulas and macros are never executed. For supported long tables, explicit
columns `metric_key`, `raw_value`, `unit`, `scale_multiplier`,
`normalization_basis` and optional currency/period/scope/definition fields pass
through C's existing `ExtractedClaim` validation and Decimal normalization. A
partial period keeps its supplied dates. Invalid metadata leaves the original
row visible and emits a warning rather than inventing values. Legacy XLS uses
xlrd's native BIFF cached-cell reader. Its binary numeric values are represented
as exact decimal expansions with unknown normalization and explicit binary-value
notes; authored decimal formatting and dates are not inferred. Spreadsheet
uploads never invoke LibreOffice or another calculation engine. TXT/Markdown/JSON
provide exact original line quotations. CSV/worksheets are bounded at 2,000
rows, and at most 500 quoted rows/cells are extracted; explicit truncation
warnings point to the complete original source. Unsupported types return 415;
nonempty files are limited to 50 MiB (Caddy must allow multipart overhead).

## Runtime and persistence

Set `UPLOAD_CACHE_ROOT=/var/lib/ingenium/uploads` on the VPS, owned/writable by
`ingenium` and outside the web root. The service needs a writable allowance for
this directory. It contains private originals, extraction artifacts, job files
and `source-files.json`. Firestore records exclude local filesystem paths;
`FirebaseStore.local_source_file` consults this private index before the existing
read-only source manifest. Source preview/download endpoints still hash-check
the actual original against its immutable snapshot before returning content.

Install LibreOffice Writer/Impress for Office conversion and Tesseract for
images/scanned PDF. `TESSERACT_BIN` may select its executable. Existing Nicrron
credentials configure B's pinned vision model; secrets never enter job status.
Create-only Firestore records use C's checksum envelope and cache invalidation.
Large write sets use bounded batches; a failure can leave valid immutable
prefix records and a failed job. Re-uploading identical content safely reuses
its timestamp/identities and retries without overwriting originals. Newly
persisted claims/observations immediately feed C's report, lineage and chat
catalog; calculation still requires compatible normalized source inputs.

## Reviewing ordinary spreadsheet numbers

`POST /deals/{deal_id}/observations/{observation_id}/normalize` creates an
immutable reviewed observation from an existing raw value. It accepts
`metric_key`, `unit`, exact decimal-string `scale_multiplier`, nonblank
`normalization_basis`, required `period_kind` (`unknown`, `instant`, `duration`),
and optional `currency` (ISO3), `definition_key` from the reviewed registry,
`scope`, `accounting_basis`, `period_start`, `period_end`, `period_label` and
`scenario` (`unknown`, `actual`, `forecast`). Instant periods require only an
end; durations require both ordered dates; unknown periods have no dates.

The API does not accept a replacement raw or final value. Decimal arithmetic
uses the source's existing raw value and the supplied explicit scale. Ambiguous
tokens and Akta estimates remain unresolved. A successful response is
`{observation, reviewed_from_id, created}`; identical retries reuse the same
review ID. The new observation includes `reviewed_from_id`, exact original
source/hash/locator/raw value, and `verification_status: needs_review`.
Original records and previous calculations are retained. Select the new input
explicitly and rerun a calculation; no result is silently replaced.
