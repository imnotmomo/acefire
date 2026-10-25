#!/usr/bin/env bash
set -euo pipefail
umask 027
release_id=${1:?release id required}
staging=${2:?private staging path required}
[[ $(id -u) == 0 && "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-home-[a-f0-9]{12}$ ]] || exit 1
exec 9>/run/ingenium-home-deploy.lock
flock -n 9 || { echo 'Another home deployment is active.'; exit 1; }
backup="/root/ingenium-home-deploy-backups/$release_id"
[[ $(readlink -f /srv/ingenium/current) == "/srv/ingenium/releases/$release_id" ]]
[[ $(readlink -f /var/www/ingenium/current) == "/var/www/ingenium/releases/$release_id" ]]
install -d -m 0700 "$backup/final-imported" "$backup/application-baseline"
python3 - "$staging" "$backup" <<'PY'
from pathlib import Path
from hashlib import sha256
import json,sys,tarfile
staging,backup=map(Path,sys.argv[1:])
expected=json.loads((staging/'cutover-manifest.json').read_text())['files']
assert set(expected)=={'final-private-state.tar.gz','application-baseline.tar.gz'}
for filename,entry in expected.items():
    assert sha256((staging/filename).read_bytes()).hexdigest()==entry['sha256'], filename
for filename,destination in [('final-private-state.tar.gz',backup/'final-imported'),('application-baseline.tar.gz',backup/'application-baseline')]:
    with tarfile.open(staging/filename,'r:gz') as archive:archive.extractall(destination,filter='data')
PY
systemctl stop ingenium-backend
install -m 0600 -o root -g root "$backup/final-imported/etc/ingenium/backend.env" /etc/ingenium/backend.env
for name in source-files.json english-translations.json prism.env; do
  install -m 0640 -o root -g ingenium "$backup/final-imported/etc/ingenium/$name" "/etc/ingenium/$name"
done
rsync -a --checksum "$backup/final-imported/var/lib/ingenium/sources/" /var/lib/ingenium/sources/
rsync -a --checksum "$backup/final-imported/var/lib/ingenium/uploads/" /var/lib/ingenium/uploads/
chown -R root:ingenium /var/lib/ingenium/sources
find /var/lib/ingenium/sources -type d -exec chmod 0750 {} +
find /var/lib/ingenium/sources -type f -exec chmod 0640 {} +
chown -R ingenium:ingenium /var/lib/ingenium/uploads
chmod 0700 /var/lib/ingenium/uploads
systemctl start ingenium-backend
ready=0
for attempt in {1..30}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:8017/health > "$backup/health-final.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
install -m 0644 -o root -g root "$staging/nginx.conf" /etc/nginx/sites-available/ingenium
ln -sfn /etc/nginx/sites-available/ingenium /etc/nginx/sites-enabled/acefire-status
nginx -t
systemctl reload nginx
python3 - "$release_id" <<'PY'
from hashlib import sha256
import json,sys,time,urllib.request
expected=sys.argv[1]
for attempt in range(30):
    try:
        def get(path):
            with urllib.request.urlopen('http://127.0.0.1:8080'+path,timeout=5) as response:
                return response.read()
        health=json.loads(get('/api/health'))
        release=json.loads(get('/release.json'))
        assert health['status']=='ok' and health['storage']=='firestore'
        assert health['project_id']=='acefire-50248' and health['database_id']=='acefire'
        assert release['release_id']==expected
        assert sha256(get('/index.html')).hexdigest()=='fe5c799a1a16e75d7a1056f6c130263599b0574582c547af53d85f06ce52df84'
        print(json.dumps({'status':'ok','release_id':expected,'loopback_proxy_verified':True}))
        break
    except (OSError,ValueError,KeyError,AssertionError):
        if attempt==29:
            raise SystemExit('Nginx did not serve the intended release; keep public traffic on the previous host.')
        time.sleep(1)
PY
echo 'Home application activated on the existing loopback tunnel origin.'
