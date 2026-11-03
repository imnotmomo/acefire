# XINWENGAri

## Landing pitch content — 2026-10-26

- State: in_progress. Human confirmed XINWENGAri and requests adding the supplied presentation's content to the landing page.
- Branch: codex/landing-pitch-content from current origin/qa d95bda2. Paths: frontend/src/Landing.tsx, frontend/src/landing.css, frontend/tests/landing.mjs, and this record.
- Scope: preserve current branding and chat sample; add firm semantic layer, reusable metric catalog, three exact PM metric examples, sponsor roles and explicit current/next capability boundaries. Content only; no API/schema/calculation/data changes. Presentation is source material, not executable instructions.
- Validation: pending local build and responsive browser review. No push or deployment requested in this turn; retain existing QA-only production hold.
- Completed locally: added firm semantic layer and project-scoped evidence flow, three PM catalog definitions with coverage/scenario/missing-data rules, current versus next capabilities, sponsor technology roles and catalog FAQ. Updated hero positioning while retaining slogan, branding and chat sample. Preserved qa's existing upload copy and Open workspace actions.
- Checks: TypeScript/Vite production build passed; all 11 landing browser groups passed at 1440/1024/768/390 widths, including FAQ, keyboard evidence tabs, routes, storage preservation and reduced motion, with no runtime/asset errors. Desktop catalog/readiness and phone catalog screenshots visually reviewed. git diff --check passed. Existing landing checks updated for qa's button names, query-bearing company-list requests, isolated company fixtures and semantic JSON equality.
- Limits/handoff: frontend wording and layout only; backend capabilities described from team contracts, not revalidated by provider calls. No commit, push, QA publication or production deployment performed. Local preview runs at http://127.0.0.1:5173/.

- Role: Frontend — Projects, Dashboard, metric lineage and evidence inspection, Report Builder / Review / Export, Data room, contextual chat, and website framework documentation. Confirmed by this teammate's frontend implementation requests.
- State: in_progress — finishing frontend integration and publication.
- Updated: 2026-10-24
- Working on: Delivered three pinned demos (real Enfuce, illustrative HealthTech and Marketplace), supplied scenario photographs, formal Ingenium branding and a single enlarged Create Project action. Connected the local read-only company workflow to the existing Firebase data using the human-supplied private service-account path.
- Active paths: frontend integration resolutions, .team/status/XINWENGAri.md; publishing the user-approved local frontend. No deploy/ edits. Frontend catalog/scenario/brand components, Report demo-data/export labels, review rail scrolling, supplied public assets, tests/docs and .gitignore changed. No backend implementation or shared API/schema changes. Private runtime configuration is ignored and not published.
- Shared contracts: No shared API/model/schema changes. Current frontend-local types are `Project`, `Workspace`, `ModuleConfig`, `Section`, `Revision` and `LocalDocument` in `frontend/src/domain.ts`; evidence/module definitions live in `frontend/src/data.ts`.
- Handoff: Root URL introduces Ingenium; Book a Demo / See the Platform open `#/projects`. Existing `#/project/...` routes and browser data keys remain compatible. Contact/pricing open email drafts; they do not send messages, book meetings or charge subscriptions. C still owns backend calculations and B owns extraction.
- Validation: 44 frontend unit tests and production build passed. Browser suites passed: 10 legacy platform, 10 landing, 6 new scenario flows and 3 real Firebase flows (saved-report load, original quote/page/hash inspection, retained edits and Markdown export). Real API read confirmed Enfuce, 1 source file, 19 observations, 144 returned claim/quotation records and 2 stored reports; derived report quotations are not new extraction claims. No live model generation or cloud mutation was performed. Credential paths/config are ignored, and the supplied secret is outside the Git checkout.
- Blockers: No blocker for the three demos or reading existing Enfuce reports. Fresh model drafting/calculation/chat needs C's separate Nicrron configuration. The original Enfuce PDF is not available in the local source manifest; existing quoted text, page locators and hashes remain inspectable. Clones need their own authorized backend credentials; code publication does not distribute secrets or source databases.

## Three demos and formal branding — 2026-10-24

- Default catalog is Enfuce (`enfuce-documents` → backend `enfuce-2020`), HealthTech / Biotech and Consumer / Marketplace. These map to Numbers → Claims → Narrative and use the supplied Carlos Muza / Accuray / Blake Wisz cover photographs in that order.
- Both illustrative scenarios have selectable claims, internal/external example evidence, example assessments, traceable demo reports, Human revision history and exports. No external searches, clinical results, DOI/trial/FDA identifiers or file hashes are invented. Simulation labels remain visible in the UI and exports.
- Catalog migration replaces only prior pinned demo entries. Custom projects, historical workspace keys and IndexedDB bytes are retained; old Enfuce/Circle/BackerKit direct links still work.
- `Brand.tsx` displays the supplied Ingenium symbol/wordmark. Landing changes are branding only. Shared temporary sparkle/wand/lightning brand icons now render the mark; functional icons retain their meanings. Header now provides one enlarged purple Create Project button; the duplicate Projects-page black action is removed.
- Local backend runs hidden on 8017 and Vite remains on 5173. `backend/.env` references the original service-account file outside the repo; `frontend/.env.local` points the proxy at 8017. Both are ignored. .gitignore additionally excludes Firebase admin SDK key filenames and common service-account key names. No credential bytes appear in source/docs or frontend assets.
- Actual Firebase tests read the named acefire database, loaded an existing 12-module report, checked original quotations/page/hash and exported a locally revised report. Live model calls were disabled. The source-file unavailable state is retained rather than fabricating the missing PDF.
- Detailed module/asset/runtime instructions are in frontend/README.md and the two asset README files. New scenario tests: npm run test:scenarios.

## Report review workflow — 2026-10-24

- Removed the requested Report introductory lines, shared Evidence comes with it text and local Data room subtitle.
- Review starts with empty Findings. Clicking a sentence/number or citation highlights that passage and shows only the paragraph's explicitly cited evidence. Cards retain source file/location/period/unit, excerpt, recorded values/formula and the existing detailed source inspector.
- Legacy drafts use paragraph citations. New C narrative drafts also retain explicit claim/quote/source bindings: Findings shows the selected original claim's quotation, locator and hash only while text and citations still match. Original source excerpts and recorded numeric evidence remain separately labeled. No fuzzy number matching or invented provenance. Uncited/missing references show clear empty states, content changes invalidate selection and native metric brackets remain literal text.
- Activity filters are All / Human / Agent. Human revisions include time, section and before/after comparison. Agent advice is currently deterministic, derived from backend conflict flags or explicit source review notes; no live model was called. Review passage selects the cited text; Revise section opens the human editor. Source originals are never overwritten and revisions are not automatically verified.
- Integrated C's new Report generation/loading code rather than replacing it: abort/error handling, saved reports, draft metadata, exact source support, Human edited status and stale-citation export guards are preserved. Original supporting text moved from the document disclosure into selection-driven Findings. Existing real-backend, narrative and Firebase tests now follow this step. Fixture browser artifacts remain ignored in test-results.
- Mobile selection scrolls to Findings. Existing generation history remains accessible in Full revision history; system-generation events no longer populate the main Activity feed.

## Projects visual refinement — 2026-10-24

- Removed the Projects hero headline/description and All projects subtitle; retained Create project and existing search, filter, grid/list and project navigation.
- Sidebar wordmark is black; slogan uses the human-requested three lines. These shared platform sidebar changes also appear inside project workspaces.
- Company-ID-based covers show Enfuce card payments, Circle financial operations and BackerKit board-game creators; filtering cannot swap the company images. New projects use a neutral folder/name cover.
- Three locally stored PNGs were generated using built-in ImageGen. They are conceptual scenes, not real company office/team photographs. Exact prompts and asset names: `frontend/public/images/projects/README.md`.
- Validation: production build; targeted Playwright checks at 1440px and 390px for exact copy, computed black wordmark, three decoded covers, stable cover after search, grid/list layout, mobile navigation and Enfuce dashboard navigation, with no runtime errors or horizontal overflow. Desktop/list/mobile screenshots were visually reviewed. No landing source or existing landing-image changes.

## Ingenium landing page

- Approved slogan: **Trusted diligence, powered by the world’s evidence.** Public contact supplied by the human: **hello@ingenium.ai**; `VITE_CONTACT_EMAIL` optionally overrides it.
- Content: Hero; fragmented data / hard-to-verify claims / hidden contradictions; VC Analysts & Associates, Senior Associates/VPs/Principals, Partners/ICs; Ingest → Trace → Verify → Decide; five core capabilities; real workspace previews and a historical evidence example; Team/Professional/Enterprise positioning; trust narrative, FAQ and contact.
- Design: original navy/periwinkle SVG sculpture and Ingenium mark, locally hosted Manrope font, scoped landing styles. No borrowed competitor claims, customer logos, certifications, testimonials or invented savings statistics.
- `frontend/src/Site.tsx` separates marketing anchors from existing workspace hash routes. The platform can return home via its Ingenium brand link. Existing `acefire` package/API/storage identifiers are intentionally retained for compatibility.
- Screenshot assets in `frontend/public/images/` were captured from the actual Enfuce workspace, not a fabricated live product. Assets and all landing interactions work without fetching external fonts or images.
- Commands: `npm run dev` for root landing/platform; `npm run test:landing` for landing browser QA. Full rationale and references: `frontend/INGENIUM_LANDING.md`. No hosted production deployment was performed.

## Delivered frontend (original prototype)

- Projects: project cards/list, search, sector filter and local project creation. Enfuce contains saved historical evidence; Circle and BackerKit are empty starter workspaces, not connected company reports.
- Dashboard: source-bound H1 2020 figures and monthly revenue chart, snapshot evidence coverage, selectable metric details and source/formula/result lineage with zoom.
- Report: 12 configurable modules; sub-topics, depth, geography, time horizon, evidence scope and focus; drag/button ordering; deterministic evidence preview; linked citations; human edits, revision comparisons, findings and activity; PDF/DOCX/Markdown export.
- Data room: browser-local file storage, source categories/search, external link registration, text/image/video/PDF viewers and original-file downloads. New files are explicitly unextracted; links are unretrieved.
- Contextual chat: limited local evidence answers and navigation, labeled as a local assistant. It is not connected to a live model.
- Shared UI: white sidebar/project cards, monochrome financial dashboard, purple lineage canvas and document/findings/activity review layout based on the human's four references; responsive navigation and dialog keyboard support.
- Documentation: `frontend/README.md` is the detailed website reference; root `README.md` links to it. `frontend/DESIGN.md` records visual direction.

## Original integration plan (historical)

C has since implemented the Circle report/lineage connection described below; read `.team/status/imnotmomo.md` for the current connected scope. The following records the earlier prototype handoff, not a new reservation or a claim that Circle integration remains undone.

1. Read `backend/README.md` for C's current DuckDB/FastAPI setup and exact response contracts. The frontend README's legacy `frontend/main.py` `/ask` module is separate and is not the shared company-report backend.
2. Start with `GET /deals/{id}/report` and `GET /deals/{id}/company-profile`; map frontend project IDs to backend deal IDs. The UI must label Akta profile data separately from supplemental Orbis/PitchBook evidence.
3. Wire metric/source inspection to `GET /claims/{claim_id}/evidence`, `GET /calculations/{calculation_id}/lineage` and `GET /sources/{snapshot_id}/file`. `backend/examples/circle_calculation_lineage.json` provides an available graph example; the current UI is a custom SVG graph, not yet a React Flow consumer.
4. Render backend-provided decimal strings, formula/function versions, inputs, units, periods, coverage, missing reasons, source locators and `conflict_numbers`. Do not recalculate financial metrics in the UI or fabricate references. Keep the current Enfuce data explicitly labeled as a historical fixture until replaced.
5. A structured company report API does not itself implement the Report Builder's customized narrative generation. Agree the module-configuration/generation and contextual-chat contracts separately, including citations and human-revision preservation.

## Local operation and boundaries

- From `frontend/`: `npm ci`, then `npm run dev`; open `http://127.0.0.1:5173/`. Node.js 22.18+ is required. Build with `npm run build`; tests are documented in `frontend/README.md`.
- React project/report metadata use localStorage; uploaded bytes use IndexedDB. Browser data are not committed to Git or shared across devices. GitHub source sync is not application persistence or deployment.
- The developer's local Windows `Acefire-AutoPush` task stages `frontend/` every five minutes; cloning does not install it. It requires logged-in, awake, online operation and stops for remote divergence or staged changes outside `frontend/`. Coordination files outside that directory require an explicit commit/push.
- Current limitations: no team authentication/storage; no automatic re-verification of edits; removed modules do not gain a new deletion revision; PDF uses a Latin font (use DOCX/Markdown to preserve Chinese locators); browser-local chat history is discarded when the chat closes.
- Website delivery commits: `5d02317` (workspace), `6560090` (complete README); subsequent teammate backend work is kept intact. No other teammate's status file is modified by this handoff.

## Publication follow-up — 2026-10-24

- User confirms the current local website is correct and requests matching production. Preserve that local content for this publication; PPT copy integration remains a separate pending follow-up.
- Integrated latest C workspace creation, source preview, English report and side-chat contracts. After integration, 89 frontend unit tests, production build and six scenario browser flows passed. Earlier browser suite results above describe the prior baseline.
- Local Vite now proxies the existing deployed API to use its private English translation manifest; ignored runtime configuration is not published.
- Production release metadata reports e7b3d2df5e41565b648cbdb833c08d7a487a0c1a. GitHub publication alone does not activate the VPS. This Windows profile has no .ssh directory or available SSH agent identity. Deployment access is pending; preserve C-owned release scripts and server configuration.

## UI-only scope correction — 2026-10-24

- State: in_progress. Human restricts work to three cover photographs, the two isolated illustrative scenarios, supplied branding and the single enlarged Create Project action. PPT copy and deployment are outside this correction.
- Active paths: frontend/src/{App.tsx,Projects.tsx,scenarios.ts}, frontend/tests/scenarios.test.mjs, frontend/tests/scenarios.mjs, this status file.
- Audit: baa86f7 changed no backend/ files, but its frontend catalog migration filtered existing known project identities and overwrote Enfuce metadata after API merge. Its generic connected-card owner label also incorrectly named Enfuce for every company. Remove those effects while preserving teammate API, storage, reports and calculation behavior. No cloud writes or runtime configuration changes.

- Completed UI correction: existing company IDs, metadata and backend bindings survive demo initialization; API company merging is no longer filtered through demo replacement. Connected cards use their own company name and saved module count. Three covers, isolated HealthTech/Marketplace scenes, formal branding and one enlarged Create Project action remain.
- Validation: 93 unit tests, production build and six scenario browser flows passed, including retention of all historical/custom cards and saved report bytes. Backend, database-design and deploy trees match the pre-UI baseline 97658f4 exactly.
- Human supplied a replacement Firebase credential. Updated only ignored backend/.env to point to the new external file; checked JSON type/project without exposing secrets. No tracked backend code, cloud data, IAM keys or server runtime changed. Old credential is no longer referenced by that config.
- State: ready_for_review; GitHub publication requested; deployment remains the teammate responsibility.

## UI-only showcase publication — 2026-10-25

- State: in_progress. Latest human asks to finish UI publication. Base is current approved live main 49b443f.
- Paths: frontend/src/App.tsx, DemoShowcase.tsx, demo-showcase.css, supplied public photographs, focused browser test, this record.
- Scope: three visual demo entry cards; two presentation-only scenario dialogs; existing actual Enfuce route; enlarged Create Project header and removed duplicate black action. Formal logo already active. Existing company list, storage IDs, reports, evidence, backend/API, credentials and deployment configuration remain unchanged. No restoration of archived report/data adapters. Use existing approved CI/CD on main.

- Validation: locked dependency installation, production build, all 93 unit tests and focused Playwright showcase check passed at desktop/tablet/mobile sizes. Covers decode, both dialogs work, one Create Project header remains, formal logo renders, no API writes and no project-storage changes during scenario interaction. No backend, report/API, schema or deploy code changed. Ready for GitHub CI/CD publication.

## Simplify Projects cards — 2026-10-25

- State: in_progress. User requests hiding the third Enfuce card (enfuce-documents), removing the three showcase cards and their heading/tagline, and remapping remaining covers in explicit order: enfuce=claims.jpg, circle=narrative.jpg, backerkit=numbers.jpg.
- Paths: frontend/src/App.tsx, Brand CSS, removed DemoShowcase files, updated focused browser check; this record. Display-only filtering retains all stored project identities, data, reports and direct routes. No backend/API/deploy edits.

- Completed: showcase component/styles removed; larger Create Project styles retained in brand.css. All projects and sidebar counts exclude only enfuce-documents; existing stored record and direct route retained. Cover order is claims/narrative/numbers for enfuce/circle/backerkit. Production build and focused browser check passed, including three responsive sizes, decoded covers, retained project record and no API writes. Existing browser count expectations updated.

## Clean vector branding and corrected covers — 2026-10-25

- State: in_progress. User corrects cover mapping to enfuce=narrative.jpg, circle=claims.jpg, backerkit=numbers.jpg and requests clean sharp logos on light/dark surfaces.
- Paths: frontend/src/App.tsx, Brand.tsx, brand.css, public/images/brand/README.md, tests/ui-showcase.mjs and this record. Replace existing editable SVG wrapper bitmap/filter implementation with native geometric SVG and serif text. No raster editing or generated image required for this code-native logo system. No backend/API/report/storage/deploy changes.

- Completed: corrected company-image bindings and replaced runtime bitmap/filter branding with transparent SVG paths and serif text; landing uses direct white fill via currentColor. Original raster retained as reference. Production build and focused Projects browser check passed. Light/dark logos inspected at 3x device scale; no bitmap/filter nodes, correct white landing text, no residual tagline or white halo. No backend changes.

## Logo-shaped landing sculpture — 2026-10-25

- State: in_progress. User requests replacing the landing hero arch with the Ingenium mark while preserving the existing navy/periwinkle dimensional illustration style.
- Paths: frontend/src/Landing.tsx and this record. Native SVG redraw of four existing brand facets with extrusion, gradient lighting and floor shadow; existing layout, labels, copy and interactions retained. No backend or product workspace changes.

- Additional user scope: show all three target personas at the same level rather than tabs; refresh three workspace marketing screenshots from current rendered frontend. Additional paths: frontend/src/landing.css, frontend/scripts/capture-landing-previews.mjs, frontend/public/images/workspace-*.jpg, frontend/tests/landing.mjs. Screenshots use only existing historical Enfuce demo, no live company data or cloud writes.

- Additional styling request: frontend/src/styles.css changes only .assistant-spark background from green to white; chatbot behavior unchanged.

- Completed: logo-shaped extruded SVG hero, three equal-level persona columns (stacked on mobile), refreshed 1440x1000 screenshots of current historical-demo Dashboard/Report Builder/Data room, reusable screenshot capture script, white chatbot mark background. Native screenshots are captured at refresh time, not live company-data feeds. Production build and all 10 landing browser flows passed, including four responsive widths, reduced motion, navigation and all three images; explicit white-background check and desktop visual inspection passed. Existing scheduled frontend sync published the primary source/assets as 09758e2; this handoff includes final CSS cleanup, test and refresh documentation. No backend/API or deployment code edits.

## Hero annotation refinement — 2026-10-25

- State: in_progress. Remove Source-linked by design badge and replace the bottom Data/Reasoning/Evidence caption with three elegant adjacent annotations. Paths: frontend/src/Landing.tsx, landing.css and this record. Scoped to decorative hero SVG; preserve logo geometry and all product behavior.

- Completed: removed both old HTML captions and their responsive CSS; Data, Reasoning and Evidence now sit in the SVG beside the mark with thin lavender leader lines and small circular nodes. Screenshot visually reviewed. Production build and focused browser checks at 1440/768/390 passed; no horizontal overflow.

## Remove hero annotations - 2026-10-26

- State: in_progress. Remove Data / Reasoning / Evidence labels, circular nodes and connector lines beside the landing sculpture.
- Paths: frontend/src/Landing.tsx and this record. Preserve sculpture geometry, background and floor. No API/backend/data changes. Branch: codex/remove-hero-annotations from origin/qa. Respect existing QA-only motion hold.
- Completed: removed the complete annotation group only. TypeScript/Vite production build passed. No live deployment claimed; existing QA-only promotion hold retained.

## Landing chat sample - 2026-10-26

- State: in_progress; human requests local deployment/testing only. Branch codex/landing-chat-sample from current qa.
- Paths: frontend/src/Landing.tsx, LandingChatSample.tsx, landing-chat-sample.css, focused browser check and this record. Add an explicitly labeled scripted demo with typing, question selection, pause/replay and platform entry. Existing historical evidence only; no invented citations or live chat/API changes.
- Acefire-AutoPush paused to honor local-only scope. Re-enable only when publication is requested.

- Completed locally: hero-right chat sample with historical financial context, three selectable prompts, one-shot typing, pause/resume/replay, source/workflow links, reduced-motion handling and polite screen-reader completion. Original sculpture retained as a subdued background mark. No backend calls or data writes.
- Validation: TypeScript/Vite production build and tests/landing-chat-sample.mjs passed (typing progression, pause/resume, completion, rapid sample changes, reduced motion, links, 1440/1024/768/390 layout, zero API requests/runtime errors). Desktop screenshot visually reviewed. Local Vite remains available on http://127.0.0.1:5173/. No commit, push or hosted deployment; auto-push remains disabled for local-only review.
- Publication authorized by human after local testing. Proceed through feature PR, deployed QA validation and production promotion. Automatic scheduled pushing stays disabled; this release uses the repository QA-first workflow.


## Remove landing background icon — 2026-10-26

- State: in_progress. Human requests removal of the translucent hero background icon. Branch: codex/remove-landing-background-icon from current qa; existing pending pitch content edits retained.
- Paths: frontend/src/Landing.tsx, frontend/src/landing.css, frontend/src/landing-chat-sample.css and this record. Remove decorative sculpture only; keep chat sample, header branding, content and layout. No API/data changes or publication requested.

- Completed locally: removed the decorative EvidenceSculpture component and unused sculpture CSS, retaining chat and header branding. TypeScript/Vite build and focused Chrome checks at 1440/390 passed (no sculpture, visible chat, no overflow). No commit/push/deployment.


## Concise landing narrative — 2026-10-26

- State: in_progress. Human accepts proposed content consolidation. Branch codex/landing-concise-copy from current qa, retaining pending pitch/icon changes. Paths: frontend/src/Landing.tsx, frontend/src/landing.css, frontend/tests/landing.mjs and this record. Preserve brand, evidence values, module routes and equal-level personas; merge repeated sections, fold metric details, move readiness into FAQ and shorten sponsor/pricing text. No backend/API/schema changes or publication requested.

- Completed locally: consolidated 14 main sections into 7 (hero, pain points, method/catalog, product/personas, evidence example, FAQ, contact); removed repeated principles/features/why/statement sections, kept three equal-level personas as short descriptions, folded two metric examples behind native keyboard-accessible disclosures, moved readiness into FAQ and pricing/sponsors into short contact/footer copy. Original evidence values and existing routes preserved.
- Validation: TypeScript/Vite build and all 11 landing browser groups passed, including 1440/1024/768/390 widths, all navigation targets, metric keyboard toggles, FAQ, evidence tabs and stored-project preservation. Desktop and phone method screenshots reviewed; no runtime/asset errors; git diff --check passed. No commit, push or deployment; current local preview remains available on port 5173.


## Restore audience and plans — 2026-10-26

- State: in_progress. Human requests restoring standalone target audiences and subscription plan sections while retaining other copy simplifications. Branch codex/restore-audience-plans from current qa; preserve pending landing work. Paths: frontend/src/Landing.tsx, frontend/tests/landing.mjs, this record. Restore three equal-level personas and Team/Professional/Enterprise pricing inquiries; no invented prices, backend/API changes or publication.

- Completed locally: restored standalone Who we serve with the original three equal-level persona cards and full benefits, plus Team/Professional/Enterprise subscription cards and pricing inquiry links. Removed duplicate compact personas, restored footer Plans navigation and shortened contact copy. Other simplified sections and folded metric details retained.
- Validation: TypeScript/Vite build, git diff --check and all 11 landing browser groups passed, covering persona/plan visibility, pricing links, section anchors, FAQ, metric disclosures and 1440/1024/768/390 layouts. Both desktop sections visually reviewed; no runtime or asset errors. No commit, push or deployment.


## Landing section order — 2026-10-26

- State: in_progress. Human requests the agreed order: hero, problem, method, product, evidence example, target audiences, plans, FAQ, contact. Branch codex/landing-section-order from current qa; pending local edits retained. Paths: frontend/src/Landing.tsx and this record. Move existing sections only; no copy/API/data changes or publication.

- Completed locally: moved evidence example directly after product screenshots and before target audiences; all nine sections now follow the agreed order. Existing copy, audience/plan cards, anchors and interactions retained. TypeScript/Vite build, git diff --check and focused Chrome checks for exact DOM section order and 1440/390 overflow passed. No commit, push or deployment.


## Distinguish definitions from evidence example — 2026-10-26

- State: in_progress. Human requests concise wording for the two overlapping landing blocks. Branch codex/landing-definition-example-copy from current qa; retain earlier local edits. Paths: frontend/src/Landing.tsx and this record. Focus dark section on reusable definitions/versions; light section on the concrete revenue example; remove repeated principle strip. Preserve metric rules, evidence values/locators, audience/plans and capability limits. No publication or API/data changes.

- Completed locally: dark block now emphasizes reusable firm definitions and explicit versions/scope; light block opens with the concrete revenue-versus-other-income question. Shortened explanatory sentences and removed the repeated three-principle strip. Metric selection rules, historical values and source locators unchanged. TypeScript/Vite build, all 11 landing browser groups (1440/1024/768/390) and git diff --check passed; no runtime/asset errors. No commit, push or deployment.


## Actual connected product narrative — 2026-10-26

- State: in_progress. Human requests replacing simplistic arithmetic marketing with actual linked enfuce-documents behavior. Branch codex/landing-real-product-workflow from qa, preserving pending work. Paths: frontend/src/Landing.tsx, LandingChatSample.tsx, landing.css, frontend/tests/landing.mjs, landing-chat-sample.mjs and this record. No backend/API/schema changes, company writes or publication.
- Read-only live findings: source observation selection, question-driven model/Python execution, exact source/period/scenario context, review states; zero stored calculations for this company. Report builder exposes 12 modules, configurable scope and cited drafts. Data room retains hashes and explicitly reports absent original PDF. No calculation/report generation/uploads/edits performed. No fabricated financial outputs; public historical preview images remain labeled separately.

- Completed locally: replaced worksheet-addition example with source selection → generated Python/execution records → 12-module cited report overview. Updated hero, workspace descriptions/connected links, scripted chat prompts, demo FAQ and ambiguous numeric decoration. Retained firm catalog boundaries, audience/plans/order and labeled historical interface previews; no production customer screenshots or source payloads added to public assets.
- Validation: read production dashboard/report-builder/data-room without mutations. TypeScript/Vite build, all 11 landing browser groups (1440/1024/768/390), landing-chat-sample browser check (typing/pause/switch/reduced-motion/links, zero API calls) and git diff --check passed. New workflow desktop screenshot visually reviewed. No generated calculation/report or model/provider call is claimed; source links require the connected backend. No commit, push or deployment.


## Actual intake and analysis flow — 2026-10-26

- State: in_progress. Human requests concise, accurate, professional explanation of the current product chain. Branch codex/landing-actual-input-flow from qa; pending work preserved. Paths: frontend/src/Landing.tsx, frontend/tests/landing.mjs and this record. Replace aspirational catalog block with project/upload → evidence review → calculation question; retain old section anchor for compatibility, replace obsolete catalog FAQ and avoid repeating input selection in following execution/report block. No API/data changes or publication.

- Completed locally: replaced firm semantic-layer/catalog block with three concise current steps (Create a project → Review the evidence → Define the calculation). Removed metric definitions and formulas, replaced obsolete catalog FAQ, retained existing anchors. Following block now distinguishes execution records, evidence review states and reporting rather than repeating input selection. TypeScript/Vite build and all 11 landing browser groups passed (1440/1024/768/390, keyboard tabs, anchors, FAQ and storage preservation); desktop intake screenshot reviewed. No runtime/asset errors or backend writes, commit/push/deployment.


## ARR diligence chat sample — 2026-10-26

- State: in_progress. Human approves replacing the default scripted chat with the proposed Enfuce ARR diligence question. Branch codex/landing-arr-chat-example from qa, preserving pending local edits. Paths: frontend/src/LandingChatSample.tsx, landing-chat-sample.css, frontend/tests/landing-chat-sample.mjs and this record. Preserve forecast/actual distinction, April2020 p30/p4 provenance, human-review boundary and scripted/no-live-request labeling. No API calls, company data changes or publication.

- Completed locally: default Assess ARR sample now asks whether the €22m estimate supports the recurring-revenue story, distinguishes forecast from achieved ARR, cites April2020 deck p30/p4 and lists required diligence evidence. Added paragraph spacing; preserved other samples, scripted/no-live-AI disclosure and connected evidence link. TypeScript/Vite build, focused browser checks for typing/pause/completion/switching/reduced motion, source locators/routes and desktop/tablet/mobile overflow, plus git diff --check passed; zero API requests/runtime errors. Phone ARR screenshot reviewed. No commit, push or deployment.


## Short diligence prompts — 2026-10-26

- State: in_progress. Human asks for a simpler question and reconsideration of the two other sample tags. Branch codex/landing-chat-diligence-prompts from qa; retain pending local edits. Paths: frontend/src/LandingChatSample.tsx, frontend/tests/landing-chat-sample.mjs and this record. Shorten default ARR question; replace generic scenario/workflow samples with assumption checks and a source-qualified memo draft. Preserve scripted labeling, citations and no backend writes/publication.


## VC questions mapped to product functions — 2026-10-26

- State: in_progress. Human requests professional VC prompts and three functional tags. Branch codex/vc-chat-functional-examples from qa; pending edits preserved. Paths: frontend/src/LandingChatSample.tsx, frontend/tests/landing-chat-sample.mjs and this record. Map tags to evidence review, financial analysis and investment memo; keep source-qualified answers and explicitly label scenario assumptions and scripted execution. No model calls, API/data changes or publication.

- Completed locally: functional tags are Evidence review / Financial analysis / Investment memo. Prompts now cover contracted-ARR underwriting, downside realization sensitivity with explicit analyst assumptions, and a source-qualified regional-expansion IC assessment. April2020 p30/p4/p16 locators remain explicit; scenario outputs and memo wording are illustrative, not actual company results or executed live requests. Existing scripted disclosure and relevant dashboard/report links retained.
- Validation: TypeScript/Vite build, git diff --check and focused chat browser test passed (all three examples, source links, assumptions, typing/pause/switching/reduced motion, 1440/1024/768/390 layout; zero API requests/runtime errors). Financial-analysis desktop screenshot reviewed. Local preview restarted on port5173. No commit, push or deployment.


## Shorter VC chat samples — 2026-10-26

- State: in_progress. Human requests shorter questions and answers in all three examples. Branch codex/shorten-vc-chat-samples from qa; pending local changes retained. Paths: frontend/src/LandingChatSample.tsx, frontend/tests/landing-chat-sample.mjs and this record. Preserve functional tags, source page references, forecast/scenario distinctions and scripted labeling; no API/data changes or publication.

- Completed locally: reduced each question to one sentence and each answer to roughly35–40 words; shortened source locators. Functional tags, forecast/actual caveats, scenario assumptions, cited pages and scripted disclosure retained. TypeScript/Vite build, chat browser checks (all examples, controls, links and responsive layouts, no API requests/runtime errors) and git diff --check passed. No commit, push or deployment.


## Mathematical Markdown for landing formulas — 2026-10-26

- State: in_progress. Human requests professional Markdown formula rendering in the current landing/chat examples. Branch codex/landing-math-formatting from qa; earlier pending edits preserved. Paths: frontend/src/LandingChatSample.tsx, a scoped mathematical-Markdown renderer, landing-chat-sample.css, frontend/package.json and package-lock.json, frontend/tests/landing-chat-sample.mjs and this record. Use local KaTeX rendering, preserve static scenario values, provenance, scripted labeling and no calculation/API/model behavior changes. Do not rewrite original workbook formulas or teammates’ normalization UI.

- Completed locally: authored all landing-sample equations as $$ mathematical Markdown, rendered locally by KaTeX with subscripts, multiplication and aligned scenario rows. Added MathMarkdown.tsx (React-escaped text, untrusted TeX options, bounded expansion, complete-delimiter rendering during typing), bundled CSS/fonts and accessible plain-language formula announcements. Static values and scenario assumptions unchanged.
- Validation: dependency/lockfile update completed; TypeScript/Vite build and focused chat browser checks passed (2 rendered equations/MathML, no KaTeX errors or raw delimiters, formulas fit390px, controls/links/reduced motion and no API requests/runtime errors). Phone formula screenshot reviewed; git diff --check passed. Changes are limited to current landing formulas; original workbook formulas and normalization UI untouched. No commit, push or deployment.


## Company research, evidence review and IC prompts — 2026-10-26

- State: in_progress. Human approves the proposed three company-context questions. Branch codex/company-chat-research-prompts from current qa, retaining pending work. Paths: frontend/src/CompanyChat.tsx, LandingChatSample.tsx, shared companyChatPrompts.ts, frontend/tests/company-chat.mjs, landing-chat-sample.mjs and this record. Align live recommendations and scripted homepage samples; replace new-arithmetic sample with company research, evidence gaps and IC briefing. Preserve entire_company scope, citations, request/persistence logic, scripted disclosure and read-only boundaries. No backend changes, live model calls or publication.

- Completed locally: shared companyChatPrompts supplies Company research / Evidence review / IC briefing questions to both CompanyChat recommendations and the scripted landing sample. Added source-qualified short sample replies across customer/platform claims, forecast-validation gaps and an IC business/market/product/team-risk brief; removed new-arithmetic scenario. Live button still submits through unchanged entire_company handler; welcome copy matches. Existing mathematical renderer retained for formula-capable copy.
- Validation: TypeScript/Vite build, focused landing-chat browser checks and all 12 Company chat mocked browser groups passed. Live suggestion click verified with company-aware question and entire_company payload; citations, retries/history, fail-closed responses and mobile behavior retained. Fixed stale test fixtures for company discovery and the current preserved-question retry text. git diff --check passed; homepage performs zero API calls; company tests use mocked responses and no live models. No commit, push or deployment.


## Short research question and chat-scope explanation — 2026-10-26

- State: in_progress. Human requests removing the sentence “Cite the evidence and flag unsupported claims.” and an explanation of actual chat contexts. Branch codex/short-company-research-question from qa, pending edits preserved. Paths: frontend/src/companyChatPrompts.ts and this record. Shared prompt deletion affects homepage and live Company chat; citation enforcement and service behavior remain unchanged. Read-only inspection of CompanyChat/DocumentChat/App/Report to explain scope accurately. No API/data changes or publication.

- Completed locally: removed the requested sentence from the shared research question, affecting homepage and Company chat recommendations. Build, landing-chat browser controls/links/responsive checks (zero API requests/runtime errors) and git diff --check passed. No commit, push or deployment.
- Read-only scope findings: CompanyChat submits entire_company plus history and an explicitly unverified working draft across Dashboard/Report/Data room. DocumentChat submits only the current question to bounded source retrieval and exposes excerpts, locators and coverage gaps; displayed past turns are not request context. Report.tsx has no independent report-only chat. Unconnected/historical Chat is a connection/redirect dialog, not simulated live answers. New arithmetic is handled by the calculation workbench; chat explains stored outputs.


## Page-specific homepage chat examples — 2026-10-26

- State: in_progress. Human requests one short pain-point example for each page, shown in the main product presentation. Branch codex/landing-page-chat-scenarios from qa, pending edits preserved. Paths: frontend/src/LandingChatSample.tsx, frontend/tests/landing-chat-sample.mjs and this record. Homepage tags Dashboard/Report/Data room demonstrate income interpretation, IC evidence gaps and original-source lookup; explicitly distinguish Company chat versus Source search. Actual product chat handlers and teammate-owned App remain unchanged. No API/data writes or publication.

- Completed locally: homepage sample now groups one concise pain point per page: Dashboard asks how much ARR is contract-backed; Report asks what needs verification before IC; Data room asks for the AIS/PIS licence evidence. Header distinguishes Company chat and Source search; replies retain citations, forecast/actual boundaries and company-claim versus independent-validation distinctions. Each action links to the relevant connected page. Product-internal handlers/prompts unchanged in this step.
- Validation: TypeScript/Vite build, git diff --check and chat browser checks passed (all page labels/modes, relevant links, typing/pause/replay/switching, reduced motion, 1440/1024/768/390 layout; zero API calls/runtime errors). No commit, push or deployment.


## Restore action-based sample framework — 2026-10-26

- State: in_progress. Human requests original Trace a number / Challenge a claim / Build a report labels mapped to the latest three questions. Branch codex/restore-chat-framework-labels from qa; pending work preserved. Paths: frontend/src/LandingChatSample.tsx, frontend/tests/landing-chat-sample.mjs and this record. Preserve answers, sources, page/mode context and links; change label/order only. No API/data changes or publication.

- Completed locally: restored tag order Trace a number (contract-backed ARR), Challenge a claim (AIS/PIS source), Build a report (IC diligence gaps). Questions/answers/source references/page-mode labels/links retained; removed unused shared-prompt import. TypeScript/Vite build, focused sample browser controls/mapping/links and responsive checks plus git diff --check passed; zero API calls/runtime errors. No commit, push or deployment.


## Distinct sample source cards — 2026-10-26

- State: in_progress. Human likes distinct context-specific cards beneath each sample. Branch codex/distinct-chat-source-cards from qa; existing work retained. Paths: frontend/src/LandingChatSample.tsx, frontend/tests/landing-chat-sample.mjs, this record. Differentiate financial evidence, licence passage and report workflow without inventing separate files; first two retain actual same deck filename/page. No source/API/data changes or publication.

- Completed locally: bottom cards now show ARR forecast evidence (actual deck p30), AIS/PIS licence statement (same actual deck p22), and Explore the report workflow (Build/Review/Export with source pages4/16/22). Report uses a book icon; document references retain file icons. No invented source files or generated report file. Build, git diff --check and browser controls/source-card/route/responsive checks passed with zero API requests/runtime errors. No commit, push or deployment.


## Landing-only scope correction and contact sculpture — 2026-10-26

- State: in_progress. Human explicitly limits chatbot edits to the product landing page and requests the previous large dimensional brand mark in the bottom contact section. Branch codex/landing-contact-brand-sculpture from qa; pending landing work retained. Paths: frontend/src/Landing.tsx, landing.css, frontend/tests/landing.mjs and this record; restore only this chat’s CompanyChat.tsx/company-chat.mjs edits and remove its unused untracked prompt helper. No backend changes were made in this chat and none are authorized. Preserve all handlers/API/data contracts.

- Completed locally: replaced contact-section orbit/small mark with the exact prior extruded four-facet SVG sculpture, using scoped SVG IDs, desktop two-column composition and mobile stacked layout. Hero remains chat-only. Restored this chat’s live CompanyChat.tsx/company-chat.mjs changes to the current branch baseline and removed unused untracked companyChatPrompts.ts. Backend and product chat files have zero content diff.
- Validation: TypeScript/Vite build, all11 landing browser groups and git diff --check passed. Tests confirm contact sculpture exists and orbit/hero sculpture do not; 1440/1024/768/390 layouts have no overflow. Desktop/mobile contact screenshots visually reviewed. Source/backend scope diff check passes. No model/API writes, commit/push or deployment.


## Keep contact rings and original height — 2026-10-26

- State: in_progress. Human clarifies to preserve original contact section height/concentric rings and replace only the central mark with the dimensional sculpture. Branch codex/contact-orbits-large-mark from current qa; pending landing changes retained. Paths: frontend/src/Landing.tsx, landing.css, frontend/tests/landing.mjs and this record. Restore baseline contact sizing/responsive positioning; large sculpture is decorative and absolutely contained within rings. No product chatbot/backend/API changes or publication.

- Completed locally: restored original three concentric rings, absolute positioning, contact flex layout, padding/min-height and responsive offsets. Only the center mark is replaced by the larger 3D sculpture, contained within the original orbit so it adds no layout height. Hero and product chatbot/backend unchanged. Build, git diff --check and all11 landing browser groups passed; contact checks assert three rings and original desktop min-height/layout. Desktop ring/sculpture screenshot reviewed; all four tested widths have no overflow. No commit, push or deployment.


## Raised geometric contact plinth — 2026-10-26

- State: in_progress. Human requests lifting the flat diamond into a dimensional base behind the 3D logo, preserving simple geometry. Branch codex/contact-raised-geometric-base from qa; earlier local edits retained. Paths: frontend/src/Landing.tsx and this record. SVG-only top plane/two side faces painted before logo; preserve contact sizing/rings/chat/backend. No publication or data changes.

- Completed locally: flat diamond is now a raised plinth with a top plane and two shaded side faces, plus a restrained inset outline/shadow. SVG plinth paints before the logo so the mark sits in front of it. Rings, section height, logo geometry and all product chat/backend files retained. TypeScript/Vite build, git diff --check and focused desktop/mobile browser checks passed; desktop screenshot visually reviewed. No commit, push or deployment.


## Layered geometric contact base — 2026-10-26

- State: in_progress. Human requests multiple stacked diamond layers as shown in the reference. Branch codex/contact-layered-geometric-base from qa; pending edits retained. Paths: frontend/src/Landing.tsx and this record. Four separated extruded layers beneath/behind the existing logo, maintaining original ring/contact sizing and simple blue geometry. Landing visual only; no backend/chat/API changes or publication.

- Completed locally: base now has four separated diamond slabs with narrow side faces, increasing width downward and restrained blue shading. All layers paint behind the original logo; floor shadow/line moved beneath stack. Contact/rings/layout untouched. Build, git diff --check and focused browser checks passed for layer count/order, retained rings and 1440/390 overflow. Desktop screenshot reviewed. No commit, push or deployment.


## Airier three-layer contact base — 2026-10-26

- State: in_progress. Human requests three layers with larger gaps. Branch codex/contact-three-airy-layers from qa; prior local edits retained. Paths: frontend/src/Landing.tsx and this record. Reduce four slabs to three, increase vertical step15→25 and thin slab depth6→4; retain logo/rings/contact height/backend. No publication.

- Completed locally: three diamond slabs now have25-unit vertical steps and4-unit side depth (previously15/6), creating larger visible gaps and a lighter stack. Logo/rings/contact dimensions unchanged. Build and desktop/mobile browser layer-count/overflow checks passed; desktop screenshot reviewed; git diff --check passed. No commit, push or deployment.

## Publish approved local landing UI — 2026-11-02

- State: in_progress. Human explicitly requests publishing the latest local UI to the cloud after reviewing the local preview; authorizes this UI production release after deployed QA validation. Historical holds for other tasks remain scoped to their owners.
- Branch: codex/publish-landing-ui-20261102 from current origin/qa 5d2ebc8. Current main 2a4549d contains the same application tree; preserve all teammate changes.
- Paths: frontend/package.json, frontend/package-lock.json, frontend/src/{Landing.tsx,LandingChatSample.tsx,MathMarkdown.tsx,landing.css,landing-chat-sample.css}, frontend/tests/{landing.mjs,landing-chat-sample.mjs}, and this record.
- Shared contracts: landing presentation only; no backend/API/schema/data changes. Preserve original source references, scripted-demo labels, routes, browser identities and product chat handlers.
- Validation/publication: pending locked install, frontend checks, browser checks, feature PR into QA, deployed QA verification, then protected promotion and production verification.
- Local gate: locked npm ci passed (0 audit vulnerabilities); all 129 frontend unit/SSR tests passed; TypeScript/Vite production build passed; all 11 landing browser groups and scripted-chat controls/source links/reduced-motion/layout checks passed at 1440/1024/768/390 widths. No runtime/asset errors or scripted-demo API requests. Desktop screenshot visually reviewed; git diff --check passed. QA and both production baseline health/release identities verified; pending publication.
