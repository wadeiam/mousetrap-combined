#!/bin/bash
# Compile ESP32-S3 sketch

FQBN="esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc"

echo "🔨 Compiling ESP32-S3 sketch..."
arduino-cli compile --fqbn "$FQBN" .

if [ $? -eq 0 ]; then
    echo "✅ Compilation successful"
else
    echo "❌ Compilation failed"
    exit 1
fi
