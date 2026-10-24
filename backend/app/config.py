import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def data_root() -> Path:
    return Path(os.environ.get('DATA_ROOT', str(ROOT / 'data' / 'additional-cases'))).resolve()


def cache_root() -> Path:
    return Path(os.environ.get('SOURCE_CACHE_DIR', str(ROOT / 'backend' / '.cache' / 'sources'))).resolve()


def akta_data_root() -> Path:
    return Path(os.environ.get('AKTA_DATA_ROOT', str(ROOT / 'data' / 'akta'))).resolve()


def database_path() -> str:
    return os.environ.get('DUCKDB_PATH', str(ROOT / 'backend' / '.cache' / 'acefire.duckdb'))
