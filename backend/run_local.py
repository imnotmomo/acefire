"""Start the local API with private backend/.env configuration (never printed)."""
import os
import sys
from pathlib import Path
import uvicorn

ALLOWED = {'DATA_STORE', 'FIREBASE_PROJECT_ID', 'FIRESTORE_DATABASE_ID',
           'GOOGLE_APPLICATION_CREDENTIALS', 'SOURCE_FILE_MANIFEST', 'DUCKDB_PATH',
           'NICRRON_API_KEY', 'NICRRON_BASE_URL', 'LLM_MODEL', 'NICRRON_MODEL',
           'LOCAL_EXECUTION_TIMEOUT_SECONDS', 'AGENT_EXECUTION_TIMEOUT_SECONDS', 'ACEFIRE_PORT'}

if __name__ == '__main__':
    root = Path(__file__).resolve().parent
    sys.path.insert(0, str(root.parent))
    path = root / '.env'
    if path.is_file():
        for line in path.read_text().splitlines():
            name, separator, value = line.strip().removeprefix('export ').partition('=')
            name, value = name.strip(), value.strip()
            if separator and name in ALLOWED:
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                    value = value[1:-1]
                os.environ.setdefault(name, value)
    os.chdir(root)
    uvicorn.run('app.main:app', host='127.0.0.1', port=int(os.getenv('ACEFIRE_PORT', '8017')))
