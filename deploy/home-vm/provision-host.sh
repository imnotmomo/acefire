#!/usr/bin/env bash
set -euo pipefail
umask 027
[[ $(id -u) == 0 ]] || { echo 'Run as root through sudo.'; exit 1; }
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates curl git rsync python3-venv python3-pip \
  libreoffice-writer libreoffice-impress fonts-liberation fonts-noto-cjk \
  tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim tesseract-ocr-chi-tra
if ! id ingenium >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /srv/ingenium --shell /usr/sbin/nologin ingenium
fi
install -d -m 0750 -o ingenium -g ingenium /srv/ingenium /srv/ingenium/releases
install -d -m 0755 -o root -g root /var/www/ingenium /var/www/ingenium/releases
install -d -m 0750 -o root -g ingenium /etc/ingenium
install -d -m 0700 -o ingenium -g ingenium /var/lib/ingenium /var/lib/ingenium/uploads
install -d -m 0750 -o root -g ingenium /var/lib/ingenium/sources
install -d -m 0700 -o root -g root /root/ingenium-home-deploy-backups /var/cache/ingenium

# Pin the same supported build runtime used by the previous host.
node_version=24.22.1
node_archive="node-v${node_version}-linux-x64.tar.xz"
node_root="/opt/node-v${node_version}-linux-x64"
if [[ ! -x "$node_root/bin/node" ]]; then
  curl --fail --location --retry 3 "https://nodejs.org/dist/v${node_version}/$node_archive" -o "/var/cache/ingenium/$node_archive"
  curl --fail --location --retry 3 "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o /var/cache/ingenium/node-SHASUMS256.txt
  (
    cd /var/cache/ingenium
    awk -v filename="$node_archive" '$2 == filename {print}' node-SHASUMS256.txt > node-selected.sha256
    [[ -s node-selected.sha256 ]]
    sha256sum --check node-selected.sha256
    tar -xJf "$node_archive" -C /opt
  )
fi
ln -sfn "$node_root/bin/node" /usr/local/bin/node
ln -sfn "$node_root/bin/npm" /usr/local/bin/npm
ln -sfn "$node_root/bin/npx" /usr/local/bin/npx
node --version
python3 --version
tesseract --version 2>&1 | head -1
soffice --version
echo 'Host dependencies prepared; existing tunnel, routing, and website remain unchanged.'
