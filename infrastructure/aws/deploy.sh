#!/usr/bin/env bash
# deploy.sh — AWS Deployment Phase 2: build and deploy QuickNotes to EC2
# Run this script on the EC2 instance from the repo root after ec2-setup.sh.
# Usage: bash infrastructure/aws/deploy.sh
set -euo pipefail

APP_DIR="/home/ec2-user/app"
WEB_ROOT="/usr/share/nginx/html"
LOG_DIR="/home/ec2-user/logs"
BACKEND_DIR="${APP_DIR}/apps/backend"
FRONTEND_DIR="${APP_DIR}/apps/frontend"
INFRA_DIR="${APP_DIR}/infrastructure/aws"

# ─── Validate .env ────────────────────────────────────────────────────────────
if [[ ! -f "${BACKEND_DIR}/.env" ]]; then
  echo "ERROR: ${BACKEND_DIR}/.env not found."
  echo "  Copy .env.example and fill in your production values:"
  echo "  cp apps/backend/.env.example apps/backend/.env"
  exit 1
fi

# Export backend environment variables so PM2 inherits them.
set -a
source "${BACKEND_DIR}/.env"
set +a

export NODE_ENV="${NODE_ENV:-production}"

echo "==> [1/5] Pulling latest code..."
cd "$APP_DIR"
git pull --ff-only origin main

# ─── Backend ─────────────────────────────────────────────────────────────────
echo "==> [2/5] Installing backend dependencies..."
cd "$BACKEND_DIR"
npm ci --omit=dev

echo "==> [3/5] Starting/reloading backend with PM2..."
mkdir -p "$LOG_DIR"

# Install PM2 globally if not present
if ! command -v pm2 &>/dev/null; then
  echo "  PM2 not found — installing globally..."
  sudo npm install -g pm2
fi

cd "$APP_DIR"
if pm2 describe quicknotes-api &>/dev/null; then
  # Already running — reload with zero-downtime restart
  pm2 reload "${INFRA_DIR}/ecosystem.config.js" --env production --update-env
else
  pm2 start "${INFRA_DIR}/ecosystem.config.js" --env production --update-env
fi

# Save process list so PM2 survives reboots
pm2 save

# Register PM2 startup script on first deploy if the service is not present
if ! systemctl list-unit-files | grep -q '^pm2-ec2-user\.service'; then
  echo "==> Enabling PM2 startup service..."
  STARTUP_CMD="$(pm2 startup systemd -u ec2-user --hp /home/ec2-user 2>/dev/null | grep -E '^sudo ' | tail -n 1 || true)"
  if [[ -n "$STARTUP_CMD" ]]; then
    eval "$STARTUP_CMD"
  else
    echo "  WARNING: Could not auto-generate PM2 startup command."
  fi
fi
echo ""

# ─── Load DB schema (idempotent — CREATE TABLE IF NOT EXISTS) ─────────────────
echo "==> [4/5] Applying database schema (idempotent)..."
DB_HOST_VAL="${DB_HOST:-localhost}"
DB_USER_VAL="${DB_USER:-quicknotes}"
DB_PASS_VAL="${DB_PASSWORD:-}"
DB_NAME_VAL="${DB_NAME:-fullstack_db}"

if [[ -z "$DB_PASS_VAL" ]]; then
  echo "  WARNING: DB_PASSWORD is empty in .env — skipping schema load."
else
  mysql -h "$DB_HOST_VAL" -u "$DB_USER_VAL" -p"$DB_PASS_VAL" "$DB_NAME_VAL" \
    < "${APP_DIR}/database/mysql/schema.sql" && echo "  Schema applied." \
    || echo "  WARNING: schema apply failed — check DB credentials in .env."
fi

# ─── Frontend ─────────────────────────────────────────────────────────────────
echo "==> [5/5] Building frontend and deploying to ${WEB_ROOT}..."
cd "$FRONTEND_DIR"
npm ci
npm run build

# Clear old static files and copy the new build
sudo rm -rf "${WEB_ROOT:?}"/*
sudo cp -r dist/* "$WEB_ROOT/"
sudo chown -R nginx:nginx "$WEB_ROOT"
sudo chcon -R -t httpd_sys_content_t "$WEB_ROOT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deployment complete!"
echo ""
echo "  Backend : pm2 status"
echo "  Logs    : pm2 logs quicknotes-api"
echo "  App     : http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_EC2_IP')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
