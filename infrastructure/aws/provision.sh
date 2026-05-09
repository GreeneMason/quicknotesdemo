#!/usr/bin/env bash
# provision.sh — Create an EC2 instance + security group for QuickNotes
# Requires: AWS CLI v2 configured (aws configure)
# Usage: bash provision.sh
set -euo pipefail

# ─── Configuration (edit before running) ────────────────────────────────────
APP_NAME="quicknotes"
INSTANCE_TYPE="t3.micro"           # Free-tier eligible: t2.micro or t3.micro
AWS_REGION="${AWS_REGION:-us-east-1}"
KEY_PAIR_NAME="${KEY_PAIR_NAME:-}"  # Required: name of your existing EC2 key pair
# Amazon Linux 2023 x86_64 (us-east-1 — update AMI ID for your region at
# https://aws.amazon.com/amazon-linux-ami/ or use the SSM lookup below)
AMI_ID="${AMI_ID:-}"
# ────────────────────────────────────────────────────────────────────────────

if [[ -z "$KEY_PAIR_NAME" ]]; then
  echo "ERROR: Set KEY_PAIR_NAME before running this script."
  echo "  export KEY_PAIR_NAME=my-key-pair"
  exit 1
fi

# Resolve latest Amazon Linux 2023 AMI if not supplied
if [[ -z "$AMI_ID" ]]; then
  echo "Resolving latest Amazon Linux 2023 AMI for $AWS_REGION..."
  AMI_ID=$(aws ssm get-parameter \
    --region "$AWS_REGION" \
    --name "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64" \
    --query "Parameter.Value" \
    --output text)
  echo "  AMI: $AMI_ID"
fi

# ─── Security Group ──────────────────────────────────────────────────────────
echo "Creating security group: $APP_NAME-sg"
SG_ID=$(aws ec2 create-security-group \
  --region "$AWS_REGION" \
  --group-name "${APP_NAME}-sg" \
  --description "QuickNotes: HTTP(S) + SSH" \
  --query "GroupId" \
  --output text)
echo "  Security Group ID: $SG_ID"

# SSH (port 22) — restrict to your IP in production
aws ec2 authorize-security-group-ingress \
  --region "$AWS_REGION" \
  --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr 0.0.0.0/0

# HTTP (port 80)
aws ec2 authorize-security-group-ingress \
  --region "$AWS_REGION" \
  --group-id "$SG_ID" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0

# HTTPS (port 443)
aws ec2 authorize-security-group-ingress \
  --region "$AWS_REGION" \
  --group-id "$SG_ID" \
  --protocol tcp --port 443 --cidr 0.0.0.0/0

echo "  Inbound rules: 22, 80, 443 open"

# ─── EC2 Instance ────────────────────────────────────────────────────────────
echo "Launching EC2 instance..."
INSTANCE_ID=$(aws ec2 run-instances \
  --region "$AWS_REGION" \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_PAIR_NAME" \
  --security-group-ids "$SG_ID" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${APP_NAME}}]" \
  --query "Instances[0].InstanceId" \
  --output text)
echo "  Instance ID: $INSTANCE_ID"

echo "Waiting for instance to reach running state..."
aws ec2 wait instance-running \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID"

PUBLIC_IP=$(aws ec2 describe-instances \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  EC2 instance is running!"
echo "  Public IP : $PUBLIC_IP"
echo "  Instance  : $INSTANCE_ID"
echo "  Region    : $AWS_REGION"
echo ""
echo "  Next: SSH into the instance and run ec2-setup.sh"
echo "  ssh -i ~/.ssh/${KEY_PAIR_NAME}.pem ec2-user@${PUBLIC_IP}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
