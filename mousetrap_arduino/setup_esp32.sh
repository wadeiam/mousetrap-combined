#!/bin/bash
# ESP32-S3 Setup Script for Mac M1
# Sets up arduino-cli with custom partition scheme matching Windows configuration

set -e

echo "🔧 ESP32-S3 Setup for Mac M1"
echo "=============================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if arduino-cli is installed
if ! command -v arduino-cli &> /dev/null; then
    echo -e "${RED}❌ arduino-cli not found${NC}"
    echo "Installing arduino-cli via Homebrew..."
    brew install arduino-cli
    echo -e "${GREEN}✅ arduino-cli installed${NC}"
else
    echo -e "${GREEN}✅ arduino-cli found: $(which arduino-cli)${NC}"
fi

# Check ESP32 core
echo ""
echo "Checking ESP32 core..."
if arduino-cli core list | grep -q "esp32:esp32"; then
    VERSION=$(arduino-cli core list | grep "esp32:esp32" | awk '{print $2}')
    echo -e "${GREEN}✅ ESP32 core installed (version $VERSION)${NC}"
else
    echo -e "${YELLOW}⚠️  ESP32 core not found. Installing...${NC}"
    arduino-cli core update-index
    arduino-cli core install esp32:esp32
    echo -e "${GREEN}✅ ESP32 core installed${NC}"
fi

# Find ESP32 partition directory
echo ""
echo "Installing custom partition scheme..."
ESP32_DIR=$(arduino-cli config dump | grep "user" | cut -d: -f2 | tr -d ' ' | sed 's/\/arduino-cli.yaml//')/packages/esp32/hardware/esp32/*/tools/partitions

if [ -z "$ESP32_DIR" ]; then
    # Fallback to standard location
    ESP32_DIR="$HOME/Library/Arduino15/packages/esp32/hardware/esp32/*/tools/partitions"
fi

# Expand wildcard
ESP32_DIR=$(echo $ESP32_DIR)

if [ ! -d "$ESP32_DIR" ]; then
    echo -e "${RED}❌ Could not find ESP32 partition directory${NC}"
    echo "Expected location: $ESP32_DIR"
    exit 1
fi

echo "Found partition directory: $ESP32_DIR"

# Copy custom partition file
if [ -f "partitions.csv" ]; then
    cp partitions.csv "$ESP32_DIR/custom_16mb_ota.csv"
    echo -e "${GREEN}✅ Custom partition scheme installed: custom_16mb_ota.csv${NC}"
    echo ""
    echo "Partition layout:"
    cat partitions.csv | grep -v "^#"
else
    echo -e "${RED}❌ partitions.csv not found in current directory${NC}"
    echo "Please copy your partitions.csv file to this directory and run again."
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 Setup complete!${NC}"
echo ""
echo "Board configuration:"
echo "  - Board: ESP32S3 Dev Module"
echo "  - Flash: 16MB"
echo "  - PSRAM: OPI (8MB)"
echo "  - Partition: Custom (OTA + LittleFS)"
echo "  - CPU: 240MHz WiFi"
echo "  - Upload: 921600 baud"
echo ""
echo "Next steps:"
echo "  1. Connect your ESP32-S3 board"
echo "  2. Run: make compile (to test compilation)"
echo "  3. Run: make upload (to upload to board)"
echo "  4. Or run: make build (compile + upload)"
echo ""
