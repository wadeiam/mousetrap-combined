#!/bin/bash

# MouseTrap Monitor - Icon Generation from PNG
# This script generates all required sizes from a master 1024x1024 PNG
# Use this if you've manually created icon-temp.png from the SVG

set -e

ASSETS_DIR="/Users/wadehargrove/Documents/MouseTrap/mobile-app/assets"
cd "$ASSETS_DIR"

echo "=== Generating icons from PNG sources ==="
echo ""

# Check for source files
if [ ! -f "icon-temp.png" ]; then
    echo "Error: icon-temp.png not found!"
    echo "Please create a 1024x1024 PNG version of icon-source.svg"
    echo "You can:"
    echo "  1. Open icon-source.svg in your browser"
    echo "  2. Take a screenshot or use browser dev tools"
    echo "  3. Or use online tool: https://svgtopng.com/"
    exit 1
fi

echo "Generating app icons..."

# Main app icon
sips -z 1024 1024 icon-temp.png --out icon.png >/dev/null
echo "  ✓ icon.png (1024x1024)"

# Adaptive icon
sips -z 1024 1024 icon-temp.png --out adaptive-icon.png >/dev/null
echo "  ✓ adaptive-icon.png (1024x1024)"

# Splash icon
sips -z 1024 1024 icon-temp.png --out splash-icon.png >/dev/null
echo "  ✓ splash-icon.png (1024x1024)"

# Favicon
sips -z 48 48 icon-temp.png --out favicon.png >/dev/null
echo "  ✓ favicon.png (48x48)"

# Notification icon (if source exists)
if [ -f "notification-temp.png" ]; then
    echo "Generating notification icon..."
    sips -z 96 96 notification-temp.png --out notification-icon.png >/dev/null
    echo "  ✓ notification-icon.png (96x96)"
else
    echo "WARNING: notification-temp.png not found"
    echo "Create a 1024x1024 PNG from notification-icon-source.svg"
fi

echo ""
echo "=== Complete! ==="
echo ""
