# Ask backend

Run these commands from the project root in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
$env:NICRRON_API_KEY = "your-api-key"
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

For local development, the backend also loads `NICRRON_API_KEY` from the project root `.env` file (ignored by Git). Existing environment variables take precedence. Set `NICRRON_API_KEY` in the backend's environment in production. Never use a frontend/public environment variable for the key.

`POST /ask` accepts JSON:

```json
{"question": "Where does the reported ARR come from?"}
```

Successful response:

```json
{"answer": "The model's answer"}
```

The backend calls `https://api.nicrron.ai/v1/chat/completions` with model `nicrron/auto`. Only the answer is returned. Upstream errors use generic messages; credentials are never returned. Requests time out after 60 seconds of network inactivity. Blank questions and questions longer than 20,000 characters are rejected.

Tests use mocked upstream responses and require no API key or network calls:

```powershell
.\.venv\Scripts\python.exe -m unittest backend.test_main -v
```

This endpoint sends the question only; document retrieval and evidence-backed answers are not implemented yet.
