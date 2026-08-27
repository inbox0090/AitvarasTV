#!/usr/bin/env bash
# AitvarasTV — Ubuntu Server installer
# Installs the static Astro build behind the Node admin server and Nginx.
# Usage: sudo bash deploy/install-ubuntu.sh [domain-or-_]
set -Eeuo pipefail

APP_NAME="extreme-infinitv"
APP_ROOT="/opt/${APP_NAME}"
DATA_ROOT="/var/lib/${APP_NAME}"
ENV_DIR="/etc/${APP_NAME}"
ENV_FILE="${ENV_DIR}/admin.env"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DOMAIN="${1:-_}"
PORT="${PORT:-4321}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash deploy/install-ubuntu.sh [domain-or-_]" >&2
  exit 1
fi
if [[ ! "${DOMAIN}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid domain. Use a hostname such as tv.example.com or _." >&2
  exit 1
fi
if [[ ! -d "${SOURCE_DIR}/dist" ]] || [[ ! -f "${SOURCE_DIR}/dist/index.html" ]]; then
  echo "No production build found in dist/. Run pnpm install --frozen-lockfile && pnpm run build first." >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
echo "[1/7] Installing required server packages…"
apt-get update -qq
apt-get install -y -qq ca-certificates curl nginx
if ! command -v node >/dev/null 2>&1 || (( $(node -p 'Number(process.versions.node.split(".")[0])') < 22 )); then
  echo "Installing Node.js 22 for the native SQLite admin server…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22+ installation failed. Detected Node.js ${NODE_MAJOR}." >&2
  exit 1
fi

echo "[2/7] Copying release to ${APP_ROOT}…"
rm -rf "${APP_ROOT}"
install -d -m 0755 "${APP_ROOT}"
cp -a "${SOURCE_DIR}/." "${APP_ROOT}/"
rm -rf "${APP_ROOT}/node_modules" "${APP_ROOT}/.git"
install -d -m 0750 -o www-data -g www-data "${DATA_ROOT}"
install -d -m 0750 -o root -g www-data "${ENV_DIR}"
chown -R root:root "${APP_ROOT}"
find "${APP_ROOT}" -type d -exec chmod 0755 {} \;
find "${APP_ROOT}" -type f -exec chmod 0644 {} \;
chmod 0755 "${APP_ROOT}/server/index.mjs"

if [[ ! -f "${ENV_FILE}" ]]; then
  APP_ORIGIN="http://${DOMAIN}"
  [[ "${DOMAIN}" == "_" ]] && APP_ORIGIN="http://127.0.0.1:${PORT}"
  cat > "${ENV_FILE}" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=${PORT}
APP_ORIGIN=${APP_ORIGIN}
ADMIN_USERNAME=admin
ADMIN_EMAIL=
ADMIN_INITIAL_PASSWORD=admin
ADMIN_DB_PATH=${DATA_ROOT}/admin.sqlite
# Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM and SMTP_HELO here.
# Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET here to enable live/test checkout.
EOF
  chmod 0640 "${ENV_FILE}"
  chown root:www-data "${ENV_FILE}"
  echo "Created ${ENV_FILE}. Add ADMIN_EMAIL, SMTP values and optional Stripe keys, then restart the service."
fi

echo "[3/7] Writing the systemd service…"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=AitvarasTV frontend and admin dashboard
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${APP_ROOT}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_ROOT}/server/index.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${DATA_ROOT}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${APP_NAME}.service"
systemctl restart "${APP_NAME}.service"

echo "[4/7] Writing Nginx reverse proxy…"
cat > "${NGINX_SITE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
EOF
ln -sfn "${NGINX_SITE}" "${NGINX_ENABLED}"
rm -f /etc/nginx/sites-enabled/default

echo "[5/7] Validating and restarting Nginx…"
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "[6/7] Checking the local service…"
for attempt in {1..20}; do
  if curl -fsS "http://127.0.0.1:${PORT}/admin/login" >/dev/null; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${PORT}/admin/login" >/dev/null

echo "[7/7] Done."
echo
printf 'AitvarasTV: http://%s/\n' "${DOMAIN}"
printf 'Admin login:      http://%s/admin/login\n' "${DOMAIN}"
printf 'Release files:    %s\n' "${APP_ROOT}"
printf 'Admin database:   %s/admin.sqlite\n' "${DATA_ROOT}"
echo
cat <<EOF
Default bootstrap login is admin / admin only on the first database creation.
Change it immediately at /admin/security. Edit ${ENV_FILE} and restart the service
after adding ADMIN_EMAIL and SMTP_* values for Forgot password emails:
  sudo nano ${ENV_FILE}
  sudo systemctl restart ${APP_NAME}
EOF
if [[ "${DOMAIN}" != "_" ]]; then
  echo
  echo "For HTTPS after DNS points to this server:"
  echo "  sudo apt-get install -y certbot python3-certbot-nginx"
  echo "  sudo certbot --nginx -d ${DOMAIN}"
fi
