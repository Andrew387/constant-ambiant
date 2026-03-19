#!/bin/bash
# Upload/sync local samples to R2
# Usage: npm run samples:upload
#   or:  ./scripts/samples-upload.sh [subfolder]
#
# Examples:
#   npm run samples:upload                    — sync everything
#   ./scripts/samples-upload.sh Lead/Loopable — sync only Lead/Loopable

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

rclone sync "$SOURCE" "$DEST" \
    --progress \
    --transfers 8 \
    --checkers 16 \
    --fast-list \
    --include "*.wav"

echo ""
echo "Upload complete!"
rclone size "$BUCKET"
