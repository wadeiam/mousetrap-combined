# Makefile for ESP32-S3 Arduino Project
# Matches Windows Arduino IDE configuration

# Board FQBN (Fully Qualified Board Name) matching your Windows settings
# Note: Custom partition scheme uses partitions.csv in the sketch directory
FQBN = esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc

# Auto-detect port (finds first ESP32 device)
PORT = $(shell arduino-cli board list | grep -i "esp32\|usbserial\|usbmodem" | awk '{print $$1}' | head -n 1)

# Sketch directory (current directory)
SKETCH = .

# Baud rate for serial monitor
MONITOR_BAUD = 115200

# LittleFS partition offset - MUST match partitions.csv
# Source of truth: partitions.csv line "littlefs, data, spiffs, 0x510000, ..."
LITTLEFS_OFFSET = 0x510000
LITTLEFS_BIN = build/littlefs.bin

# esptool path (auto-detect from Arduino)
ESPTOOL = $(shell find ~/Library/Arduino15/packages/esp32/tools/esptool_py -name "esptool" -type f 2>/dev/null | sort -V | tail -1)

.PHONY: help compile upload build monitor clean list-boards setup build-fs upload-fs deploy-fs deploy-all

help:
	@echo "ESP32-S3 Build Commands"
	@echo "======================="
	@echo ""
	@echo "  make compile      - Compile the sketch"
	@echo "  make upload       - Upload firmware to board (auto-detect port)"
	@echo "  make build        - Compile and upload firmware"
	@echo "  make monitor      - Open serial monitor"
	@echo "  make clean        - Clean build artifacts"
	@echo "  make list-boards  - List connected boards"
	@echo "  make setup        - Run setup script"
	@echo ""
	@echo "LittleFS Commands:"
	@echo "  make build-fs     - Build LittleFS image from trap-spa"
	@echo "  make upload-fs    - Upload LittleFS to device (offset $(LITTLEFS_OFFSET))"
	@echo "  make deploy-fs    - Build and upload LittleFS"
	@echo "  make deploy-all   - Build and upload firmware + LittleFS"
	@echo ""
	@echo "Board Configuration:"
	@echo "  - ESP32S3 Dev Module"
	@echo "  - 16MB Flash, OPI PSRAM"
	@echo "  - Custom partition (OTA + LittleFS)"
	@echo "  - 240MHz CPU, 921600 upload speed"
	@echo "  - LittleFS offset: $(LITTLEFS_OFFSET) (from partitions.csv)"
	@echo ""

compile:
	@echo "🔨 Compiling sketch..."
	arduino-cli compile --fqbn "$(FQBN)" $(SKETCH)
	@echo "📦 Copying binary to build folder..."
	@mkdir -p build
	@SKETCH_HASH=$$(arduino-cli compile --fqbn "$(FQBN)" $(SKETCH) --dry-run 2>&1 | grep "Sketch will be built in" | awk -F"'" '{print $$2}' || echo ""); \
	if [ -z "$$SKETCH_HASH" ]; then \
		SKETCH_HASH=$$(ls -t ~/Library/Caches/arduino/sketches/*/mousetrap_arduino.ino.bin 2>/dev/null | head -1 | xargs dirname | xargs basename); \
	fi; \
	if [ -f "$$HOME/Library/Caches/arduino/sketches/$$SKETCH_HASH/mousetrap_arduino.ino.bin" ]; then \
		cp "$$HOME/Library/Caches/arduino/sketches/$$SKETCH_HASH/mousetrap_arduino.ino.bin" build/; \
		echo "✅ Binary copied to build/mousetrap_arduino.ino.bin"; \
	else \
		echo "⚠️  Could not find compiled binary in cache"; \
	fi
	@echo "✅ Compilation complete"

upload:
	@echo "📤 Uploading to board..."
	@if [ -z "$(PORT)" ]; then \
		echo "❌ No board detected. Please connect your ESP32-S3 and try again."; \
		echo "Run 'make list-boards' to see connected devices."; \
		exit 1; \
	fi
	@echo "Using port: $(PORT)"
	arduino-cli upload --fqbn "$(FQBN)" -p $(PORT) $(SKETCH)
	@echo "✅ Upload complete"

build: compile upload

monitor:
	@if [ -z "$(PORT)" ]; then \
		echo "❌ No board detected. Please connect your ESP32-S3."; \
		exit 1; \
	fi
	@echo "📡 Opening serial monitor on $(PORT) at $(MONITOR_BAUD) baud"
	@echo "Press Ctrl+C to exit"
	arduino-cli monitor -p $(PORT) -c baudrate=$(MONITOR_BAUD)

clean:
	@echo "🧹 Cleaning build artifacts..."
	@rm -rf build/
	@echo "✅ Clean complete"

list-boards:
	@echo "Connected boards:"
	@arduino-cli board list

setup:
	@echo "Running setup script..."
	@chmod +x setup_esp32.sh
	@./setup_esp32.sh

# =============================================================================
# LittleFS Filesystem Targets
# =============================================================================
# IMPORTANT: LITTLEFS_OFFSET must match partitions.csv
# If you change partitions.csv, update LITTLEFS_OFFSET at top of this file!
# =============================================================================

build-fs:
	@echo "📦 Building LittleFS image..."
	@./build-littlefs.sh
	@echo "✅ LittleFS image ready: $(LITTLEFS_BIN)"

upload-fs:
	@echo "📤 Uploading LittleFS to device..."
	@if [ -z "$(PORT)" ]; then \
		echo "❌ No board detected. Please connect your ESP32-S3."; \
		exit 1; \
	fi
	@if [ -z "$(ESPTOOL)" ]; then \
		echo "❌ esptool not found. Install ESP32 Arduino core."; \
		exit 1; \
	fi
	@if [ ! -f "$(LITTLEFS_BIN)" ]; then \
		echo "❌ LittleFS image not found. Run 'make build-fs' first."; \
		exit 1; \
	fi
	@echo "Using port: $(PORT)"
	@echo "Using offset: $(LITTLEFS_OFFSET) (from partitions.csv)"
	$(ESPTOOL) --chip esp32s3 --port $(PORT) --baud 115200 write_flash $(LITTLEFS_OFFSET) $(LITTLEFS_BIN)
	@echo "✅ LittleFS upload complete"

deploy-fs: build-fs upload-fs

deploy-all: compile upload build-fs upload-fs
	@echo "✅ Full deployment complete (firmware + filesystem)"
