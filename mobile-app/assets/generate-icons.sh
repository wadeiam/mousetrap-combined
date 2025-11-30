#!/bin/bash

# MouseTrap Monitor - Icon Generation Script
# This script generates all required app icons from SVG sources
# Uses macOS qlmanage for SVG to PNG conversion, then sips for resizing

set -e  # Exit on error

ASSETS_DIR="/Users/wadehargrove/Documents/MouseTrap/mobile-app/assets"
cd "$ASSETS_DIR"

echo "=== MouseTrap Monitor Icon Generation ==="
echo ""

# Check if SVG source files exist
if [ ! -f "icon-source.svg" ]; then
    echo "Error: icon-source.svg not found!"
    exit 1
fi

if [ ! -f "notification-icon-source.svg" ]; then
    echo "Error: notification-icon-source.svg not found!"
    exit 1
fi

echo "Step 1: Converting SVG to PNG using qlmanage..."

# Method 1: Try using qlmanage (macOS built-in)
# Note: qlmanage can be tricky, so we'll also provide manual instructions

# Convert main icon SVG to PNG (qlmanage creates thumbnail in a cache dir)
echo "Converting icon-source.svg..."
qlmanage -t -s 1024 -o /tmp icon-source.svg 2>/dev/null || {
    echo "WARNING: qlmanage conversion may have failed"
    echo "You may need to manually convert SVG to PNG using:"
    echo "  1. Open icon-source.svg in Preview or Safari"
    echo "  2. Export as PNG at 1024x1024"
    echo "  3. Save as icon-temp.png"
}

# Try to find and move the generated file
if [ -f "/tmp/icon-source.svg.png" ]; then
    mv /tmp/icon-source.svg.png ./icon-temp.png
    echo "  ✓ Created icon-temp.png"
elif [ -f "/tmp/icon-source.png" ]; then
    mv /tmp/icon-source.png ./icon-temp.png
    echo "  ✓ Created icon-temp.png"
else
    echo "  ! Manual conversion needed - see instructions above"
    echo ""
    echo "After manual conversion, run this script again or use:"
    echo "  ./generate-icons-from-png.sh"
    exit 1
fi

# Convert notification icon
echo "Converting notification-icon-source.svg..."
qlmanage -t -s 1024 -o /tmp notification-icon-source.svg 2>/dev/null || {
    echo "WARNING: qlmanage conversion may have failed for notification icon"
}

if [ -f "/tmp/notification-icon-source.svg.png" ]; then
    mv /tmp/notification-icon-source.svg.png ./notification-temp.png
    echo "  ✓ Created notification-temp.png"
elif [ -f "/tmp/notification-icon-source.png" ]; then
    mv /tmp/notification-icon-source.png ./notification-temp.png
    echo "  ✓ Created notification-temp.png"
fi

echo ""
echo "Step 2: Generating required icon sizes using sips..."

# Main app icon (1024x1024 - for App Store)
if [ -f "icon-temp.png" ]; then
    sips -z 1024 1024 icon-temp.png --out icon.png >/dev/null
    echo "  ✓ icon.png (1024x1024)"

    # Adaptive icon (Android - 1024x1024 foreground on transparent)
    sips -z 1024 1024 icon-temp.png --out adaptive-icon.png >/dev/null
    echo "  ✓ adaptive-icon.png (1024x1024)"

    # Splash icon (can be same as main icon)
    sips -z 1024 1024 icon-temp.png --out splash-icon.png >/dev/null
    echo "  ✓ splash-icon.png (1024x1024)"

    # Favicon (48x48 for web)
    sips -z 48 48 icon-temp.png --out favicon.png >/dev/null
    echo "  ✓ favicon.png (48x48)"

    # Clean up temp file
    rm icon-temp.png
fi

# Notification icon (Android - should be simple silhouette)
# Android recommends 96x96 for notification icons
if [ -f "notification-temp.png" ]; then
    sips -z 96 96 notification-temp.png --out notification-icon.png >/dev/null
    echo "  ✓ notification-icon.png (96x96)"
    rm notification-temp.png
fi

echo ""
echo "=== Icon generation complete! ==="
echo ""
echo "Generated files:"
echo "  - icon.png (1024x1024) - Main app icon"
echo "  - adaptive-icon.png (1024x1024) - Android adaptive icon"
echo "  - splash-icon.png (1024x1024) - Splash screen icon"
echo "  - favicon.png (48x48) - Web favicon"
echo "  - notification-icon.png (96x96) - Android notifications"
echo ""
echo "Next steps:"
echo "  1. Review the generated icons"
echo "  2. Run 'npx expo prebuild --clean' to regenerate native projects"
echo "  3. Test the app on iOS and Android"
echo ""
