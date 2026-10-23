#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 EC2 server. Run it from a copy of this deploy/ folder:
#
#   scp -r deploy ubuntu@<server>:/tmp/deploy
#   ssh ubuntu@<server> 'sudo bash /tmp/deploy/bootstrap-ec2.sh'
#
# Safe to run again: it never overwrites an existing .env or a swap file.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run this with sudo." >&2; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
APP_DIR=/opt/interviewcall-tests
APP_USER="${SUDO_USER:-ubuntu}"

echo "==> Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck source=/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
usermod -aG docker "$APP_USER"

echo "==> Swap (a safety net against the kernel killing a container when memory spikes)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> $APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR" "$APP_DIR/mariadb" "$APP_DIR/mariadb/conf.d" "$APP_DIR/backups"
install -o "$APP_USER" -g "$APP_USER" -m 0644 "$SRC/docker-compose.yml" "$APP_DIR/docker-compose.yml"
install -o "$APP_USER" -g "$APP_USER" -m 0644 "$SRC/Caddyfile" "$APP_DIR/Caddyfile"
install -o "$APP_USER" -g "$APP_USER" -m 0644 "$SRC/mariadb/conf.d/tuning.cnf" "$APP_DIR/mariadb/conf.d/tuning.cnf"
install -o "$APP_USER" -g "$APP_USER" -m 0755 "$SRC/deploy.sh" "$APP_DIR/deploy.sh"
install -o "$APP_USER" -g "$APP_USER" -m 0755 "$SRC/backup.sh" "$APP_DIR/backup.sh"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> Creating .env with fresh secrets"
  install -o "$APP_USER" -g "$APP_USER" -m 0600 "$SRC/production.env.example" "$APP_DIR/.env"
  # Each __generated__ placeholder gets its own value. Hex only, because the database ones also go into a URL.
  python3 - "$APP_DIR/.env" <<'PY'
import base64, os, re, secrets, sys
path = sys.argv[1]
text = open(path).read()
def fill(name, value):
    global text
    text = re.sub(rf'^{name}=__generated__$', f'{name}={value}', text, flags=re.M)
for name in ('DB_ROOT_PASSWORD', 'DB_PASSWORD', 'REDIS_PASSWORD'):
    fill(name, secrets.token_hex(24))
fill('NOTIFICATIONS_PAYLOAD_KEY', base64.b64encode(os.urandom(32)).decode())
open(path, 'w').write(text)
PY
else
  echo "==> .env already exists; left alone"
fi

echo "==> Nightly database backup (02:00 IST, kept 14 days in $APP_DIR/backups)"
cat > /etc/cron.d/interviewcall-backup <<CRON
30 20 * * * $APP_USER /bin/bash $APP_DIR/backup.sh >> $APP_DIR/backups/backup.log 2>&1
CRON
chmod 0644 /etc/cron.d/interviewcall-backup

echo
echo "Done. Next:"
echo "  1. Edit $APP_DIR/.env: ACME_EMAIL, AISENSY_API_KEY, and the SES credentials if the server has no IAM role."
echo "  2. Point the DNS A record for API_DOMAIN at this server, and open ports 80 and 443 (and 22 for deploys)."
echo "  3. Add the GitHub secrets from docs/deployment.md, then push to main."
echo "  Log out and back in once so the docker group applies to $APP_USER."
