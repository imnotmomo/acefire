# Evidence bot

The React **Ask your evidence** dialog now calls the shared FastAPI backend.
`POST /deals/{deal_id}/evidence-chat` accepts `{"question":"收入来自哪些业务？"}`.
It returns `status`, `answer` with numbered citations, source-bound `statements`,
`sources` (original filename, SHA-256, locator, excerpt, record ID and original-file URL),
`gaps` and retrieval `coverage`. Unknown deals return 404, invalid questions 422,
invalid citations/model output 502 and unavailable model/configuration 503.

## Run

Local machine configuration is saved in ignored `runtime/chat-config.json`,
which points to the existing key file and prepared Enfuce database. No key is
copied into code or frontend variables. Start from the repository root:

```bash
.venv/bin/python backend/scripts/serve_chat.py
```

Environment variables override the local config. For another machine, set them
explicitly using the existing Python environment:

```bash
export DUCKDB_PATH="$PWD/runtime/acefire.duckdb"
export NICRRON_API_KEY_FILE=/absolute/path/to/your/existing/key.txt
PYTHONPATH=backend .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Alternatively set `NICRRON_API_KEY` in the backend process environment. Never
put credentials in React/VITE variables. The bot reuses the sponsor Nicrron
client and pins `openai/gpt-4.1`; two sequential model calls generate and check
source support. Backend requirements now explicitly include openpyxl.
Start the frontend using its existing Vite setup; `/api` proxies to port 8000.
Select the database explicitly: the backend default `.cache` database is distinct
from B's prepared `runtime/acefire.duckdb`.

## Evidence behavior

- Retrieval is scoped to the selected registered deal/entity. It never accepts
  arbitrary file paths, SQL, model tools or document instructions.
- Registered original bytes are checked against their stored SHA-256 on each
  request. Missing/changed/unreadable sources are excluded and reported.
- Searches existing observations, source-bound document claims, profile fields,
  saved calculations/comparisons and original PDF text, JSON leaves, CSV rows, text lines,
  DOCX paragraphs, PPTX slide paragraphs and XLSX/XLSM rows. Formula text is not
  executed; computed answers must use C's saved results, inputs and formulas.
- Lexical ranking includes basic Chinese financial/business topic expansion.
  At most 24 chunks / 55,000 serialized evidence characters enter the prompt.
  This is bounded retrieval, not exhaustive semantic search. Unregistered raw
  files are not silently imported. Binary DOC/PPT/XLS, scanned pages and embedded
  images need the existing extraction/PDF/OCR workflow; gaps remain visible.
- Every factual statement must cite returned context IDs. Unknown references
  reject the whole completion. A separate model pass checks support; failed
  statements are withheld. This reduces unsupported answers but is not a
  mathematical guarantee of entailment or independent factual verification.
- Unsupported questions return insufficient evidence. Forecasts, raw/unreviewed
  claims, incompatible definitions and conflicts must keep their qualifiers.
- Each request contains the current question only. No persistent chat memory,
  new tables, authentication, external research or automatic data ingestion.
  Run this development service on loopback; existing source APIs are local APIs.

## Validation

Run `PYTHONPATH=..:. ../.venv/bin/python -m pytest -q` from `backend/`.
`tests/test_chat.py` checks citation IDs, cross-deal isolation, exact excerpts,
source hashes, withheld unsupported statements, missing evidence, API validation,
sanitized provider failures, and native Office/Excel locators with mocked model
responses. A real provider call requires backend credentials and is a separate
end-to-end validation.

Frontend mapping uses explicit backend company IDs. The historical Enfuce snapshot stays local. Registered workspaces open the source-file drawer from the data room or company-chat switch.

C’s whole-company `/deals/{deal_id}/chat` contract remains separate: it accepts report ID, history and working draft. The source-file endpoint accepts a question and searches registered originals; both interfaces preserve their own cited response contracts.
