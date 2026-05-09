#!/usr/bin/env bash
# backup.sh — AWS Deployment Phase 3: MySQL backup + retention
# Run from cron or a systemd timer on the EC2 instance.
# Usage: sudo bash infrastructure/aws/backup.sh
set -euo pipefail

APP_DIR="/home/ec2-user/app"
BACKUP_DIR="/home/ec2-user/backups"
SOURCE_ENV="${APP_DIR}/apps/backend/.env"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"

if [[ ! -f "$SOURCE_ENV" ]]; then
  echo "ERROR: Missing backend .env at $SOURCE_ENV"
  exit 1
fi

# Load DB credentials from .env
set +u
source "$SOURCE_ENV"
set -u

DB_HOST_VAL="${DB_HOST:-localhost}"
DB_USER_VAL="${DB_USER:-quicknotes}"
DB_PASS_VAL="${DB_PASSWORD:-}"
DB_NAME_VAL="${DB_NAME:-fullstack_db}"

if [[ -z "$DB_PASS_VAL" ]]; then
  echo "ERROR: DB_PASSWORD is empty; aborting backup."
  exit 1
fi

mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME_VAL}_${TIMESTAMP}.sql.gz"

echo "==> Creating backup: $BACKUP_FILE"
mysqldump \
  -h "$DB_HOST_VAL" \
  -u "$DB_USER_VAL" \
  -p"$DB_PASS_VAL" \
  --single-transaction \
  --routines \
  --triggers \
  "$DB_NAME_VAL" | gzip > "$BACKUP_FILE"

# Retention: keep the last 7 daily backups and delete older ones
find "$BACKUP_DIR" -type f -name "${DB_NAME_VAL}_*.sql.gz" -mtime +7 -delete

cat <<EOF
Backup complete: $BACKUP_FILE
Retention policy: backups older than 7 days removed.
EOF
