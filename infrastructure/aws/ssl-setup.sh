#!/usr/bin/env bash
# ssl-setup.sh — AWS Deployment Phase 3: HTTPS with Let's Encrypt
# Run this on the EC2 instance after the app is already live on nginx.
# Usage:
#   sudo bash infrastructure/aws/ssl-setup.sh example.com admin@example.com
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
NGINX_CONF="/etc/nginx/conf.d/quicknotes.conf"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: sudo bash infrastructure/aws/ssl-setup.sh <domain> <email>"
  exit 1
fi

if [[ ! -f "$NGINX_CONF" ]]; then
  echo "ERROR: $NGINX_CONF not found. Deploy nginx config first."
  exit 1
fi

echo "==> Installing certbot..."
sudo dnf -y install certbot python3-certbot-nginx

echo "==> Testing nginx config..."
sudo nginx -t

echo "==> Requesting certificate for $DOMAIN..."
sudo certbot --nginx \
  -d "$DOMAIN" \
  -m "$EMAIL" \
  --agree-tos \
  --non-interactive \
  --redirect

echo "==> Ensuring auto-renewal is enabled..."
sudo systemctl enable --now certbot-renew.timer 2>/dev/null || true
sudo systemctl enable --now certbot.timer 2>/dev/null || true

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HTTPS setup complete.

  Next steps:
  1) Verify the site at https://$DOMAIN
  2) Check renewal:
     sudo certbot renew --dry-run
  3) Keep ports 80 and 443 open in the AWS security group
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
