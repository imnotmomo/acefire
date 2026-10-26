#!/usr/bin/env bash
# Reviewed administrative bootstrap; never run from an application release.
set -euo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
[[ $# == 3 ]] || { echo 'Usage: provision-qa.sh REVIEWED_SOURCE QA_PUBLIC_KEY OFFLINE_SNAPSHOT' >&2; exit 64; }
source_directory=$1
public_key=$2
snapshot=$3
exec 9>/run/ingenium-qa-bootstrap.lock
flock -n 9 || { echo 'QA bootstrap is already active.' >&2; exit 1; }
[[ -f "$snapshot" && -f "$source_directory/seed_qa.py" ]]
[[ -f /etc/ingenium/backend.env && -f /etc/ingenium/source-files.json ]]
[[ ! -e /var/lib/ingenium-qa/acefire.duckdb && ! -e /srv/ingenium-qa/current ]] || {
  echo 'QA already has state; use normal CI/CD. Bootstrap never replaces a QA database.' >&2; exit 1;
}
if ! id ingenium-qa >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /srv/ingenium-qa --shell /usr/sbin/nologin ingenium-qa
fi
[[ $(id -nG ingenium-qa) == ingenium-qa ]]
install -d -m 0750 -o root -g ingenium-qa /srv/ingenium-qa /srv/ingenium-qa/releases /etc/ingenium-qa
install -d -m 0755 -o root -g root /var/www/ingenium-qa /var/www/ingenium-qa/releases
install -d -m 0700 -o root -g root /var/lib/ingenium-qa-cd
install -d -m 0700 -o ingenium-qa -g ingenium-qa /var/lib/ingenium-qa
install -d -m 0700 -o ingenium-qa -g ingenium-qa /var/lib/ingenium-qa/uploads /var/lib/ingenium-qa/fixtures /var/lib/ingenium-qa/fixtures/additional-cases /var/lib/ingenium-qa/fixtures/akta

# A separate copy provides an initial rollback target without changing production.
production_app=$(readlink -f /srv/ingenium/current)
production_public=$(readlink -f /var/www/ingenium/current)
baseline=/srv/ingenium-qa/releases/bootstrap
public_baseline=/var/www/ingenium-qa/releases/bootstrap
[[ "$production_app" == /srv/ingenium/releases/* && "$production_public" == /var/www/ingenium/releases/* ]]
[[ ! -e "$baseline" && ! -e "$public_baseline" ]]
cp -a "$production_app" "$baseline"
cp -a "$production_public" "$public_baseline"
chown -Rh root:ingenium-qa "$baseline"
ln -s "$baseline" /srv/ingenium-qa/current
ln -s "$public_baseline" /var/www/ingenium-qa/current
python3 - <<'PY'
from pathlib import Path
import json, os
values = {}
for line in Path('/etc/ingenium/backend.env').read_text().splitlines():
    if line and not line.startswith('#'):
        name, _, value = line.partition('=')
        values[name] = json.loads(value) if value.startswith('"') else value
assert values.get('NICRRON_API_KEY') and values.get('NICRRON_BASE_URL') == 'https://api.nicrron.ai/v1'
qa = {name: values[name] for name in ('NICRRON_API_KEY', 'NICRRON_BASE_URL', 'LLM_MODEL')}
qa.update(DATA_STORE='duckdb', DUCKDB_PATH='/var/lib/ingenium-qa/acefire.duckdb',
          SOURCE_CACHE_DIR='/var/lib/ingenium-qa/sources', UPLOAD_CACHE_ROOT='/var/lib/ingenium-qa/uploads',
          DATA_ROOT='/var/lib/ingenium-qa/fixtures/additional-cases', AKTA_DATA_ROOT='/var/lib/ingenium-qa/fixtures/akta')
path = Path('/etc/ingenium-qa/backend.env')
path.write_text(''.join(name+'='+json.dumps(value)+'\n' for name,value in qa.items()))
path.chmod(0o600)
translations=Path('/etc/ingenium/english-translations.json')
if translations.is_file():
    import shutil, grp
    target=Path('/etc/ingenium-qa/english-translations.json')
    shutil.copyfile(translations,target)
    os.chown(target,0,grp.getgrnam('ingenium-qa').gr_gid); target.chmod(0o640)
metadata_path=Path('/var/www/ingenium-qa/releases/bootstrap/release.json')
metadata=json.loads(metadata_path.read_text())
for name in ('firebase_project_id','database_id','firebase_database_edition'):
    metadata.pop(name,None)
metadata.update(environment='qa',branch='qa',storage='duckdb',deployment_target='acefire-home-vm-qa',public_hostname='qa.linearproduct.co',release_id='qa-bootstrap',backend_release_id='qa-bootstrap')
metadata_path.write_text(json.dumps(metadata,indent=2)+'\n')
metadata_path.chmod(0o644)
PY
PYTHONPATH="$baseline:$baseline/backend" "$baseline/backend/.venv/bin/python" "$source_directory/seed_qa.py" \
  --snapshot "$snapshot" --source-manifest /etc/ingenium/source-files.json --qa-root /var/lib/ingenium-qa
chown -R ingenium-qa:ingenium-qa /var/lib/ingenium-qa
chmod 0700 /var/lib/ingenium-qa
bash "$source_directory/install-cd.sh" "$public_key" "$source_directory" qa
install -m 0644 -o root -g root "$source_directory/ingenium-qa-backend.service" /etc/systemd/system/ingenium-qa-backend.service
install -m 0644 -o root -g root "$source_directory/nginx-qa.conf" /etc/nginx/sites-available/ingenium-qa
ln -sfn /etc/nginx/sites-available/ingenium-qa /etc/nginx/sites-enabled/ingenium-qa
nginx -t
systemctl daemon-reload
systemctl enable --now ingenium-qa-backend
systemctl reload nginx
python3 - <<'PY'
import json,time,urllib.request
for attempt in range(30):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8081/api/health',timeout=3) as r:
            health=json.load(r)
        assert health['status']=='ok' and health['storage']=='duckdb'
        print('QA isolated backend and Nginx are healthy.')
        break
    except (OSError,ValueError,AssertionError):
        if attempt==29: raise SystemExit('QA readiness failed; production remains unchanged.')
        time.sleep(1)
PY
echo 'QA provisioned. Configure only its new tunnel ingress and verify public HTTPS next.'
