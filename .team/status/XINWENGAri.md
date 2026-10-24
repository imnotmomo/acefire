# XINWENGAri

- Role: Frontend — Projects, Dashboard, metric lineage and evidence inspection, Report Builder / Review / Export, Data room, contextual chat, and website framework documentation. Confirmed by this teammate's frontend implementation requests.
- State: ready_for_review
- Updated: 2026-10-24
- Working on: Delivered Report/Export/Data room copy cleanup and selection-driven Review Findings, with Human revisions and Agent source-review advice in Activity. Product landing source/assets remain unchanged.
- Active paths: None reserved. Integrated remote main ff0e405, preserving C's Firebase workflows, narrative generation, saved report loading, source quotations, review states and human-edited flags. Updated the Review component/helpers/styles, Data room copy, frontend docs and browser expectations; no backend or API/schema changes.
- Shared contracts: No shared API/model/schema changes. Current frontend-local types are `Project`, `Workspace`, `ModuleConfig`, `Section`, `Revision` and `LocalDocument` in `frontend/src/domain.ts`; evidence/module definitions live in `frontend/src/data.ts`.
- Handoff: Root URL introduces Ingenium; Book a Demo / See the Platform open `#/projects`. Existing `#/project/...` routes and browser data keys remain compatible. Contact/pricing open email drafts; they do not send messages, book meetings or charge subscriptions. C still owns backend calculations and B owns extraction.
- Validation: After integrating ff0e405: 41 frontend unit tests, production build and all 10 local platform browser flows passed. Five narrative browser flows passed using existing backend test fixtures and mocked narrative responses: exact quote/source/hash disclosure, invalid-generation edit preservation, provenance exports and mobile support. A further targeted mocked-backend flow checked conflict advice, exact decimals, cleared citations and human revisions. The real Firebase/C backend was unavailable locally; no live model/cloud call or backend mutation was performed. Updated real-backend/Firebase browser expectations were not executed against a live service.
- Blockers: None for the landing page or historical local demo. Circle needs the prepared C backend. New-document extraction, external research, open-ended chat, generic onboarding, enterprise permissions and production hosting remain separate work; no new provider integration or commercial checkout is claimed.

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
