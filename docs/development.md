# Local development

The maintained application is the React frontend plus `backend/app/main.py`. The Python files under `frontend/` are a retained early `/ask` prototype; do not start them as the company API.

## Prerequisites

- Python 3.12 and Node.js 22.18 or later. The home host uses pinned Node.js 24.22.1.
- LibreOffice Writer/Impress for Office documents and real conversion tests.
- Tesseract with English, Simplified Chinese and Traditional Chinese language data for image/scanned-PDF processing.

Create a backend virtual environment and install the locked dependencies from the repository root:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.lock
npm --prefix frontend ci
```

On Windows, use `backend\.venv\Scripts\python.exe` instead of `backend/.venv/bin/python`.

## Private configuration

Create `backend/.env` using [`backend/.env.example`](../backend/.env.example) as a reference. Preserve an existing private environment. The local launcher reads an allowlist of values; it does not execute the file as a shell script.

For the shared database, configure your own authorized server-side credentials:

```dotenv
DATA_STORE=firestore
FIREBASE_PROJECT_ID=acefire-50248
FIRESTORE_DATABASE_ID=acefire
GOOGLE_APPLICATION_CREDENTIALS=/private/path/to/authorized-credentials.json
ACEFIRE_PORT=8017
```

Add the model credential and model settings from the example when live calculations, drafting or chat are needed. Keep credential JSON and actual key values outside Git. Original-file preview also needs an authorized private `SOURCE_FILE_MANIFEST`; a database record alone does not supply its original bytes.

Create the ignored `frontend/.env.local`:

```dotenv
ACEFIRE_BACKEND_URL=http://127.0.0.1:8017
VITE_API_BASE_URL=/api
```

Run the backend and frontend in separate terminals from the repository root:

```bash
backend/.venv/bin/python backend/run_local.py
```

```bash
npm --prefix frontend run dev
```

The web app opens at `http://127.0.0.1:5173`; API documentation is at `http://127.0.0.1:8017/docs`. Vite forwards `/api` to the backend and removes that prefix. `npm --prefix frontend run preview` serves a built frontend on port 4173 with the same proxy configuration.

## Offline data

Without `DATA_STORE=firestore`, the backend uses DuckDB for local compatibility. The [backend guide](../backend/README.md) documents schema initialization and the optional Circle fixture import from `data/akta/` and `data/additional-cases/`. Use a separate local database path for experiments; the import commands are not part of ordinary production startup or deployment.

Saved Akta responses require no API call. Live provider calls require valid configured credentials. Tests mock model outputs where appropriate; a passing unit test does not prove a live provider connection.

## Validation

On systems with Make, run `make test` from the repository root for the CI check scripts, or use `make test-backend` and `make test-frontend` separately. Install both dependency sets first: backend PDF round-trip tests call the frontend PDF writer, so they also require Node and the installed frontend packages. The equivalent underlying commands are below.

Run the backend suite from `backend/`:

```bash
cd backend
.venv/bin/python -m pytest -q
```

From the repository root, run frontend checks and the disabled-by-default Roundtable adapter tests:

```bash
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix roundtable test
```

Office/OCR checks need their native tools. Real original files and committed company fixtures are used by some source-provenance tests; keep their registered bytes intact. The frontend also provides explicit browser integration commands in [`frontend/package.json`](../frontend/package.json). Run only the suites appropriate to an authorized environment; some expect a running backend or live data.

## Deployment and collaboration

Read [the home server runbook](../deploy/home-vm/README.md) for current runtime paths, release verification and rollback. Git pushes, browser-local storage and database imports are separate operations. The legacy Windows auto-push utility is documented under [`scripts/`](../scripts/README.md); it commits frontend work and can trigger the repository’s deployment pipeline.

Before editing shared code, read [`AGENTS.md`](../AGENTS.md), [`TEAM_STATUS.md`](../TEAM_STATUS.md) and the per-person `.team/status/` files. Preserve active teammate changes, API contracts, exact decimals and source locators.
