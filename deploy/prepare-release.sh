#!/usr/bin/env bash
set -euo pipefail
umask 027
release_id=${1:?release id required}
commit=${2:?commit required}
[[ "$release_id" =~ ^[0-9TZ-]+[a-f0-9]+$ ]] || { echo 'Invalid release ID'; exit 1; }
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit'; exit 1; }
release="/srv/ingenium/releases/$release_id"
[[ ! -e "$release" ]] || { echo 'Release already exists'; exit 1; }
install -d -m 0750 -o root -g ingenium /srv/ingenium/releases
install -d -m 0750 -o ingenium -g ingenium "$release"
runuser -u ingenium -- git -C /srv/ingenium/app archive "$commit" | tar -x -C "$release" --no-same-owner
chown -R ingenium:ingenium "$release"
runuser -u ingenium -- python3 -m venv "$release/backend/.venv"
runuser -u ingenium -- "$release/backend/.venv/bin/python" -m pip install --disable-pip-version-check -r "$release/backend/requirements-dev.txt" > "/var/log/ingenium-python-$release_id.log" 2>&1
runuser -u ingenium -- "$release/backend/.venv/bin/python" -m pip check
runuser -u ingenium -- "$release/backend/.venv/bin/python" -m pip freeze > "$release/backend/requirements.resolved.txt"
runuser -u ingenium -- npm --prefix "$release/frontend" ci > "/var/log/ingenium-npm-$release_id.log" 2>&1
runuser -u ingenium -- npm --prefix "$release/frontend" run build > "/var/log/ingenium-build-$release_id.log" 2>&1
runuser -u ingenium -- bash -c 'cd "$1/backend" && DATA_ROOT="$1/data/additional-cases" AKTA_DATA_ROOT="$1/data/akta" .venv/bin/python -m pytest -q' _ "$release" > "/var/log/ingenium-tests-$release_id.log" 2>&1
runuser -u ingenium -- npm --prefix "$release/frontend" test >> "/var/log/ingenium-tests-$release_id.log" 2>&1
python3 - "$release" "$release_id" "$commit" <<'PY'
import json,sys
from datetime import datetime,timezone
from pathlib import Path
root=Path(sys.argv[1]);metadata={'release_id':sys.argv[2],'commit':sys.argv[3],'built_at_utc':datetime.now(timezone.utc).isoformat(),'frontend':'Ingenium','storage':'firestore','firebase_project_id':'acefire-50248','database_id':'acefire'}
(root/'frontend/dist/release.json').write_text(json.dumps(metadata,indent=2)+'\n')
PY
install -d -m 0755 -o root -g root "/var/www/ingenium/releases/$release_id"
cp -a "$release/frontend/dist/." "/var/www/ingenium/releases/$release_id/"
chown -R root:root "/var/www/ingenium/releases/$release_id"
find "/var/www/ingenium/releases/$release_id" -type d -exec chmod 0755 {} +
find "/var/www/ingenium/releases/$release_id" -type f -exec chmod 0644 {} +
echo "Prepared release $release_id; current app is unchanged."
tail -5 "/var/log/ingenium-tests-$release_id.log"
