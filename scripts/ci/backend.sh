#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
python_bin=${PYTHON:-python3}
# Resolve a caller-supplied relative venv path before entering backend/.
if [[ "$python_bin" == */* ]]; then
  python_bin=$(cd -- "$(dirname -- "$python_bin")" && pwd)/$(basename -- "$python_bin")
fi

command -v node >/dev/null && [[ -d "$repo_root/frontend/node_modules/jspdf" ]] || {
  echo 'Node and installed frontend dependencies are required for the PDF export integration tests.' >&2
  echo 'Install the supported Node runtime, then run npm --prefix frontend ci.' >&2
  exit 1
}
command -v soffice >/dev/null || command -v libreoffice >/dev/null || {
  echo 'LibreOffice is required so real Office conversion tests cannot silently skip.' >&2
  exit 1
}
command -v tesseract >/dev/null || {
  echo 'Tesseract and its English/Chinese language data are required.' >&2
  exit 1
}
languages=$(tesseract --list-langs 2>/dev/null)
for language in eng chi_sim chi_tra; do
  if ! grep -Fxq "$language" <<< "$languages"; then
    echo "Missing Tesseract language: $language" >&2
    exit 1
  fi
done

export DATA_ROOT=${DATA_ROOT:-"$repo_root/data/additional-cases"}
export AKTA_DATA_ROOT=${AKTA_DATA_ROOT:-"$repo_root/data/akta"}
export DATA_STORE=duckdb
export ROUNDTABLE_ENABLED=false
# PR tests use mocks and local fixtures, never deployment credentials.
export NICRRON_API_KEY= AKTA_API_KEY= OPENAI_API_KEY=
unset NICRRON_API_KEY_FILE GOOGLE_APPLICATION_CREDENTIALS

cd -- "$repo_root/backend"
exec "$python_bin" -m pytest -q "$@"
