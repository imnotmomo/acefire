#!/usr/bin/env bash
# Add only the QA ingress with a detached, automatically rolled-back restart.
set -euo pipefail
umask 077
[[ $(id -u) == 0 && $# == 0 ]] || exit 64
exec 9>/run/ingenium-qa-tunnel.lock
flock -n 9 || exit 1
backup=/var/lib/ingenium-qa-cd/tunnel-bootstrap
[[ ! -e "$backup" ]] || { echo 'Existing QA tunnel bootstrap requires inspection.' >&2; exit 1; }
install -d -m 0700 -o root -g root "$backup"
cp -a /etc/cloudflared/config.yml "$backup/before.yml"
python3 - "$backup" <<'PY'
from pathlib import Path
import re,sys
backup=Path(sys.argv[1]); current=(backup/'before.yml').read_text()
assert 'qa.linearproduct.co' not in current
pattern=re.compile(r'(?m)^(  )- hostname: ssh-acefire\.linearproduct\.co$')
assert len(pattern.findall(current))==1
(backup/'candidate.yml').write_text(pattern.sub('  - hostname: qa.linearproduct.co\n    service: http://127.0.0.1:8081\n  - hostname: ssh-acefire.linearproduct.co',current))
PY
cloudflared --config "$backup/candidate.yml" tunnel ingress validate
cloudflared --config "$backup/candidate.yml" tunnel ingress rule https://qa.linearproduct.co 2>&1 | grep -F 'http://127.0.0.1:8081'
for hostname in acefire.linearproduct.co ingenium.linearproduct.co; do
  cloudflared --config "$backup/candidate.yml" tunnel ingress rule "https://$hostname" 2>&1 | grep -F 'http://127.0.0.1:8080'
done
cloudflared --config "$backup/candidate.yml" tunnel ingress rule https://ssh-acefire.linearproduct.co 2>&1 | grep -F 'ssh://127.0.0.1:22'
cat > "$backup/rollback.sh" <<'ROLLBACK'
#!/usr/bin/env bash
set -euo pipefail
backup=/var/lib/ingenium-qa-cd/tunnel-bootstrap
if [[ ! -e "$backup/confirmed" ]]; then
  cmp -s "$backup/candidate.yml" /etc/cloudflared/config.yml || exit 1
  cp -a "$backup/before.yml" /etc/cloudflared/config.yml
  systemctl restart cloudflared
fi
ROLLBACK
chmod 0700 "$backup/rollback.sh"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
systemd-run --quiet --unit="ingenium-qa-tunnel-rollback-$stamp" --on-active=180s /bin/bash "$backup/rollback.sh"
cmp -s "$backup/before.yml" /etc/cloudflared/config.yml || {
  echo 'Tunnel changed after preparation; refusing to overwrite it.' >&2; exit 1;
}
install -m 0600 -o root -g root "$backup/candidate.yml" /etc/cloudflared/config.yml
systemd-run --quiet --unit="ingenium-qa-tunnel-restart-$stamp" --on-active=3s /bin/systemctl restart cloudflared
echo 'QA tunnel ingress staged; confirm public and SSH health within 180 seconds.'
