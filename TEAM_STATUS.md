# Shared team status

Read [AGENTS.md](AGENTS.md) and the per-person records before choosing files to edit. Each agent updates only its human teammate’s record; separate files reduce conflicts.

| Teammate | Confirmed responsibility | Work record |
| --- | --- | --- |
| `imnotmomo` | C: storage, calculations, company reports, provenance and deployment integration | [Current C work](.team/status/imnotmomo.md) |
| `chr950331` | B: document/Akta extraction and source-bound claims/report handoff | [B’s work record](.team/status/chr950331.md) |
| `xiangji1002-ashley` | Product scope, semantic layer, metric catalog, demo and acceptance criteria | [PM’s work record](.team/status/xiangji1002-ashley.md) |
| `XINWENGAri` | Frontend workspaces, evidence inspection, reports and contextual chat | [Frontend work record](.team/status/XINWENGAri.md) |

## Current integration

The home VM serves the approved Ingenium interface and FastAPI backend through Cloudflare Tunnel. Company creation, durable uploads, document/OCR extraction, source-linked calculations, saved/cited reports and both chat modes are integrated. The existing named Firebase database is Standard; DuckDB remains the offline/import format. Live Akta retrieval and the missing original Enfuce PDF remain separate unavailable inputs.

C completed **repository cleanup and home-server CI/CD integration**. Pull requests run offline checks; successful trusted main pushes now deploy to the home VM with a dedicated restricted key, public release verification and automatic rollback. Configured API credentials are encrypted Actions secrets. The detailed C record tracks validation and deployment evidence. This index does not change other teammates’ completion states; consult their own records and the human owner for overlapping work.

## Shared product flow

B supplies extracted claims and original locators → C stores evidence, calculates and returns reports/lineage → the frontend renders inspectable numbers and supporting sentences.

The firm defines a reusable semantic layer and metric catalog. Each project resolves those definitions against its own data room and exposes formulas, assumptions, gaps and provenance. Generic calculation/report primitives are implemented; automatic catalog execution for every new project is a separate productization step. The exact metric definitions and evidence rules are in [engineering contracts](docs/engineering-contracts.md).

## Reference guides

- [Architecture and runtime ownership](docs/architecture.md)
- [Development and validation](docs/development.md)
- [Home deployment and CI/CD](deploy/home-vm/README.md)
- [B extraction/handoff](backend/B_WORKFLOW.md)
- [Firebase records and imports](backend/FIREBASE_INTEGRATION.md)

These files are repository records, not a live presence system. Other checkouts see updates after normal Git synchronization. Preserve active ownership and distinguish historical handoffs from the current application state.
