#!/usr/bin/env bash
set -euo pipefail
umask 077
release_id=${1:?release id required}
[[ $(id -u) == 0 && "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-home-[a-f0-9]{12}$ ]] || exit 1
exec 9>/run/ingenium-home-deploy.lock
flock -n 9 || { echo 'Another home deployment is active.'; exit 1; }
backup="/root/ingenium-home-deploy-backups/$release_id"
[[ -f "$backup/cloudflared.before.yml" ]]
python3 - "$backup" <<'PY'
from pathlib import Path
import re,sys
backup=Path(sys.argv[1]);current=Path('/etc/cloudflared/config.yml').read_text()
assert current==(backup/'cloudflared.before.yml').read_text(), 'Tunnel configuration changed after preparation.'
assert 'ingenium.linearproduct.co' not in current
pattern=re.compile(r'(?m)^(\s*)-\s+hostname:\s*ssh-acefire\.linearproduct\.co\s*$')
matches=list(pattern.finditer(current));assert len(matches)==1
def insert(match):
    indent=match.group(1)
    return indent+'- hostname: ingenium.linearproduct.co\n'+indent+'  service: http://127.0.0.1:8080\n'+match.group(0)
(backup/'cloudflared.candidate.yml').write_text(pattern.sub(insert,current))
PY
cloudflared --config "$backup/cloudflared.candidate.yml" tunnel ingress validate
for hostname in acefire.linearproduct.co ingenium.linearproduct.co; do
  cloudflared --config "$backup/cloudflared.candidate.yml" tunnel ingress rule "https://$hostname" 2>&1 | grep -F 'http://127.0.0.1:8080'
done
cloudflared --config "$backup/cloudflared.candidate.yml" tunnel ingress rule https://ssh-acefire.linearproduct.co 2>&1 | grep -F 'ssh://127.0.0.1:22'
cat > "$backup/rollback-tunnel.sh" <<ROLLBACK
#!/usr/bin/env bash
set -eu
if [[ ! -f "$backup/tunnel-confirmed" ]]; then
  cmp -s "$backup/cloudflared.candidate.yml" /etc/cloudflared/config.yml || {
    echo 'Tunnel changed after staging; refusing to overwrite a newer configuration.' >&2; exit 1;
  }
  cp -a "$backup/cloudflared.before.yml" /etc/cloudflared/config.yml
  systemctl restart cloudflared
fi
ROLLBACK
chmod 0700 "$backup/rollback-tunnel.sh"
stamp=${release_id%%-home-*}
systemd-run --quiet --unit="ingenium-tunnel-rollback-$stamp" --on-active=120s /bin/bash "$backup/rollback-tunnel.sh"
install -m 0600 -o root -g root "$backup/cloudflared.candidate.yml" /etc/cloudflared/config.yml
systemd-run --quiet --unit="ingenium-tunnel-restart-$stamp" --on-active=3s /bin/systemctl restart cloudflared
echo 'Validated tunnel alias staged; detached restart scheduled with automatic rollback unless confirmed.'
