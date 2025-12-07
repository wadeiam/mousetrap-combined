# Makefile for Scout Device (ESP32-S3)
# Based on mousetrap_arduino Makefile

# Board FQBN - ESP32-S3 with 16MB flash, OPI PSRAM
FQBN = esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc

# Auto-detect port
PORT = $(shell arduino-cli board list | grep -i "esp32\|usbserial\|usbmodem" | awk '{print $$1}' | head -n 1)

# Sketch directory
SKETCH = .

# Serial monitor baud rate
MONITOR_BAUD = 115200

# LittleFS partition offset (must match partitions.csv)
LITTLEFS_OFFSET = 0x510000
LITTLEFS_BIN = build/littlefs.bin

# esptool path
ESPTOOL = $(shell find ~/Library/Arduino15/packages/esp32/tools/esptool_py -name "esptool" -type f 2>/dev/null | sort -V | tail -1)

.PHONY: help compile upload build monitor clean list-boards build-fs upload-fs deploy-fs deploy-all

help:
	@echo "Scout Device Build Commands"
	@echo "==========================="
	@echo ""
	@echo "  make compile      - Compile the firmware"
	@echo "  make upload       - Upload firmware to board"
	@echo "  make build        - Compile and upload"
	@echo "  make monitor      - Open serial monitor"
	@echo "  make clean        - Clean build artifacts"
	@echo "  make list-boards  - List connected boards"
	@echo ""
	@echo "LittleFS Commands:"
	@echo "  make build-fs     - Build LittleFS from scout-spa"
	@echo "  make upload-fs    - Upload LittleFS to device"
	@echo "  make deploy-fs    - Build and upload LittleFS"
	@echo "  make deploy-all   - Build and upload firmware + LittleFS"
	@echo ""
	@echo "Board Configuration:"
	@echo "  - ESP32-S3, 16MB Flash, OPI PSRAM"
	@echo "  - LittleFS offset: $(LITTLEFS_OFFSET)"
	@echo ""

compile:
	@echo "Compiling scout firmware..."
	arduino-cli compile --fqbn "$(FQBN)" $(SKETCH)
	@echo "Copying binary to build folder..."
	@mkdir -p build
	@SKETCH_HASH=$$(arduino-cli compile --fqbn "$(FQBN)" $(SKETCH) --dry-run 2>&1 | grep "Sketch will be built in" | awk -F"'" '{print $$2}' || echo ""); \
	if [ -z "$$SKETCH_HASH" ]; then \
		SKETCH_HASH=$$(ls -t ~/Library/Caches/arduino/sketches/*/scout_arduino.ino.bin 2>/dev/null | head -1 | xargs dirname | xargs basename); \
	fi; \
	if [ -f "$$HOME/Library/Caches/arduino/sketches/$$SKETCH_HASH/scout_arduino.ino.bin" ]; then \
		cp "$$HOME/Library/Caches/arduino/sketches/$$SKETCH_HASH/scout_arduino.ino.bin" build/; \
		echo "Binary copied to build/scout_arduino.ino.bin"; \
	else \
		echo "Warning: Could not find compiled binary in cache"; \
	fi
	@echo "Compilation complete"

upload:
	@echo "Uploading to board..."
	@if [ -z "$(PORT)" ]; then \
		echo "Error: No board detected. Connect your ESP32-S3."; \
		exit 1; \
	fi
	@echo "Using port: $(PORT)"
	arduino-cli upload --fqbn "$(FQBN)" -p $(PORT) $(SKETCH)
	@echo "Upload complete"

build: compile upload

monitor:
	@if [ -z "$(PORT)" ]; then \
		echo "Error: No board detected."; \
		exit 1; \
	fi
	@echo "Opening serial monitor on $(PORT) at $(MONITOR_BAUD) baud"
	arduino-cli monitor -p $(PORT) -c baudrate=$(MONITOR_BAUD)

clean:
	@echo "Cleaning build artifacts..."
	@rm -rf build/
	@echo "Clean complete"

list-boards:
	@echo "Connected boards:"
	@arduino-cli board list

# =============================================================================
# LittleFS Targets
# =============================================================================

build-fs:
	@echo "Building LittleFS image..."
	@./build-littlefs.sh
	@echo "LittleFS image ready: $(LITTLEFS_BIN)"

upload-fs:
	@echo "Uploading LittleFS to device..."
	@if [ -z "$(PORT)" ]; then \
		echo "Error: No board detected."; \
		exit 1; \
	fi
	@if [ -z "$(ESPTOOL)" ]; then \
		echo "Error: esptool not found."; \
		exit 1; \
	fi
	@if [ ! -f "$(LITTLEFS_BIN)" ]; then \
		echo "Error: LittleFS image not found. Run 'make build-fs' first."; \
		exit 1; \
	fi
	@echo "Using port: $(PORT)"
	@echo "Using offset: $(LITTLEFS_OFFSET)"
	$(ESPTOOL) --chip esp32s3 --port $(PORT) --baud 115200 write_flash $(LITTLEFS_OFFSET) $(LITTLEFS_BIN)
	@echo "LittleFS upload complete"

deploy-fs: build-fs upload-fs

deploy-all: compile upload build-fs upload-fs
	@echo "Full deployment complete (firmware + filesystem)"
