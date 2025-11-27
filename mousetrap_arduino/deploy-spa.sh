#!/bin/bash
# deploy-spa.sh - Build Svelte app and upload LittleFS to ESP32 via OTA
# Usage: ./deploy-spa.sh [device-ip]
# Example: ./deploy-spa.sh 192.168.133.21

set -e  # Exit on error

# Configuration
DEVICE_IP="${1:-192.168.133.21}"  # Default to your device IP
AUTH_USER="ops"
AUTH_PASS="changeme"
SKETCH_DIR="$(cd "$(dirname "$0")" && pwd)"
SPA_DIR="$SKETCH_DIR/trap-spa"
DATA_DIR="$SKETCH_DIR/data"
APP_DIR="$DATA_DIR/app"
LITTLEFS_BIN="$SKETCH_DIR/littlefs.bin"
MKLFS="C:\Users\wadeiam\AppData\Local\Arduino15\packages\esp32\tools\mklittlefs\3.0.0-gnu12-dc7f933\mklittlefs.exe"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  MouseTrap SPA Deployment${NC}"
echo -e "${BLUE}  Target: $DEVICE_IP${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Build Svelte app
echo -e "${BLUE}[1/5]${NC} Building Svelte app..."
cd "$SPA_DIR"
export PATH="/c/Program Files/nodejs:$PATH"
npm run build
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Step 2: Copy to data/app
echo -e "${BLUE}[2/5]${NC} Copying files to data/app..."
rm -rf "$APP_DIR"/*
cp -r "$SPA_DIR/dist"/* "$APP_DIR/"
echo -e "${GREEN}✓ Files copied${NC}"
echo ""

# Step 3: Create LittleFS image
echo -e "${BLUE}[3/5]${NC} Creating LittleFS image..."
"$MKLFS" -c "$DATA_DIR" -p 256 -b 4096 -s 11403264 "$LITTLEFS_BIN"
if [ -f "$LITTLEFS_BIN" ]; then
  SIZE=$(ls -lh "$LITTLEFS_BIN" | awk '{print $5}')
  echo -e "${GREEN}✓ LittleFS image created: $SIZE${NC}"
else
  echo -e "${RED}✗ Failed to create LittleFS image${NC}"
  exit 1
fi
echo ""

# Step 4: Upload to device
echo -e "${BLUE}[4/5]${NC} Uploading to device at $DEVICE_IP..."
UPLOAD_URL="http://$DEVICE_IP/uploadfs"

# Use curl for upload with progress
curl -u "$AUTH_USER:$AUTH_PASS" \
     -F "file=@$LITTLEFS_BIN" \
     --progress-bar \
     "$UPLOAD_URL" \
     -o /tmp/uploadfs-response.txt

echo ""
echo -e "${GREEN}✓ Upload complete${NC}"
echo ""

# Step 5: Show response
echo -e "${BLUE}[5/5]${NC} Device response:"
cat /tmp/uploadfs-response.txt
echo ""
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}  Device will reboot automatically${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Wait ~10 seconds, then visit: http://$DEVICE_IP"
