#!/bin/bash
# Upload local samples to R2 (additive — never deletes remote files)
# Usage: npm run samples:upload
#   or:  ./scripts/samples-upload.sh [subfolder]
#
# Examples:
#   npm run samples:upload                    — upload everything
#   ./scripts/samples-upload.sh Lead/Loopable — upload only Lead/Loopable
#
# SAFETY: Uses 'rclone copy' (not sync) so remote files are NEVER deleted.
# To delete remote files, use the Cloudflare dashboard or rclone manually.

set -e

BUCKET="r2:constant-ambiant-samples"
LOCAL_DIR="samples"

if [ ! -d "$LOCAL_DIR" ]; then
    echo "Error: samples/ directory not found. Run from project root."
    exit 1
fi

# Check rclone is configured
if ! rclone listremotes | grep -q "^r2:$"; then
    echo "Error: rclone remote 'r2' not configured. Run: ./scripts/r2-setup.sh"
    exit 1
fi

SUBFOLDER="${1:-}"
if [ -n "$SUBFOLDER" ]; then
    SOURCE="$LOCAL_DIR/$SUBFOLDER"
    DEST="$BUCKET/$SUBFOLDER"
    echo "Uploading $SOURCE → $DEST"
else
    SOURCE="$LOCAL_DIR"
    DEST="$BUCKET"
    echo "Uploading all samples → $DEST"
fi

# Sanity check: reject LFS pointer files (they're ~130 bytes text, not real audio)
POINTER_COUNT=$(find "$SOURCE" -name "*.wav" -size -1k -exec grep -l "oid sha256:" {} \; 2>/dev/null | wc -l | tr -d ' ')
if [ "$POINTER_COUNT" -gt 0 ]; then
    echo ""
    echo "ERROR: Found $POINTER_COUNT Git LFS pointer files instead of real WAV audio."
    echo "Run 'git lfs pull' first to fetch the actual sample data."
    exit 1
fi

rclone copy "$SOURCE" "$DEST" \
    --progress \
    --transfers 8 \
    --checkers 16 \
    --fast-list \
    --include "*.wav"

echo ""
echo "Upload complete!"
rclone size "$BUCKET"
