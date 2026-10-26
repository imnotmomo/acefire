#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
export ROUNDTABLE_ENABLED=false

npm --prefix "$repo_root/frontend" ci
npm --prefix "$repo_root/frontend" test
npm --prefix "$repo_root/frontend" run build
# Run actual file choosers, dialogs, persistence/retry and exports against offline fixtures.
(cd "$repo_root/frontend" && npm run test:workflows)
# These tests cover the disabled integration and use local stubs, without its SDK.
npm --prefix "$repo_root/roundtable" test

while IFS= read -r -d '' script; do
  bash -n "$script"
done < <(find "$repo_root/deploy" "$repo_root/scripts" -type f -name '*.sh' -print0)
