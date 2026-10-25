#!/usr/bin/env bash
# Install the trusted host-side gateway. Run manually as root, never from a release.
set -euo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run this installer as root.' >&2; exit 1; }
[[ $# == 2 ]] || { echo 'Usage: install-cd.sh PUBLIC_KEY_FILE SOURCE_DIRECTORY' >&2; exit 64; }
public_key_file=$1
source_directory=$2
deploy_user=ingenium-deploy
deploy_home=/var/lib/ingenium-deploy
library=/usr/local/libexec/ingenium-deploy
marker="$deploy_home/.managed-by-ingenium"
exec 9>/run/ingenium-home-deploy.lock
flock -n 9 || { echo 'Another home deployment is active.' >&2; exit 1; }
for command in python3 ssh-keygen useradd usermod install visudo; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
for filename in ssh-entrypoint.py apply_release.py verify_release.py; do
  [[ -f "$source_directory/$filename" && ! -L "$source_directory/$filename" ]] || {
    echo "Missing regular deployment source: $filename" >&2; exit 1;
  }
done
work=$(mktemp -d /run/ingenium-cd-install.XXXXXXXX)
trap 'rm -rf -- "$work"' EXIT
python3 - "$public_key_file" "$work" "$source_directory" <<'PY'
from pathlib import Path
import base64, struct, sys
key_path, work, source = map(Path, sys.argv[1:])
assert key_path.is_file() and key_path.stat().st_size <= 8192, 'Invalid public-key file.'
lines = [line for line in key_path.read_text(encoding='ascii').splitlines() if line.strip()]
assert len(lines) == 1, 'Provide exactly one Ed25519 public key.'
parts = lines[0].split()
assert len(parts) >= 2 and parts[0] == 'ssh-ed25519', 'An Ed25519 key is required.'
blob = base64.b64decode(parts[1], validate=True)
assert len(blob) == 51 and blob[:4] == struct.pack('>I', 11)
assert blob[4:15] == b'ssh-ed25519' and blob[15:19] == struct.pack('>I', 32)
(work / 'public-key').write_text('ssh-ed25519 ' + parts[1] + ' github-actions-ingenium\n')
for filename in ('ssh-entrypoint.py', 'apply_release.py', 'verify_release.py'):
    compile((source / filename).read_text(), str(source / filename), 'exec')
assert (source / 'apply_release.py').read_text().splitlines()[0] in (
    '#!/usr/bin/python3', '#!/usr/bin/python3 -I',
), 'The privileged controller needs a fixed system Python shebang.'
PY
ssh-keygen -lf "$work/public-key"
if id "$deploy_user" >/dev/null 2>&1; then
  [[ -f "$marker" && $(cat "$marker") == imnotmomo/acefire ]] || {
    echo 'An unmanaged deployment account already exists; inspect it before installing.' >&2; exit 1;
  }
  [[ $(getent passwd "$deploy_user" | cut -d: -f6) == "$deploy_home" ]]
  [[ $(getent passwd "$deploy_user" | cut -d: -f7) == /bin/sh ]]
  [[ $(id -nG "$deploy_user") == "$deploy_user" ]] || {
    echo 'The deployment account has unexpected group memberships.' >&2; exit 1;
  }
else
  [[ ! -e "$deploy_home" && ! -L "$deploy_home" ]] || {
    echo 'An unmanaged deployment home already exists; inspect it before installing.' >&2; exit 1;
  }
  useradd --system --user-group --no-create-home --home-dir "$deploy_home" --shell /bin/sh "$deploy_user"
fi
usermod --lock "$deploy_user"

# Public keys are readable, but only root can replace the key or its restrictions.
# sshd opens authorized_keys as the login user, so root-owned 0700/0600 would deny it.
install -d -m 0755 -o root -g root "$deploy_home" "$deploy_home/.ssh"
printf '%s\n' imnotmomo/acefire > "$marker"
chmod 0600 "$marker"
printf 'restrict,command="/usr/local/libexec/ingenium-deploy-ssh" %s\n' "$(cat "$work/public-key")" > "$work/authorized_keys"
install -m 0644 -o root -g root "$work/authorized_keys" "$deploy_home/.ssh/authorized_keys"

install -d -m 0755 -o root -g root /usr/local/libexec /usr/local/sbin
# Only the controller can create/switch releases; the running app cannot race it.
install -d -m 0750 -o root -g ingenium /srv/ingenium /srv/ingenium/releases
install -d -m 0750 -o root -g root "$library"
install -m 0755 -o root -g root "$source_directory/ssh-entrypoint.py" /usr/local/libexec/ingenium-deploy-ssh
install -m 0750 -o root -g root "$source_directory/apply_release.py" "$library/apply_release.py"
install -m 0640 -o root -g root "$source_directory/verify_release.py" "$library/verify_release.py"
ln -sfn "$library/apply_release.py" /usr/local/sbin/ingenium-apply-release

cat > "$work/sudoers" <<'SUDOERS'
Defaults:ingenium-deploy env_reset
Defaults:ingenium-deploy secure_path="/usr/sbin:/usr/bin:/sbin:/bin"
ingenium-deploy ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/ingenium-apply-release ^[a-f0-9]{40}$
SUDOERS
visudo -cf "$work/sudoers"
install -m 0440 -o root -g root "$work/sudoers" /etc/sudoers.d/ingenium-deploy
visudo -c
echo 'Dedicated restricted deployment SSH access installed; manual SSH access unchanged.'
