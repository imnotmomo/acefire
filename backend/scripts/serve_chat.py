"""Start the local evidence API using ignored machine-local configuration."""
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def main():
    config_path = Path(os.environ.get('ACEFIRE_CHAT_CONFIG', str(ROOT / 'runtime' / 'chat-config.json')))
    config = json.loads(config_path.read_text()) if config_path.is_file() else {}
    for key in ('NICRRON_API_KEY_FILE', 'DUCKDB_PATH'):
        if key in config:
            os.environ.setdefault(key, str(config[key]))
    os.environ.setdefault('DUCKDB_PATH', str(ROOT / 'runtime' / 'acefire.duckdb'))
    key_file = os.environ.get('NICRRON_API_KEY_FILE')
    if not os.environ.get('NICRRON_API_KEY', '').strip() and not (key_file and Path(key_file).expanduser().is_file()):
        raise SystemExit('Configure NICRRON_API_KEY or NICRRON_API_KEY_FILE in the backend environment or runtime/chat-config.json.')
    if not Path(os.environ['DUCKDB_PATH']).is_file():
        raise SystemExit('Configured database is missing; import the company sources first.')
    sys.path.insert(0, str(ROOT / 'backend'))
    import uvicorn
    uvicorn.run('app.main:app', host='127.0.0.1', port=int(os.environ.get('PORT', '8000')))


if __name__ == '__main__':
    main()
