#!/usr/bin/env bash
set -euo pipefail
umask 077
release_id=${1:?release id required}
[[ "$release_id" =~ ^[0-9TZ-]+[a-f0-9]+$ ]] || exit 1
release="/srv/ingenium/releases/$release_id"
static="/var/www/ingenium/releases/$release_id"
[[ -x "$release/backend/.venv/bin/python" && -f "$static/release.json" ]] || { echo 'Release not prepared'; exit 1; }
[[ -f /etc/ingenium/backend.env && -f /etc/ingenium/firestore-runtime.json ]] || { echo 'Private runtime configuration missing'; exit 1; }
backup="/root/ingenium-deploy-backups/$release_id"
install -d -m 0700 "$backup"
cp -a /etc/caddy/Caddyfile "$backup/Caddyfile"
readlink -f /var/www/ingenium/current > "$backup/previous-static"
if [[ -L /srv/ingenium/current ]]; then readlink -f /srv/ingenium/current > "$backup/previous-app"; else : > "$backup/previous-app"; fi
if [[ -f /etc/systemd/system/ingenium-backend.service ]]; then cp -a /etc/systemd/system/ingenium-backend.service "$backup/backend.service"; fi
systemctl is-active ingenium-backend > "$backup/was-active" || true
systemctl is-enabled ingenium-backend > "$backup/was-enabled" 2>/dev/null || true
cat > "$backup/rollback.sh" <<'ROLLBACK'
#!/usr/bin/env bash
set -u
backup=$(cd "$(dirname "$0")" && pwd)
systemctl stop ingenium-backend 2>/dev/null || true
previous=$(cat "$backup/previous-app")
if [[ -n "$previous" ]]; then ln -sfn "$previous" /srv/ingenium/current.rollback; mv -Tf /srv/ingenium/current.rollback /srv/ingenium/current; else rm -f /srv/ingenium/current; fi
previous=$(cat "$backup/previous-static")
ln -sfn "$previous" /var/www/ingenium/current.rollback
mv -Tf /var/www/ingenium/current.rollback /var/www/ingenium/current
cp -a "$backup/Caddyfile" /etc/caddy/Caddyfile
if [[ -f "$backup/backend.service" ]]; then
  cp -a "$backup/backend.service" /etc/systemd/system/ingenium-backend.service
else
  systemctl disable ingenium-backend 2>/dev/null || true
  rm -f /etc/systemd/system/ingenium-backend.service
fi
systemctl daemon-reload
if [[ -f "$backup/backend.service" ]]; then
  if grep -qx enabled "$backup/was-enabled"; then systemctl enable ingenium-backend; else systemctl disable ingenium-backend; fi
  if grep -qx active "$backup/was-active"; then systemctl start ingenium-backend; fi
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy
printf 'Restored previous release.\n'
ROLLBACK
chmod 0700 "$backup/rollback.sh"
rollback() { trap - ERR; echo 'Activation failed; restoring previous release.'; bash "$backup/rollback.sh"; exit 1; }
trap rollback ERR
ln -sfn "$release" /srv/ingenium/current.next
mv -Tf /srv/ingenium/current.next /srv/ingenium/current
install -m 0644 -o root -g root /root/ingenium-deploy-staging/ingenium-backend.service /etc/systemd/system/ingenium-backend.service
systemd-analyze verify /etc/systemd/system/ingenium-backend.service
systemctl daemon-reload
systemctl enable ingenium-backend
systemctl restart ingenium-backend
ready=0
for attempt in {1..30}; do
  if curl --silent --fail --max-time 3 http://127.0.0.1:8017/health > "$backup/new-health.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Backend did not become healthy'; false; }
python3 - "$backup/new-health.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]));assert h['status']=='ok' and h['storage']=='firestore' and h['database_id']=='acefire'
PY
curl --silent --show-error --fail --max-time 60 http://127.0.0.1:8017/deals/enfuce-2020/report > "$backup/enfuce-check.json"
python3 - "$backup/enfuce-check.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert r['company']['deal_id']=='enfuce-2020' and len(r['reported_metrics'])==19 and len(r['stored_reports'])==2
PY
caddy fmt --overwrite /root/ingenium-deploy-staging/Caddyfile
caddy validate --config /root/ingenium-deploy-staging/Caddyfile --adapter caddyfile
install -m 0644 -o root -g root /root/ingenium-deploy-staging/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
ln -sfn "$static" /var/www/ingenium/current.next
mv -Tf /var/www/ingenium/current.next /var/www/ingenium/current
curl --silent --show-error --fail --max-time 30 https://ingenium.linearproduct.co/api/health > "$backup/public-health.json"
curl --silent --show-error --fail --max-time 30 https://ingenium.linearproduct.co/release.json > "$backup/public-release.json"
python3 - "$backup/public-health.json" "$backup/public-release.json" "$release_id" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['storage']=='firestore'
assert json.load(open(sys.argv[2]))['release_id']==sys.argv[3]
PY
systemctl is-active ingenium-backend caddy
trap - ERR
echo "Activated $release_id; rollback: $backup/rollback.sh"
