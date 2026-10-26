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

- Backend: 436 passing tests, no skips; includes installed LibreOffice conversion and Tesseract OCR. Provider responses are mocked in the offline suite. Nine new regression workflows cover immutable numeric review, shared draft version conflicts, malformed workspace rejection, additive old-database compatibility, label/archive overlays and abandoned upload recovery.
- Frontend: 107 unit/SSR tests; production TypeScript/build checks. Browser suites cover 11 intake/chat workflows, 19 report workflows, 10 number-review workflows, 9 workspace workflows, 10 motion checks and the landing sample controls. Each suite intercepts API requests and uses synthetic evidence.
- Deployment: 53 boundary/archive/controller tests passed. Browser suites now run in CI before an artifact is packaged.
- Review found and fixed malformed saved report payloads that could break an entire company’s draft list, same-basis saved quotation spoofing, a delayed company-list response overwriting newer settings, and mobile navigation ignoring Escape.

Deployed QA checks and exact release identity will be recorded after publication. Production promotion remains held for explicit human approval.

## Control coverage

Repeated buttons bound to the same handler are checked with different source/company identities; unavailable originals and live Akta access stay explicitly unavailable. The enabled controls are covered as follows:

| Surface | Controls exercised | Evidence |
| --- | --- | --- |
| Projects | Company create/validation/retry/cancel; search, sector, grid/list and active/archive/example collections; open dashboard/data room/report; rename, archive and restore across sessions | projects-workflow + transitions |
| Navigation | Home/projects/workspace links, all report stages, browser history, rapid navigation, mobile menu/overlay/Escape, help, company-specific notifications and recovery routes | projects-workflow + transitions |
| Dashboard | Metric/source inspection, profile search/pagination, period coverage, stored calculation details, graph node selection and zoom | component/adapter checks; deployed QA inspection |
| Calculations | Configuration refresh, question, input/source filters, selection/clear, premise selection, exact parameters, numeric review and metadata validation/retry/cancel; generate/run, stop waiting and stored-result refresh | normalization-workflow + deployed live model run |
| Data room | Actual chooser/multiple selection/reselection, provider selection, drag/drop, durable processing/reload, cached retry, receipt dismissal/restore, existing local-file bridge, source search/filter and source chat launcher | intake-workflow + live synthetic uploads |
| Evidence | Open file/download original, passive preview, worksheet/cell/row/column navigation, retry, original quote/locator/hash; lineage and execution views | source-preview/source-file units + intake-workflow + live hash readback |
| Company/source chat | Open/close/mode switching, type/send/Enter, retry, current-report refresh, citation buttons, original-source opening, draft/history recovery | chat-persistence + intake-workflow + deployed live calls |
| Report builder | Module selection/search/order, topic/settings edits, generate/stop/retry; empty prerequisites; server error and delayed-response protection | report-workflow + deployed generation |
| Report review | Cited sentence/number selection, findings/outline/activity, source inspection, edit/save revision, compare and restore actual text, shared Save/Load/copy/conflict recovery | report-workflow + report/reference/review units |
| Export | Review/build navigation, PDF/Word/Markdown format selection and real downloads, stale citation recovery and font failure retry | report-workflow; extracted PDF text and source assertions |
| Landing | Navigation, tabs, source links available while the sample types, pause/resume/replay, reduced motion and direct workspace entry | landing-chat-sample + mobile layout checks |

The first QA PR CI run (40331990295) passed backend tests and all new product workflow groups before an existing transition timing assertion missed its 320 ms animation window on the runner. The test was made deterministic without lengthening production motion or removing visible-frame assertions. Failed browser artifacts are now retained by CI for diagnosis. Production remains unchanged.

- Follow-up to the human’s control audit: Generate report and Generate and run calculation stay actionable while idle. Missing prerequisites produce visible, focused guidance; they never silently return. Report errors scroll into view, and calculation questions/parameters/valid input IDs survive navigation per company without automatic execution. Builder and review controls were exercised directly, including arrows/drag, preference fields, source/activity filters, history and source inspection. File drag/drop with two originals preserves selected PitchBook attribution.
- Transition regression now passes with 4x CPU throttling and a 700 ms observation delay, preserving production’s 320 ms motion, visible effect assertions and reduced-motion behavior.

- Upload lease initialization was made portable: real Unix contention/release is tested, and Windows import/byte-lock behavior is simulated. Actual Windows execution was not performed. Full backend suite now passes 436 tests with no skips.
