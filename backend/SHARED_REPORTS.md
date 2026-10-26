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

The complete logical report is bounded at **5 MB (5,000,000 UTF-8 bytes)**,
including its immutable generated draft, editable workspace, every revision and
metadata. The workspace is also bounded at 5 MB; the combined record limit is
authoritative. The physical stored record remains bounded at **750,000 bytes**, below
the existing Firestore envelope guard of 800,000 bytes and document limit.
Small records remain ordinary JSON. Larger records use a versioned
`canonical-json-zlib-base64-v1` representation in the same table/collection.
The API still returns the original complete JSON shape.

This is lossless storage, not pruning: all supplied evidence-manifest entries,
source graphs, exact decimal strings, quotations, hashes, locators, generated
sections and human revisions remain in the decoded record. Canonical UTF-8 JSON
is compressed, checksummed and stored with its exact decoded byte count and
summary/version metadata. Reads bound decompression output, reject trailing or
truncated streams, verify the checksum and metadata, and enforce company/document
scope. Firestore's outer checksum envelope and atomic version precondition are
unchanged. No new collection, index, storage account or paid feature is required.

Incompressible content that cannot fit the physical bound, excessive decoded
data, malformed structure and invalid metadata return a recoverable error
without replacing the existing shared version. Damaged records remain visible
as unavailable entries while other reports still load. Explicit Save changes
avoids writes on each keypress. Browser-local recovery remains subject to browser
storage quota and reports its existing failure message when a copy cannot be kept.

## Compatibility and rollback

This reader supports both existing plain JSON and the new compressed format.
It does not migrate or rewrite old records merely by reading them. Original
evidence collections and their hashes are unchanged.

**An older backend cannot read or safely update a compressed report.** After the
first compressed write, do not activate an old binary against writable shared
report data. Before any rollback, pause shared-report writes and preserve a
current database backup/export. With this reader still running, the existing
GET detail API exports each report as its complete logical JSON, including
history and source provenance; retain these copies privately. Keep the compatible
storage reader in a rollback release, or roll forward to this reader to recover
compressed reports. Do not restore an older database snapshot over reports
written after deployment or silently delete compressed records to make an old
binary appear compatible. A real downgrade requires a separately reviewed data
migration; some large reports cannot fit in the legacy single-document format.
