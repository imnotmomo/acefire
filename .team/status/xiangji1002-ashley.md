# xiangji1002-ashley

- Role: Product Manager — product scope, investment-firm semantic layer, metric catalog, demo narrative, acceptance criteria and hackathon pitch.
- State: ready_for_review
- Updated: 2026-10-24
- Working on: Completed the PM integration of the current GitHub product into one pitch-ready story. The product is an evidence-first data agent: each investment firm supplies a versioned semantic layer and metric catalog; each new project searches its data room for compatible evidence, calculates the catalog metrics and exposes provenance, gaps and assumptions.
- Active paths: None reserved after this documentation handoff. This change covers `PITCH.md`, `README.md`, `AGENTS.md`, `TEAM_STATUS.md` and `.team/status/xiangji1002-ashley.md`; no frontend, backend, API, database or extraction implementation paths were changed.
- Shared contracts: Product contract and demo acceptance only. This task does not change existing API/model/schema contracts. Proposed metric semantics must be implemented by C and rendered by the frontend rather than recalculated in the browser.
- Handoff: The latest `main` capabilities are now mapped into a four-minute demo, seven-slide deck, readiness boundary and fallback checklist. The earlier four-metric-only PM PR is superseded by this catalog-driven product contract and should not be merged independently without reconciliation.
- Validation: `git diff --check` passed; all 41 frontend unit tests passed; the production TypeScript/Vite build passed on the integrated `main` baseline. No live Firebase, Nicrron or source-document call was made for this documentation integration.
- Blockers: No documentation blocker. Full live demo still requires the prepared private source data, authorized Firebase access and configured model credentials described by C; the local Enfuce fixture remains the offline fallback.
