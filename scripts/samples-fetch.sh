#!/bin/bash
# Download samples from R2 to local samples/ directory
# Usage: npm run samples:fetch
#   or:  ./scripts/samples-fetch.sh [subfolder]
#
# Examples:
#   npm run samples:fetch                    — fetch everything
#   ./scripts/samples-fetch.sh Lead/Loopable — fetch only Lead/Loopable

set -e

BUCKET="r2:constant-ambiant-samples"
LOCAL_DIR="samples"

# Check rclone is configured
if ! rclone listremotes | grep -q "^r2:$"; then
    echo "Error: rclone remote 'r2' not configured. Run: ./scripts/r2-setup.sh"
    exit 1
fi

SUBFOLDER="${1:-}"
if [ -n "$SUBFOLDER" ]; then
    SOURCE="$BUCKET/$SUBFOLDER"
    DEST="$LOCAL_DIR/$SUBFOLDER"
    echo "Fetching $SOURCE → $DEST"
else
    SOURCE="$BUCKET"
    DEST="$LOCAL_DIR"
    echo "Fetching all samples → $DEST"
fi

mkdir -p "$DEST"

rclone sync "$SOURCE" "$DEST" \
    --progress \
    --transfers 8 \
    --checkers 16 \
    --fast-list

echo ""
echo "Fetch complete!"
du -sh "$LOCAL_DIR"
