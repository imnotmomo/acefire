# XINWENGAri

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
