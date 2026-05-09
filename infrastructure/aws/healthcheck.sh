#!/usr/bin/env bash
# healthcheck.sh — AWS Deployment Phase 4: launch readiness checks
# Run on the EC2 instance after deployment to verify nginx, backend, and DB connectivity.
# Usage: bash infrastructure/aws/healthcheck.sh
set -euo pipefail

APP_DIR="/home/ec2-user/app"
BACKEND_ENV="${APP_DIR}/apps/backend/.env"
WEB_URL="${WEB_URL:-http://127.0.0.1}"
API_BASE="${API_BASE:-http://127.0.0.1/api}"

ok() { echo "[OK] $1"; }
warn() { echo "[WARN] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }

# nginx
if systemctl is-active --quiet nginx; then
  ok "nginx is running"
else
  fail "nginx is not running"
fi

# PM2 app
if command -v pm2 >/dev/null 2>&1 && pm2 describe quicknotes-api >/dev/null 2>&1; then
  ok "PM2 process quicknotes-api exists"
else
  fail "PM2 process quicknotes-api is missing"
fi

# HTTP root
if curl -fsS "$WEB_URL" >/dev/null; then
  ok "Frontend root responds"
else
  fail "Frontend root is not responding"
fi

# API session endpoint (expected to return 401 if not logged in, but should be reachable)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/auth/me" || true)
if [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "200" ]]; then
  ok "API reachable at /api/auth/me (HTTP $HTTP_CODE)"
else
  fail "Unexpected API response from /api/auth/me: HTTP $HTTP_CODE"
fi

# DB ping using backend .env if present
if [[ -f "$BACKEND_ENV" ]]; then
  set +u
  source "$BACKEND_ENV"
  set -u

  if [[ -n "${DB_PASSWORD:-}" ]]; then
    if mysqladmin -h "${DB_HOST:-localhost}" -u "${DB_USER:-quicknotes}" -p"${DB_PASSWORD}" ping --silent >/dev/null 2>&1; then
      ok "MySQL responds to ping"
    else
      warn "MySQL ping failed (check credentials or service status)"
    fi
  else
    warn "DB_PASSWORD missing in .env; skipping MySQL ping"
  fi
else
  warn "Backend .env not found; skipping DB ping"
fi

# Disk usage warning
DISK_USE=$(df -P / | awk 'NR==2 {gsub("%", "", $5); print $5}')
if [[ "$DISK_USE" -ge 85 ]]; then
  warn "Root filesystem is ${DISK_USE}% full"
else
  ok "Disk usage is ${DISK_USE}%"
fi

# Memory usage warning
MEM_TOTAL=$(free | awk '/Mem:/ {print $2}')
MEM_USED=$(free | awk '/Mem:/ {print $3}')
MEM_PCT=$(( 100 * MEM_USED / MEM_TOTAL ))
if [[ "$MEM_PCT" -ge 85 ]]; then
  warn "Memory usage is ${MEM_PCT}%"
else
  ok "Memory usage is ${MEM_PCT}%"
fi

echo ""
echo "Launch readiness checks finished."
