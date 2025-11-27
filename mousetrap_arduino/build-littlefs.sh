#!/bin/bash

# Build LittleFS filesystem image from trap-spa
# This creates a .bin file that can be uploaded via OTA

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPA_DIR="$SCRIPT_DIR/trap-spa"
DIST_DIR="$SPA_DIR/dist"
STAGING_DIR="$SCRIPT_DIR/build/staging"
OUTPUT_DIR="$SCRIPT_DIR/build"
OUTPUT_FILE="$OUTPUT_DIR/littlefs.bin"

# LittleFS partition size from partitions.csv (0xAE0000 = 11403264 bytes)
# Use 95% of partition size to leave room for wear leveling overhead
FS_SIZE=10833000
BLOCK_SIZE=4096
PAGE_SIZE=256

# Find mklittlefs tool
MKLITTLEFS=$(find ~/Library/Arduino15/packages/esp32/tools/mklittlefs -name "mklittlefs" -type f 2>/dev/null | sort -V | tail -1)

if [ -z "$MKLITTLEFS" ]; then
    echo "Error: mklittlefs tool not found"
    echo "Please install ESP32 Arduino core"
    exit 1
fi

echo "Using mklittlefs: $MKLITTLEFS"

# Build SPA if needed
echo "Building Svelte SPA..."
cd "$SPA_DIR"
npm run build

# Create staging directory with /app subdirectory
echo "Preparing staging directory..."
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/app"

# Copy dist files to staging/app/
cp -r "$DIST_DIR"/* "$STAGING_DIR/app/"

# Copy version.json to root of staging (firmware reads from /version.json)
cp "$DIST_DIR/version.json" "$STAGING_DIR/version.json"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Build LittleFS image from staging directory
echo "Creating LittleFS image..."
"$MKLITTLEFS" \
    -c "$STAGING_DIR" \
    -s $FS_SIZE \
    -b $BLOCK_SIZE \
    -p $PAGE_SIZE \
    "$OUTPUT_FILE"

# Get file size and SHA256
FILE_SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null)
SHA256=$(shasum -a 256 "$OUTPUT_FILE" | awk '{print $1}')

echo ""
echo "✓ LittleFS image created successfully!"
echo "  File: $OUTPUT_FILE"
echo "  Size: $FILE_SIZE bytes"
echo "  SHA256: $SHA256"
echo ""
echo "To upload via OTA:"
echo "  1. Go to Dashboard → Firmware"
echo "  2. Select 'filesystem' type"
echo "  3. Upload: $OUTPUT_FILE"
echo ""
