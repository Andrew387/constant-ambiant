#!/bin/bash
# R2 Setup Script — configures rclone for Cloudflare R2
# Run this once: ./scripts/r2-setup.sh

set -e

# Check if rclone is installed
if ! command -v rclone &> /dev/null; then
    echo "rclone not found. Installing via Homebrew..."
    brew install rclone
fi

echo ""
echo "=== Cloudflare R2 Setup ==="
echo ""
echo "You'll need your R2 API credentials from:"
echo "  Cloudflare Dashboard → R2 → Manage R2 API Tokens"
echo ""

read -p "R2 Access Key ID: " ACCESS_KEY
read -s -p "R2 Secret Access Key: " SECRET_KEY
echo ""
read -p "Cloudflare Account ID (from dashboard URL): " ACCOUNT_ID

# Write rclone config
mkdir -p ~/.config/rclone

# Check if r2 remote already exists
if rclone listremotes | grep -q "^r2:$"; then
    echo ""
    echo "Warning: rclone remote 'r2' already exists. Overwriting..."
    rclone config delete r2
fi

rclone config create r2 s3 \
    provider="Cloudflare" \
    access_key_id="$ACCESS_KEY" \
    secret_access_key="$SECRET_KEY" \
    endpoint="https://${ACCOUNT_ID}.r2.cloudflarestorage.com" \
    acl="private" \
    no_check_bucket=true \
    --quiet

echo ""
echo "Testing connection..."
if rclone lsd r2:constant-ambiant-samples 2>/dev/null; then
    echo "Connected to R2 bucket 'constant-ambiant-samples' successfully!"
else
    echo "Bucket 'constant-ambiant-samples' not found. Creating it..."
    rclone mkdir r2:constant-ambiant-samples
    echo "Bucket created successfully!"
fi

echo ""
echo "Setup complete! You can now run:"
echo "  npm run samples:upload   — upload samples to R2"
echo "  npm run samples:fetch    — download samples from R2"
