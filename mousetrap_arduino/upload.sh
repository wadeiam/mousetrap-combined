#!/bin/bash
# Upload to ESP32-S3 board

FQBN="esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc"

# Auto-detect port
PORT=$(arduino-cli board list | grep -i "esp32\|usbserial\|usbmodem" | awk '{print $1}' | head -n 1)

if [ -z "$PORT" ]; then
    echo "❌ No ESP32-S3 board detected"
    echo "Please connect your board and try again"
    echo ""
    echo "Available ports:"
    arduino-cli board list
    exit 1
fi

echo "📤 Uploading to board on port: $PORT"
arduino-cli upload --fqbn "$FQBN" -p "$PORT" .

if [ $? -eq 0 ]; then
    echo "✅ Upload successful"
else
    echo "❌ Upload failed"
    echo ""
    echo "Troubleshooting tips:"
    echo "  - Hold BOOT button while uploading"
    echo "  - Press RESET button before uploading"
    echo "  - Try a different USB cable"
    exit 1
fi
