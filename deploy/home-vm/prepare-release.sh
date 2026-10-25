#!/usr/bin/env bash
set -euo pipefail
umask 027
release_id=${1:?release id required}
staging=${2:?private staging path required}
[[ $(id -u) == 0 && "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-home-[a-f0-9]{12}$ ]] || exit 1
exec 9>/run/ingenium-home-deploy.lock
flock -n 9 || { echo 'Another home deployment is active.'; exit 1; }
[[ ! -e /srv/ingenium/current && ! -L /srv/ingenium/current && ! -e /var/www/ingenium/current && ! -L /var/www/ingenium/current ]] || {
  echo 'This is a first-provisioning script; preserve the installed release and use the update runbook.'; exit 1;
}
release="/srv/ingenium/releases/$release_id"
backup="/root/ingenium-home-deploy-backups/$release_id"
[[ ! -e "$release" ]] || { echo 'Release already exists; inspect before retry.'; exit 1; }
install -d -m 0700 "$backup" "$backup/imported"
cp -a /etc/nginx/sites-available/acefire-status "$backup/nginx-status.before"
cp -a /etc/nginx/sites-enabled "$backup/nginx-enabled.before"
cp -a /etc/cloudflared/config.yml "$backup/cloudflared.before.yml"
install -d -m 0750 -o ingenium -g ingenium "$release"
python3 - "$staging" "$release" "$backup/imported" <<'PY'
from hashlib import sha256
from pathlib import Path
import json,sys,tarfile
staging,release,private=map(Path,sys.argv[1:])
manifest=json.loads((staging/'artifact-manifest.json').read_text())
for name,expected in manifest['files'].items():
    path=staging/name
    assert path.is_file() and sha256(path.read_bytes()).hexdigest()==expected['sha256'],name
for name,destination in [('application-base-97658f4.tar.gz',release),('frontend-approved-source.tar.gz',release),('private-runtime-and-evidence.tar.gz',private)]:
    with tarfile.open(staging/name,'r:gz') as archive:
        archive.extractall(destination,filter='data')
PY
chown -R ingenium:ingenium "$release"
install -m 0600 -o root -g root "$backup/imported/etc/ingenium/backend.env" /etc/ingenium/backend.env
for name in source-files.json english-translations.json prism.env; do
  install -m 0640 -o root -g ingenium "$backup/imported/etc/ingenium/$name" "/etc/ingenium/$name"
done
install -m 0640 -o root -g ingenium "$staging/home-firestore-runtime.json" /etc/ingenium/firestore-runtime.json
cp -a "$backup/imported/opt/ingenium-prism" /opt/ingenium-prism
chown -R root:ingenium /opt/ingenium-prism
find /opt/ingenium-prism -type d -exec chmod 0750 {} +
find /opt/ingenium-prism -type f -exec chmod 0640 {} +
rsync -a "$backup/imported/var/lib/ingenium/sources/" /var/lib/ingenium/sources/
rsync -a "$backup/imported/var/lib/ingenium/uploads/" /var/lib/ingenium/uploads/
chown -R root:ingenium /var/lib/ingenium/sources
find /var/lib/ingenium/sources -type d -exec chmod 0750 {} +
find /var/lib/ingenium/sources -type f -exec chmod 0640 {} +
chown -R ingenium:ingenium /var/lib/ingenium/uploads
chmod 0700 /var/lib/ingenium/uploads

runuser -u ingenium -- python3 -m venv "$release/backend/.venv"
runuser -u ingenium -- "$release/backend/.venv/bin/python" -m pip install --disable-pip-version-check -r "$release/backend/requirements.lock" > "$backup/python-install.log" 2>&1
runuser -u ingenium -- "$release/backend/.venv/bin/python" -m pip check
runuser -u ingenium -- npm --prefix "$release/frontend" ci > "$backup/npm-install.log" 2>&1
runuser -u ingenium -- npm --prefix "$release/frontend" run build > "$backup/frontend-build.log" 2>&1
runuser -u ingenium -- bash -c 'cd "$1/backend" && DATA_ROOT="$1/data/additional-cases" AKTA_DATA_ROOT="$1/data/akta" .venv/bin/python -m pytest -q' _ "$release" > "$backup/tests.log" 2>&1
runuser -u ingenium -- npm --prefix "$release/frontend" test >> "$backup/tests.log" 2>&1

install -d -m 0755 -o root -g root "/var/www/ingenium/releases/$release_id"
python3 - "$staging" "/var/www/ingenium/releases/$release_id" "$release_id" <<'PY'
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,sys,tarfile
staging,public=map(Path,sys.argv[1:3])
with tarfile.open(staging/'frontend-approved-dist.tar.gz','r:gz') as archive:
    archive.extractall(public,filter='data')
approved=json.loads((staging/'frontend-approved-manifest.json').read_text())
dist=next(item for item in approved['archives'] if item['name']=='frontend-approved-dist.tar.gz')
expected_paths={item['path'] for item in dist['files']}
assert {str(path.relative_to(public)) for path in public.rglob('*') if path.is_file()}==expected_paths
for entry in dist['files']:
    path=public/entry['path']
    assert path.stat().st_size==entry['bytes'] and sha256(path.read_bytes()).hexdigest()==entry['sha256'],entry['path']
metadata=json.loads((public/'release.json').read_text())
metadata['previous_backend_release']=metadata.get('backend_release_id')
metadata['backend_release_id']=sys.argv[3]
metadata.update({'release_id':sys.argv[3],'deployment_target':'acefire-home-vm','public_hostname':'acefire.linearproduct.co','transport':'cloudflare_tunnel','firebase_database_edition':'STANDARD','previous_frontend_release':'20261024T203754Z-6ff0a06c537f','backend_commit':'97658f4fef0a3ac6bd214b3ae95f2851d2afba21','deployed_at_utc':datetime.now(timezone.utc).isoformat()})
(public/'release.json').write_text(json.dumps(metadata,indent=2)+'\n')
assert sha256((public/'index.html').read_bytes()).hexdigest()=='fe5c799a1a16e75d7a1056f6c130263599b0574582c547af53d85f06ce52df84'
PY
chown -R root:root "/var/www/ingenium/releases/$release_id"
find "/var/www/ingenium/releases/$release_id" -type d -exec chmod 0755 {} +
find "/var/www/ingenium/releases/$release_id" -type f -exec chmod 0644 {} +
ln -sfn "$release" /srv/ingenium/current
ln -sfn "/var/www/ingenium/releases/$release_id" /var/www/ingenium/current
install -m 0644 -o root -g root "$backup/imported/etc/systemd/system/ingenium-backend.service" /etc/systemd/system/ingenium-backend.service
install -d -m 0755 /etc/systemd/system/ingenium-backend.service.d
install -m 0644 -o root -g root "$backup/imported/etc/systemd/system/ingenium-backend.service.d/prism.conf" /etc/systemd/system/ingenium-backend.service.d/prism.conf
cat > /etc/systemd/system/ingenium-backend.service.d/home-resources.conf <<'UNIT'
[Service]
MemoryMax=1400M
Environment=OMP_NUM_THREADS=1
UNIT
systemd-analyze verify /etc/systemd/system/ingenium-backend.service
systemctl daemon-reload
systemctl enable ingenium-backend
systemctl restart ingenium-backend
ready=0
for attempt in {1..30}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:8017/health > "$backup/health.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Backend not healthy; public website has not been changed.'; exit 1; }
python3 - "$backup/health.json" <<'PY'
import json,sys
health=json.load(open(sys.argv[1]));assert health['status']=='ok' and health['storage']=='firestore' and health['database_id']=='acefire'
PY
echo "Prepared $release_id; application is healthy on loopback. Public Nginx/tunnel remain unchanged."
tail -8 "$backup/tests.log"
