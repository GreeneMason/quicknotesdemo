#!/usr/bin/env bash
# ec2-setup.sh — Full runtime setup for QuickNotes on Amazon Linux 2023 / RHEL
# Run this script once after SSH-ing into the EC2 instance.
# Usage: bash ec2-setup.sh
set -euo pipefail

# ─── Configuration (edit before running) ────────────────────────────────────
DB_NAME="${DB_NAME:-fullstack_db}"
DB_USER="${DB_USER:-quicknotes}"
DB_PASSWORD="${DB_PASSWORD:-}"          # Required: set a strong password
APP_PORT="${APP_PORT:-5000}"
REPO_URL="${REPO_URL:-}"               # Optional: git clone URL for the repo
WEB_ROOT="/usr/share/nginx/html"
NGINX_CONF_DIR="/etc/nginx/conf.d"
# ────────────────────────────────────────────────────────────────────────────

if [[ -z "$DB_PASSWORD" ]]; then
  echo "ERROR: Set DB_PASSWORD before running this script."
  echo "  export DB_PASSWORD=your_strong_password"
  exit 1
fi

echo "==> [1/7] Updating system packages..."
sudo dnf -y update

echo "==> [2/7] Installing git, nginx, mariadb-server..."
sudo dnf -y install git nginx mariadb-server

echo "==> [3/7] Installing Node.js 20 via NodeSource..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf -y install nodejs

echo "==> [4/7] Enabling and starting services..."
sudo systemctl enable --now mariadb
sudo systemctl enable --now nginx

echo "==> [5/7] Configuring MariaDB (creating DB + app user)..."
# Wait for MariaDB to be ready
for i in {1..10}; do
  sudo mysqladmin ping --silent && break || sleep 2
done

sudo mysql -e "
  CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
  GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
  FLUSH PRIVILEGES;
"
echo "  Database '${DB_NAME}' and user '${DB_USER}' created."

echo "==> [6/7] Configuring nginx..."
# Remove default welcome page to avoid conflicts
sudo rm -f "${NGINX_CONF_DIR}/welcome.conf"

# Copy the app nginx config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo cp "${SCRIPT_DIR}/nginx.conf" "${NGINX_CONF_DIR}/quicknotes.conf"

# Fix SELinux: allow nginx to proxy to the backend
sudo setsebool -P httpd_can_network_connect 1

# Fix SELinux context for web root
sudo chcon -R -t httpd_sys_content_t "${WEB_ROOT}"

sudo nginx -t && sudo systemctl reload nginx
echo "  nginx configured and reloaded."

echo "==> [7/7] Setting up web root permissions..."
sudo chown -R nginx:nginx "${WEB_ROOT}"
sudo chmod -R 755 "${WEB_ROOT}"

# Optional: clone repo if REPO_URL was provided
if [[ -n "$REPO_URL" ]]; then
  echo "==> Cloning repository..."
  git clone "$REPO_URL" /home/ec2-user/app
  echo "  Repository cloned to /home/ec2-user/app"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  EC2 runtime setup complete!"
echo ""
echo "  Next steps (AWS Deployment Phase 2):"
echo "  1) Load the database schema:"
echo "     sudo mysql ${DB_NAME} < /home/ec2-user/app/database/mysql/schema.sql"
echo ""
echo "  2) Create /home/ec2-user/app/apps/backend/.env with:"
echo "     DB_HOST=localhost"
echo "     DB_USER=${DB_USER}"
echo "     DB_PASSWORD=<your password>"
echo "     DB_NAME=${DB_NAME}"
echo "     JWT_SECRET=<generate with: openssl rand -hex 32>"
echo "     PORT=${APP_PORT}"
echo "     NODE_ENV=production"
echo "     FRONTEND_ORIGIN=http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_EC2_IP')"
echo ""
echo "  3) Install backend deps and start with PM2 (see Phase 2 script)"
echo "  4) Build frontend and deploy to ${WEB_ROOT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
