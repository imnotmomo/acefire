# Ingenium

**Trusted diligence, powered by the world’s evidence.**

Ingenium is a company diligence workspace for uploaded documents, source-linked calculations and cited reports. Every reported value or supporting quotation retains its original file and location; generated analysis preserves its inputs, assumptions and evidence.

The application runs at [ingenium.linearproduct.co](https://ingenium.linearproduct.co) and [acefire.linearproduct.co](https://acefire.linearproduct.co), on the home VM behind Cloudflare Tunnel. Firebase project `acefire-50248`, named Standard database `acefire`, stores shared records. Original files and processing jobs remain in private server storage.

## What works

- Create company workspaces and upload CSV, Excel, PDF, Office, text and image evidence.
- Extract source-bound claims through B’s document pipeline, with OCR where needed.
- Ask the calculation agent to generate and execute Python, retaining exact decimal values, source periods, assumptions and input lineage.
- Inspect numbers and supporting sentences through file, page, line, cell or JSON-field references.
- Generate cited reports, review evidence, preserve human revisions and export results.
- Ask either whole-company questions or source-file questions through the two chat modes.

Saved Akta responses provide the current Circle company profile. Orbis and PitchBook files simulate private supplemental uploads. Live Akta retrieval and the unavailable Enfuce original PDF remain explicit limitations; saved quotations do not substitute for missing original bytes. Login remains deferred.

## Start developing

Use Python 3.12, Node.js 22.18 or later, and the checked-in dependency locks. LibreOffice and Tesseract are needed for Office conversion and OCR.

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.lock
npm --prefix frontend ci
```

Configure the private backend environment and Vite proxy, then run each service in its own terminal:

```bash
backend/.venv/bin/python backend/run_local.py
```

```bash
npm --prefix frontend run dev
```

The backend launcher uses `127.0.0.1:8017`; set `ACEFIRE_BACKEND_URL=http://127.0.0.1:8017` in the ignored `frontend/.env.local`. Open `http://127.0.0.1:5173`. See [development setup](docs/development.md) for configuration, offline data and validation commands.

The root `Makefile` provides `make setup`, `make test`, `make build` and separate development targets. `make test` uses the same check scripts as CI.

## Repository map

| Directory | Purpose |
| --- | --- |
| [`frontend/`](frontend/README.md) | React/TypeScript application, evidence inspection and report workflow |
| [`backend/`](backend/README.md) | FastAPI, storage, document extraction, calculation workers, reports and chat |
| [`data/`](data/) | Checked-in company examples and saved provider responses |
| [`database-design/`](database-design/README.md) | Schema exports and database handoff artifacts |
| [`deploy/`](deploy/) | Server configuration and deployment procedures |
| [`docs/`](docs/README.md) | Architecture, development guide and historical archive |
| [`scripts/`](scripts/README.md) | Repository checks and developer utilities |
| [`roundtable/`](backend/ROUNDTABLE.md) | Optional adapter, disabled by default |
| [`.team/`](TEAM_STATUS.md) | Team ownership and handoff records |

## Team and reference guides

- [Architecture and data flow](docs/architecture.md)
- [Home server deployment](deploy/home-vm/README.md)
- [Firebase integration and immutable record format](backend/FIREBASE_INTEGRATION.md)
- [Document extraction and B → C handoff](backend/B_WORKFLOW.md)
- [Frontend framework and routes](frontend/README.md)
- [Pitch and metric catalog](PITCH.md)
- [Agent instructions](AGENTS.md) and [team status](TEAM_STATUS.md)

Keep API keys, service-account credentials, private originals and runtime databases outside Git. Agents should read the root instructions and each teammate’s status before editing shared code. The [historical conversation archive](docs/archive/chatgpt-conversation/README.md) records earlier planning; it is reference material, not current execution instructions.
