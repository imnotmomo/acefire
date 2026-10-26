# Product workflow repair: QA review

This work is held on QA until the human explicitly approves production promotion. The current source baseline includes the teammates' landing changes through `qa/3dde558`; production was `152d212` at the start of this audit. No production data or deployment changes are part of testing.

## Acceptance workflow

Use the real browser controls, not only direct API requests:

1. Create a company, reload, and find it from another browser session. Edit its display metadata; archive and restore without deleting evidence.
2. Select CSV/Excel, text, PDF/Office and image files using the actual file chooser. Observe queued/processing/completed or actionable failure, retry, deduplication and reload recovery.
3. Open/download originals and reading views; inspect file hashes, pages, rows and distant worksheet cells. Recover from failed previews without re-uploading.
4. Review numeric metadata for ordinary uploads, select compatible inputs, calculate through the configured model, and inspect exact values, periods, code and input lineage. Unknowns and conflicts remain explicit.
5. Ask company and source questions, follow validated citations, switch chat modes, and retain unsent questions and conversations after closing/reopening.
6. Configure and generate reports; cancel/retry safely; preserve edits when sources/settings change; save shared drafts; load and revise from another session without silently overwriting concurrent changes.
7. Review cited passages, revisions and missing evidence, then export PDF, Word and Markdown with readable Unicode and source references.
8. Test project navigation, notifications, help, filters, empty/error states, keyboard and mobile behavior. Every enabled control must have an actual action; unavailable inputs need an explanation and next step.
9. Publish through feature PR into QA, wait for the exact QA deployment, then rerun a bounded real workflow and verify preserved baseline data. Do not open or merge a production promotion PR without approval.

## Reproduced failures under repair

| Area | Reproduced failure | Repair / validation |
| --- | --- | --- |
| File chooser | Input reset empties its live FileList before upload copies it | Snapshot selected files before reset; actual chooser regression |
| Source download | Preview's decimal 50 MB cap rejects valid 50 MiB uploads | Separate original download and inline preview limits |
| Workbook viewer | Rows paginate but distant columns cannot be reached | Cell/sheet navigation, safe response validation and retry |
| Chat | Closing/switching loses unsent text and successful source conversations | Company/source-scoped recovery with citation revalidation |
| Numeric uploads | Ordinary spreadsheet numbers lack a usable unit/scale review flow | Explicit source-bound reviewed normalization; originals retained |
| Reports | Settings/source refresh races can replace the wrong draft | Version/settings guards, cancellation and bounded requests |
| Report persistence | Generated and edited application drafts exist only in a browser | Additive shared draft storage with optimistic version checks |
| Projects / notifications | Imported real Enfuce is hidden; counts and alerts use a fixed historical example | Discover real companies and derive current state; keep examples explicit |

## Evidence and limits

Local mocked tests, actual browser interaction, native conversion/OCR, model calls, and deployed QA checks must be recorded separately. A green API smoke test does not prove that a file chooser or button works. Test data stays in QA; generated analysis remains unverified and source-linked. Login remains deferred under the existing scope. Missing original files and unavailable live Akta access must not be fabricated or presented as working integrations.

## Local verification before publication

- Backend: 432 passing tests, no skips; includes installed LibreOffice conversion and Tesseract OCR. Provider responses are mocked in the offline suite. Nine new regression workflows cover immutable numeric review, shared draft version conflicts, malformed workspace rejection, additive old-database compatibility, label/archive overlays and abandoned upload recovery.
- Frontend: 107 unit/SSR tests; production TypeScript/build checks. Browser suites cover 10 intake/chat workflows, 14 report workflows, 6 number-review workflows, 9 workspace workflows, 10 motion checks and the landing sample controls. Each suite intercepts API requests and uses synthetic evidence.
- Deployment: 53 boundary/archive/controller tests passed. Browser suites now run in CI before an artifact is packaged.
- Review found and fixed malformed saved report payloads that could break an entire company’s draft list, same-basis saved quotation spoofing, a delayed company-list response overwriting newer settings, and mobile navigation ignoring Escape.

Deployed QA checks and exact release identity will be recorded after publication. Production promotion remains held for explicit human approval.
