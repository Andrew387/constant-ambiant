#!/bin/bash
# Remove samples from Git LFS tracking
# WARNING: Run this ONLY after you've uploaded samples to R2!
#
# What this does:
# 1. Removes the .gitattributes LFS rule for *.wav
# 2. Removes samples from git tracking (keeps local files)
#
# After running this, samples/ stays on your disk but git ignores it.

set -e

echo "=== Remove Samples from Git LFS ==="
echo ""
echo "IMPORTANT: Make sure you've already uploaded samples to R2!"
echo "  Run: npm run samples:upload"
echo ""
read -p "Have you uploaded samples to R2? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting. Upload samples first with: npm run samples:upload"
    exit 1
fi

echo ""
echo "Step 1: Removing LFS tracking for *.wav..."
git lfs untrack "*.wav"

echo ""
echo "Step 2: Removing samples from git index (keeping local files)..."
git rm --cached -r samples/ 2>/dev/null || echo "  samples/ not in git index (already ignored)"
git rm --cached -r samples_backup/ 2>/dev/null || echo "  samples_backup/ not in git index (already ignored)"

echo ""
echo "Step 3: Verifying .gitignore has samples/..."
if grep -q "^samples/" .gitignore; then
    echo "  .gitignore already includes samples/ ✓"
else
    echo "  Adding samples/ to .gitignore..."
    echo "samples/" >> .gitignore
fi

echo ""
echo "Done! Now commit these changes:"
echo "  git add .gitignore .gitattributes"
echo "  git commit -m 'Move samples to R2, remove from Git LFS'"
echo ""
echo "Your samples are still in samples/ locally — git just won't track them anymore."
