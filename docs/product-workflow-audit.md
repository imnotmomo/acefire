# Product workflow repair: QA review

**QA is deployed and verified; production promotion still requires explicit human approval.** The live acceptance baseline was `d18a5563f4e285b1de2b0efc7c2625a61881c931` at [qa.linearproduct.co](https://qa.linearproduct.co). [QA CI/CD run 40359088969](https://github.com/imnotmomo/acefire/actions/runs/40359088969) passed checks and deployment. Production has not been promoted by this audit.

## Current acceptance evidence

| Check | Verified result |
| --- | --- |
| Automated backend gate | **444 passing tests**, no skips; actual LibreOffice conversion, Tesseract OCR and PDFium rendering are included. Model/provider responses are mocked in offline tests. |
| Automated frontend gate | **114 unit/SSR tests**, TypeScript and production build passed. |
| Browser workflow gate | **88 groups** using actual controls with intercepted APIs and synthetic evidence: 13 intake/chat, 19 report, 10 number-review, 11 workspace, 13 evidence, 11 PDF viewer, 10 motion and 1 landing sample. |
| Deployment gate | **53 boundary/archive/controller tests** passed. The deploy job consumes this run’s `home-release-d18a5563f4e285b1de2b0efc7c2625a61881c931` artifact, containing `release.tar.gz` and `manifest.json`. |
| Served report generation | The actual Generate report control returned a cited **two-section** model report. Its source quotation opens `overview.txt`, **line 2**, with the exact recorded quotation and SHA-256. |
| Served calculation | The actual calculation workflow saved **3000.3750 USD**. The stored result is available through the served UI. |
| Shared report persistence | **Save version 3**, reload and Load shared retained the human edit and complete citation markers. |
| Actual exports | The served UI downloaded a **13-page PDF (89,090 bytes)**, **DOCX (17,082 bytes)** and **Markdown (40,247 bytes)**. Parsed files preserve exact raw values, source hashes, line-2 evidence and citation markers. |
| Live company chat | Actual model answer traced to `overview.txt`, line 2, exact hash and original file text. The answer and exact unsent draft survived closing, reloading and reopening. |
| Live source chat | Actual model answer cited `overview.pdf`, page 1, exact hash. Open file displayed a decoded **1600 × 2263** passive PDF page without alerts. Answer history and its separate unsent draft survived mode switching and reload. |
| Source files and workbook | All **11 file hashes** passed: 8 originals and 3 reading representations. `Finance!AF49` retained **12345678901234567890.123456**. Source relationships remain explicit. |
| Workspace settings/archive/restore | Actual UI rename persisted in API workspace identifiers while legal identity stayed unchanged. The label was reverted; Archive removed the card from Active and placed it in Archived; Manage → Restore returned it to Active and its dashboard opened. API readback confirmed archive=false, all 11 source hashes and shared report version 3 unchanged. |
| Existing evidence preservation | Baseline Circle/Enfuce persisted IDs and source hashes remain unchanged. Synthetic intake and model execution stayed in isolated QA workspaces. |

Served-release checks passed for synthetic workspace settings/archive/restore, intake, calculation, report generation/persistence/exports and both model-chat/source-opening workflows, including reload retention. These checks used isolated QA data and preserved the existing evidence baseline. Login and live Akta retrieval remain outside the current scope; neither is presented as a completed integration.

Browser evidence is written under `frontend/test-results/`, including `report-workflow/results.json`, `pdf-preview-workflow/results.json`, `desktop-readable-source-page.png` and the mobile 400% left/right source images. These local intercepted-renderer artifacts are separate from the served-release checks and actual downloaded reports above. CI retains failed browser evidence for diagnosis.

## Acceptance workflow

Use real browser controls, not only direct API requests:

1. Create a company, reload, and find it from another browser session. Edit display metadata; archive and restore without deleting evidence.
2. Select CSV/Excel, text, PDF/Office and image files through the actual chooser. Observe queued/processing/completed or actionable failure, retry, deduplication and reload recovery.
3. Open/download originals and reading views; inspect hashes, pages, rows and distant worksheet cells. Recover from failed previews without re-uploading.
4. Review numeric metadata for ordinary uploads, select compatible inputs, calculate through the configured model, and inspect exact values, periods, code and input lineage. Unknowns and conflicts remain explicit.
5. Ask company and source questions, follow validated citations, switch chat modes, and retain unsent questions and conversations after closing/reopening and reload.
6. Configure and generate reports; cancel/retry safely; preserve edits when sources/settings change; save shared drafts; load and revise from another session without silently overwriting concurrent changes.
7. Review cited passages, revisions and missing evidence, then export PDF, Word and Markdown with readable Unicode and source references.
8. Test navigation, notifications, help, filters, empty/error states, keyboard and mobile behavior. Every enabled control must act; unavailable inputs need an explanation and next step.
9. Publish a feature PR into QA, wait for that exact QA deployment, then rerun bounded real workflows and verify preserved baseline data. Do not open or merge a production promotion PR without approval.

## Reproduced failures and repairs

| Area | Reproduced failure | Repair / validation |
| --- | --- | --- |
| File chooser | Reset empties its live FileList before upload copies it | Snapshot selected files before reset; actual chooser regression |
| Source download | Decimal 50 MB cap rejects valid 50 MiB uploads | Separate original download and inline preview limits |
| Workbook viewer | Rows paginate but distant columns cannot be reached | Cell/sheet navigation, safe response validation and retry; live exact-cell readback |
| Chat | Closing/switching loses unsent text and successful source conversations | Company/source-scoped recovery with citation revalidation; live reload acceptance |
| Numeric uploads | Spreadsheet numbers lack usable unit/scale review | Explicit source-bound reviewed normalization; originals retained |
| Reports | Settings/source refresh races can replace the wrong draft | Version/settings guards, cancellation and bounded requests |
| Report persistence | Generated and edited drafts exist only in a browser | Additive shared storage with optimistic version checks and recovery copies |
| Projects / notifications | Real Enfuce hidden; counts and alerts use a fixed example | Discover real companies and derive current state; historical examples stay explicit |
| Evidence links | A premise opened an authenticated API URL directly and returned 401 | Standard checked file action and inspector File tab; foreign/changed bindings rejected |
| PDF preview | Native PDF frame is blank in the real in-app browser | Hash-bound static PNG pages from an isolated PDFium worker; actual decoded page accepted |
| Reading-view state | Office/image originals appear Missing when claims use derived PDFs | Company-bound original/reading relationships and explicit Reading view evidence · Verify labels |
| Generate affordances | Incomplete idle forms look disabled or silently return | Visible prerequisite guidance, working upload/module actions, focused inputs and visible runtime errors |

## Control coverage

Repeated buttons sharing a handler are checked with different source/company identities. Missing originals and unavailable live Akta access stay explicit.

| Surface | Controls exercised | Evidence |
| --- | --- | --- |
| Projects | Create/validation/retry/cancel; search, sector, grid/list, active/archive/example collections; dashboard/data room/report; rename/archive/restore across sessions | projects-workflow + transitions + actual served rename/archive/restore/API readback |
| Navigation | Home/projects/workspace links, report stages, browser history, rapid navigation, mobile menu/overlay/Escape, help and company-specific notifications | projects-workflow + transitions |
| Dashboard | Metric/source inspection, profile search/pagination, period coverage, stored calculation details, graph selection and zoom | evidence-workflow + served QA inspection |
| Calculations | Configuration refresh, question, filters, selection/clear, premises, exact parameters, numeric review/retry/cancel; generate/run, stop waiting and saved-result refresh | normalization-workflow + actual served model calculation |
| Data room | Actual chooser/multiple selection/reselection, provider selection, drag/drop, durable processing/reload, cached retry, receipt dismissal/restore, browser-file bridge, source search/filter and chat launcher | intake-workflow + actual synthetic QA uploads |
| Evidence | Original download/hash retry, quotes/locators, worksheet/cell/row/column navigation, inspector tabs, execution, graph/zoom, clipboard success/failure | evidence-workflow + source units + served hash/locator readback |
| PDF reading | Cited page, previous/next/jump, invalid-page rejection, zoom 75–400%, mobile panning, timeout/retry, corrupt/truncated/oversized responses and source-switch cancellation | pdf-preview-workflow + native backend rendering + actual decoded QA page |
| Company/source chat | Open/close/mode switching, send/Enter/retry, report refresh, citations, original files, draft/history recovery and reload | chat-persistence + intake-workflow + both actual served model replies and source-opening checks |
| Report builder | Module search/add/remove/order, arrow/drag, topics/settings, `/` shortcut, generate/stop/retry; prerequisites, server errors and delayed-response protection | report-workflow + actual served generation |
| Report review | Cited passage selection, findings/outline/activity, source inspection, edit/save revision, compare/restore, shared Save/Load/copy/conflict recovery | report-workflow + report/reference/review units + actual Save 3/reload/Load shared |
| Export | Stage/footer navigation, PDF/Word/Markdown selection/download, stale-reference refresh and font-error retry | report-workflow + actual downloads and parsed source/value assertions |
| Landing | Navigation, tabs, source links while typing, pause/resume/replay, reduced motion and direct workspace entry | landing-chat-sample + mobile layout checks |

## Evidence boundaries

Offline mocks, real browser interaction, native conversion/OCR, live model calls and deployed QA checks are recorded separately. A green API smoke does not establish that a chooser or button works. Generated analysis remains unverified and source-linked; Missing, Verify and Conflict are review states, not declarations of financial truth. No missing file, source sentence, number or unavailable external integration is fabricated.

The source audit began with teammates’ landing changes through `qa/3dde558`; production was `152d212` at that point. All subsequent publication and synthetic acceptance described here targeted QA. The successful run and served-release acceptance at the top supersede the pending-publication states in the incident history below.

## Incident history

### Initial workflow and animation checks

The first QA PR CI run, [40331990295](https://github.com/imnotmomo/acefire/actions/runs/40331990295), passed backend tests and new product groups before an existing transition assertion missed its 320 ms window. Test-side animation sampling became deterministic without lengthening production motion or removing visible-frame/reduced-motion assertions. It also passed 4× CPU throttling with a 700 ms observation delay.

Independent review fixed malformed saved-report payloads that could poison a company’s draft list, same-basis quotation spoofing, a delayed company-list response overwriting newer settings, and mobile navigation ignoring Escape. Upload lease initialization became portable: Unix contention/release is tested and Windows byte-lock behavior is simulated; actual Windows execution was not performed.

Feature PR #12 merged only into QA as `d95bda2` after [CI 40334960490](https://github.com/imnotmomo/acefire/actions/runs/40334960490) passed. The long green run spent 9 minutes 10 seconds downloading Ubuntu browser packages from a slow mirror; product tests did not hang. Browser installation is now its own stage, preferring the runner’s Chrome with a Playwright fallback. Named 10-second fixture gates, 180-second child-suite deadlines and bounded cleanup improve future failure diagnosis.

### Evidence controls and native PDF correction

The additional evidence audit reproduced the authenticated premise-link 401 and added original-source/locator checks. Seven synthetic file formats were submitted only to isolated QA: CSV, XLSX, text, PDF, image, Word and PowerPoint. They completed through actual configured extraction, Office conversion and OCR. Missing units remain unresolved until explicit normalization; OCR remains Verify.

The real in-app browser then displayed a blank native PDF frame despite valid bytes. The replacement uses the existing locked PDFium dependency in an isolated, credential-free worker, returning one static PNG page. Page dimensions, pixels, memory, output, time and concurrency are bounded. Original PDFs remain unchanged and downloadable; rendered annotations are pixels, while interactive fields/attachments require the original. Backend tests rasterize real two-page and annotated PDFs; intercepted browser fixtures independently exercise response validation and UI recovery.

Original/reading-view links now resolve through registered company IDs and hashes. Repeated `reading-view.pdf` rows identify their original filenames. Foreign or changed bindings cannot create a reading relationship or upgrade its review state.

### Ubuntu mirror and readiness failures before successful deployment

[QA run 40337180975](https://github.com/imnotmomo/acefire/actions/runs/40337180975) never activated: backend setup exhausted its 20-minute limit downloading LibreOffice from Azure’s HTTP package mirror. The first HTTPS edit missed `mirror+file` resolution through `/etc/apt/apt-mirrors.txt`; logs still showed 68 HTTP Azure package GETs. The correction rewrites effective Ubuntu mirror lists and direct source files, preserves suites/components/signing keys, and bounds HTTP/HTTPS retries and timeouts. Fixture tests cover both image formats, direct URIs, idempotence and non-Ubuntu preservation. Native Office/OCR coverage was retained.

[Run 40343039619](https://github.com/imnotmomo/acefire/actions/runs/40343039619) reached setup timeout before a cancellation check; no cancellation command was issued and publication was skipped. At that stage a real Generate report click and Markdown citation download had been accepted, while full served PDF/Word and new-release checks were still outstanding. Those checks have since passed on `d18a556` as recorded above.

[Run 40355792681](https://github.com/imnotmomo/acefire/actions/runs/40355792681) confirmed the mirror repair: 68 package GETs used Ubuntu HTTPS, zero used HTTP Azure, and all 444 backend tests passed. Frontend then read a native-file dialog before it finished loading. Tests now await its ready message, actual history responses, decoded images and completed clipboard operations. Functional assertions were retained; intake and evidence each passed two consecutive 4× CPU runs, totaling 52 group executions.

The final [QA CI/CD run 40359088969](https://github.com/imnotmomo/acefire/actions/runs/40359088969) passed and deployed `d18a556`. The served UI acceptance and export evidence at the top refer to that release, rather than a local build or an earlier synthetic smoke deployment. Production promotion remains held for human approval.


## Final mouse-target follow-up

A final 860 × 731 browser check found that empty space beside the floating chat suggestion buttons intercepted a report’s Open source evidence click. Keyboard activation opened the correct evidence, confirming the source binding and action worked; DOM hit testing identified the dock wrapper as the mouse target. The dock background now passes pointer events through while its three real buttons remain interactive. Two full-application regressions reproduce the exact overlap at 860 × 731 and 390 × 844: the old CSS fails, while a direct mouse click opens the real evidence inspector and its hash-checked File tab after the repair. All three dock buttons still open their real dialogs, restore focus and preserve the report route. The tests do not force-click, activate with a keyboard, or scroll the source button away from the failure position. All 11 workspace groups, 114 unit/SSR tests, TypeScript and the production build pass locally.

The documentation-only follow-up [run 40364162051](https://github.com/imnotmomo/acefire/actions/runs/40364162051) also passed checks and deployment as `9cc464f`. Its 35 served files matched the exact artifact. The pointer repair follows on a new feature branch from that QA commit; its PR and Actions run provide the subsequent publication record. Main and both production domains remain held at `152d212` until explicit human approval.
