# B → C: display-ready narrative and sourcing

The human authorized all 12 frontend modules, not just raw claims or Company
overview. B now owns drafting, source alignment review, three display statuses,
and sentence-to-source binding. C consumes the saved result; C does not need
to rewrite text or discover citations. No embedding is required.

## Output contract

`schema_version: b-narrative-v1`. A versioned report has:

| Field | Meaning |
| --- | --- |
| `id`, `created_at` | Immutable report identity and publication timestamp |
| `deal_id`, `entity_key` | Registered C document-workspace identity |
| `module_order` | All 12 IDs matching `frontend/src/data.ts` |
| `sections` | Frontend-ready sections: `id`, `title`, `content`, `evidenceIds`, `config`, `entries`, `status` |
| `sections[].entries` | Topic, display text, status, evidence IDs, optional differing alternatives, review method |
| `sources` | Citation ID, snapshot ID, filename, page locator, exact quote, SHA-256, source URI and file/viewer API URLs |
| `source_scope` | Exactly which source snapshots/pages were read, historical scope label and catalog hash |
| `summary` | Entry counts for `missing`, `verified`, `difference` |
| `withheld` | Internal failed/uncertain draft IDs and reasons; do not render them as company facts |
| `provenance` | Gateway/model/request IDs, prompt/schema/catalog/response hashes and separate review calls |

`content` already includes `[citation-uuid]` markers, and `evidenceIds` provides
the corresponding citation keys. `entries[].text` omits markers for renderers
that display references separately. Each `sources[].viewer_url` opens the exact
registered PDF with `#page=N`; `file_url` downloads/views hash-checked source
bytes using C's existing `/sources/{id}/file` route. URI/version metadata are
server-derived, not invented by the model. Do not interpret `upload://` URIs
as publicly retrievable websites.

The frontend's existing `Section` fields are retained in B's payload. C's latest
`stored_narratives.py` already adapts imported reports into its narrative contract
and keeps upstream automated `verified` as human-review `verify`, not a human
approval. C's frontend maps `enfuce-documents` to `enfuce-2020`; the original
`enfuce` remains the historical demo. See `FIREBASE_INTEGRATION.md` for C's current
Firestore import/UI integration. This change preserves that code and does not
modify frontend edits/revisions, C's `app/narrative.py` or its company Chat.
B's offline implementation is `app/document_narrative.py` to avoid a name collision.

## Three display statuses

- `verified`: located quotes support the displayed wording according to a
  **separate automated semantic review**. It is not human sign-off, an audit,
  independent corroboration, or verification of present-day truth. Source-time
  marketing claims stay attributed. Review method/reason are attached to entries.
- `missing`: the selected reviewed sources do not support a publishable answer,
  or review remains incomplete. It never proves the company lacks that feature
  or that evidence does not exist elsewhere. Missing entries show a coverage
  limit or follow-up request and have no factual citation marker.
- `difference`: each differing alternative has source support, an explicit
  matching subject/period/scope/definition/scenario, disjoint original source
  hashes, and a positive comparability review. Different years, forecast vs
  actual, or incomparable licenses/definitions do not become a difference.

Statuses are assigned per displayed entry. Section summary prioritizes
`difference`, then `missing`, then `verified`; a section may therefore have
verified paragraphs while its overall status remains missing due to other
unanswered topics. All configured subtopics are present in every report.
Internal draft/uncertain/rejected states are separate and never promoted by a
successful quote match alone. Existing `document_claims`/numeric observations
retain their original `needs_review` states; raw records are not rewritten.

## Generation and publication

From repository root, with C's API stopped for this database file:

```bash
export NICRRON_API_KEY_FILE=/path/to/nicrron_key.txt
PYTHONPATH=.:backend python -m backend.evidence.generate_narrative \
  --database runtime/acefire.duckdb --deal-id enfuce-2020 \
  --source-id REGISTERED_PDF_SNAPSHOT_ID \
  --scope-label 'Specific historical documents reviewed; excluded materials' \
  --output runtime/enfuce-narrative-v1
```

All module/topic names are copied from the frontend. The input catalog is built
from C's stored, hash-checked source bytes (full text from every readable PDF
page), so the report can use source text not present among earlier raw claims.
Every new citation is independently checked against the exact source page.
The pinned sponsor route remains Nicrron + `openai/gpt-4.1`.

Drafting and semantic review use distinct model requests. Both request/response
artifacts are saved locally. The reviewer sees full page context, not only the
draft sentence. Unsupported/uncertain entries are withheld. Missing topic slots
are filled with explicit coverage gaps. A source hash/catalog change blocks
publication. No source record, number, calculation or human-edited frontend
section is changed by generation.

Drafting is batched into two modules per request to avoid the sponsor gateway's
long-response timeout. Complete drafts are then reviewed in groups of 20 items.
If a draft has ellipsis-separated quotations, each piece must be independently
located on the same declared page and becomes a separate citation. No invented
span is dropped to rescue an otherwise invalid quotation. Location failures are
withheld per item, allowing other supported entries to continue. Splits and
rejections are recorded in `location-review.json` and report provenance.

An optional `--edits /path/to/editorial-edits.json` maps namespaced draft IDs to
source-alignment wording/citation corrections. The original sponsor response
remains immutable. Edits require a new output run and fresh review requests;
manifest hashes prevent old verdicts from being reused for changed text. In the
Enfuce run, Codex checked and narrowed wording (bounds, dates, attribution,
planned-vs-completed status, and cited coverage) before the second model review.
This is agent review, not human approval; `human_reviewed` stays false.

Publication appends one immutable JSON snapshot to `narrative_reports` in C's
**same DuckDB file**. DDL is `database-design/narrative.sql`; C financial schema
v1 is unchanged. ID/content conflicts are rejected; repeat publication of the
same reviewed version is idempotent. `--resume` reuses saved model responses
without repeating completed provider calls, and rejects changed manifests.

## Read API

For the offline DuckDB backend, see `DOCUMENT_INTAKE.md`. These read routes also
delegate through C's `document_claims`/`narrative_reports` storage methods for
imported Firestore records; no SQL transaction is opened on the Firestore path.

| Endpoint | Purpose |
| --- | --- |
| `GET /deals/{id}/narrative-report` | Latest saved report; does not call a model |
| `GET /deals/{id}/narrative-report?report_id={version}` | Exact immutable version |
| `GET /deals/{id}/narrative-evidence/{citation_id}?report_id={version}` | Evidence belonging to that deal and report version |
| `GET /sources/{snapshot_id}/file` | Original/reading-view bytes with hash check |

C should keep the report ID with the draft and citation lookup. A citation ID
from another deal/version returns 404. Do not overwrite human edits with a newer
generated report without following the existing frontend regeneration flow.

## Local handoff files

Each generation run exports `c-handoff.json` (complete API-shaped report),
`frontend-text.md` (all modules and citations, readable by people), and
`receipt.json` (report ID/counts/API path), plus reproducible source/model artifacts.
Original private documents, runtime, responses, credentials and database stay
outside Git. The JSON contains private source quotations; it is not a public
report. These local files are ready to hand to C, not already transferred to
another computer. File URLs require the backend with its source cache; copying
the DB/JSON alone does not transfer original file bytes.

Current Enfuce scope is the April 2020 Deck only, not Memo/FDD, Akta, external
research or current company data. An optional clinical topic with no supporting
material is a missing evidence topic, not an invented clinical assessment.

This publication includes the implementation. The verified local run used the
separate `acefire-integration` checkout; original B files and its running API
remain preserved. C's latest imported-report adaptation is preserved; new B output remains a
versioned handoff for C's importer. Publishing code does not synchronize private application data. Chat is
explicitly excluded from this upload and remains local for a later change.

## Completed Enfuce output, 2026-10-24

- Current immutable version: `36fbcf8c-d8cc-5643-aa6b-e802762fe1ed`.
- Output directory: `runtime/enfuce-narrative-v4/`.
- All 12 modules and all frontend topics have display entries: **46 verified,
  23 missing, 0 difference**, backed by **60 distinct exact source quotations**.
- One historical Deck/version was reviewed; no comparable cross-source
  difference was established. Within-document license wording is a follow-up
  question; it is not silently reconciled or called independent corroboration.
- Codex recorded 40 wording/citation edits, then fresh sponsor requests reviewed
  the edited entries. Boundaries, source-time statements, geographic qualifiers,
  market-vs-company values, and plans-vs-achieved states were narrowed explicitly.
  Original model responses remain intact. Human review is still false.
- All 12 sections and all 60 citation lookup routes were read back from the
  persisted database; source PDF download was checked against SHA-256. Cross-deal
  report lookup returned 404. Existing 39 raw claims and 19 numeric observations
  were preserved. Financial computation code/schema were not changed.
- Full suite: **245 passed, 1 skipped**; narrative tests include located quote
  checks, all module/topic coverage, unknown/missing semantic reviews, different
  years/scopes/scenarios, immutable storage, source tampering, cross-deal/version
  isolation, resume without repeat provider calls, and changed edits requiring
  a fresh review. Actual report generation used Nicrron/OpenAI gpt-4.1.
- The original all-module request hit a gateway HTTP 502 upstream timeout.
  Batching into two modules per request completed; earlier attempts remain
  reproducible in runtime. The previous v3 report is retained as an immutable
  earlier version; consumers should use the v4 ID or latest saved report.

`c-package.zip` includes the complete JSON, readable Markdown, company mapping,
source-snapshot metadata, this contract, and the original PDF bytes. Each asset
is named by its SHA-256. Host-local source paths are stripped and must be rebound
by C after extraction. No credential or raw model response is included. This is
the portable handoff; `c-handoff.json` alone contains citations/API paths but
does not contain original PDF bytes.
