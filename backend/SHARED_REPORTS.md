# Shared report drafts and human workspaces

Editable application reports use a separate `report_drafts` table/collection.
B's imported `narrative_reports`, source quotations, numeric observations and
company evidence IDs are immutable and are never replaced by human edits.

- Existing `POST /deals/{deal}/report/draft` validates/generates a cited draft,
  saves its original payload automatically, and returns the normal generated
  draft plus `persisted_version: 1`. It includes `drafting_preferences`.
- `GET /deals/{deal}/report-drafts` returns `{drafts: [summary, ...]}`, most
  recently saved first. Summary fields are `id`, `deal_id`, `version`,
  `created_at`, `updated_at`, `based_on_report_id`, `model`, `section_count`.
- `GET /deals/{deal}/report-drafts/{id}` returns summary fields plus
  `draft` (original generated payload or null) and `workspace` (human editor
  state or null). A report outside the selected company returns 404.
- `PUT /deals/{deal}/report-drafts/{id}` accepts
  `{expected_version: integer, workspace: object}`. The server atomically saves
  editor state and increments the version, retaining the original generated
  draft. A competing edit returns 409 `draft_version_conflict`; reload the
  shared version or save a separate copy instead of overwriting it silently.
- `POST /deals/{deal}/report-drafts` accepts
  `{based_on_report_id, workspace}` for manual/imported drafts or Save as new.
  It returns a new shared record with version 1 and `draft: null`.
  Stale company evidence returns 409 `stale_report` before creation.

Editor metadata inside `workspace` does not control the record ID, company,
revision or evidence version. Saved human prose is not source evidence or a
verification result. The UI must validate reference bindings and preserve the
human/source distinction before rendering or exporting a restored workspace.
The API requires the editor's `order`, `configs`, `sections`, `revisions` and
`generatedAt` fields, supported unique module IDs, complete module settings,
section text/evidence-ID arrays and revision text fields. Malformed editor state
is rejected with 422 before any write; it cannot poison the company's draft list.

DuckDB initialization adds `report_drafts` and `workspace_settings` to existing
schema-v1 databases, without resetting or modifying their source records.
Firestore stores editable workspaces under `companies/{deal}/report_drafts/{id}`
using the existing checksum envelope. Updates use an atomic document update
precondition; simultaneous backend processes cannot overwrite a competing save.
No new service, paid feature or billing change is required.

Editor state is capped at 450 KB and each complete shared record at 750 KB for
consistent DuckDB/Firestore behavior. Oversized edits return 422 and preserve
the existing shared record. Explicit Save changes avoids writes on each keypress.
