# XINWENGAri

- Role: Frontend — Projects, Dashboard, metric lineage and evidence inspection, Report Builder / Review / Export, Data room, contextual chat, and website framework documentation. Confirmed by this teammate's frontend implementation requests.
- State: ready_for_backend_integration
- Updated: 2026-10-24
- Working on: Local frontend prototype and website framework documentation delivered. This update records the handoff; backend integration is the next planned step and has not started.
- Active paths: None reserved after this handoff. Frontend implementation lives under `frontend/`; this coordination update changes only this file, `AGENTS.md` and `TEAM_STATUS.md`.
- Shared contracts: No shared API/model/schema changes. Current frontend-local types are `Project`, `Workspace`, `ModuleConfig`, `Section`, `Revision` and `LocalDocument` in `frontend/src/domain.ts`; evidence/module definitions live in `frontend/src/data.ts`.
- Handoff: Consume C's structured report, source-file and lineage APIs; see the integration notes below. Keep backend calculation/source ownership with C and extraction with B.
- Validation: Before this status update, `npm run build`, 6 domain tests and 10 browser flows passed; the final graph zoom correction also passed a targeted browser check. Tests cover search/filter, numeric source inspection, drag/button reordering, configuration persistence, revisions, real PDF/DOCX/Markdown downloads, upload persistence, source URL validation, contextual chat, project isolation and 390px layout. Results are frontend prototype validation, not verification of C's newly fetched backend or live providers. This documentation-only update is checked for links and Git whitespace errors; application tests are not rerun for it.
- Blockers: No blocker to run the local prototype. API consumption, live document processing, external research and open-ended AI chat remain unconnected in the UI; project/deal identity and the frontend-to-backend transport still need alignment.

## Delivered frontend

- Projects: project cards/list, search, sector filter and local project creation. Enfuce contains saved historical evidence; Circle and BackerKit are empty starter workspaces, not connected company reports.
- Dashboard: source-bound H1 2020 figures and monthly revenue chart, snapshot evidence coverage, selectable metric details and source/formula/result lineage with zoom.
- Report: 12 configurable modules; sub-topics, depth, geography, time horizon, evidence scope and focus; drag/button ordering; deterministic evidence preview; linked citations; human edits, revision comparisons, findings and activity; PDF/DOCX/Markdown export.
- Data room: browser-local file storage, source categories/search, external link registration, text/image/video/PDF viewers and original-file downloads. New files are explicitly unextracted; links are unretrieved.
- Contextual chat: limited local evidence answers and navigation, labeled as a local assistant. It is not connected to a live model.
- Shared UI: white sidebar/project cards, monochrome financial dashboard, purple lineage canvas and document/findings/activity review layout based on the human's four references; responsive navigation and dialog keyboard support.
- Documentation: `frontend/README.md` is the detailed website reference; root `README.md` links to it. `frontend/DESIGN.md` records visual direction.

## Integration handoff

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
