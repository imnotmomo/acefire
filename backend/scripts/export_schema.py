"""Export the native DuckDB baseline used by Store.initialize()."""
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.db_schema import SCHEMA_SQL, SCHEMA_VERSION, TABLE_NAMES


def render():
    header = '\n'.join([
        '-- Acefire: embedded DuckDB, no hosted database account.',
        f'-- Schema version {SCHEMA_VERSION}; generated from backend/app/db_schema.py.',
        '-- Akta primary company data + private uploaded evidence.',
        '-- Exact decimal strings; financial arithmetic uses Python Decimal.',
        '-- Calculations link to input numbers, immutable files and native locators.',
        '-- Fresh DuckDB baseline; init-db checks versions and repeat initialization.',
    ])
    return header + '\n\nBEGIN TRANSACTION;\n' + SCHEMA_SQL.strip() + '\nCOMMIT;\n'


if __name__ == '__main__':
    target = BACKEND.parent / 'database-design' / 'schema.sql'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render())
    print(f'Generated {len(TABLE_NAMES)} DuckDB tables at {target}')
