# Documentation

Start with the [root README](../README.md) for the current application and repository layout.

| Guide | Contents |
| --- | --- |
| [Architecture](architecture.md) | Runtime components, storage, calculations and evidence flow |
| [Development](development.md) | Local setup, configuration and test commands |
| [Engineering contracts](engineering-contracts.md) | Exact metric definitions, evidence rules, shared schema/API boundaries and dated handoffs |
| [Frontend](../frontend/README.md) | Routes, UI state, evidence inspection, report review and export |
| [Backend](../backend/README.md) | APIs, schema, numeric normalization and offline compatibility |
| [Firebase handoff](../backend/FIREBASE_INTEGRATION.md) | Named database, immutable records and import contracts |
| [Document workflow](../backend/B_WORKFLOW.md) | B extraction and source-bound report handoff |
| [Upload workflow](../backend/WORKSPACE_UPLOADS.md) | Durable uploads, extraction jobs and file storage |
| [Home deployment](../deploy/home-vm/README.md) | Current server, private runtime layout and deployment operations |
| [Previous VPS deployment](../deploy/README.md) | Historical VPS release and rollback procedure |
| [Database design](../database-design/README.md) | Exported schema and data inventory artifacts |
| [Pitch](../PITCH.md) | Product scope, firm metric catalog and demo narrative |

## Historical material

[The ChatGPT conversation archive](archive/chatgpt-conversation/README.md) preserves the original planning snapshot, its provenance and its relative checksums. Its contents are historical source material. Current implementation contracts live in the guides above and in code.

[The archived scenario interface](archive/frontend-scenarios/README.md) preserves the reverted illustrative demo components, integration variants and photograph provenance. The active frontend follows the human-approved logo-only interface.

The small `frontend/main.py` `/ask` application is a retained early prototype. The running web application uses `backend/app/main.py`, reached through the frontend’s `/api` proxy. Its calculation, report and company-chat routes are the maintained integration.
