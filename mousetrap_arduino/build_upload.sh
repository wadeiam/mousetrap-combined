#!/bin/bash
# Compile and upload ESP32-S3 sketch

set -e

echo "🏗️  Building and uploading ESP32-S3 firmware..."
echo ""

# Compile
./compile.sh

echo ""

# Upload
./upload.sh

echo ""
echo "🎉 Build and upload complete!"
