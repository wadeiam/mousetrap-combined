# Firmware Compilation Guide

**Target:** ESP32-S3 with 16MB Flash, 8MB OPI PSRAM
**Build Tool:** Arduino CLI with ESP32 core 3.3.2+

---

## Quick Reference

### Using Makefile (Recommended)
```bash
cd /Users/wadehargrove/Documents/MouseTrap/Arduino
make compile
```

### Manual Compilation
```bash
cd /Users/wadehargrove/Documents/MouseTrap/Arduino

arduino-cli compile \
  --fqbn "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc" \
  --output-dir build \
  .
```

**CRITICAL:** Always include `--output-dir build` or binaries will go to the wrong location.

---

## Board Configuration (FQBN)

```
esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc
```

| Setting | Value | Why |
|---------|-------|-----|
| FlashSize | 16M | Total flash storage |
| PSRAM | opi | 8MB Octal SPI PSRAM for camera buffers |
| PartitionScheme | custom | Uses `partitions.csv` for OTA support |
| CPUFreq | 240 | Maximum speed with WiFi |
| FlashMode | qio | Quad I/O @ 80MHz |
| UploadSpeed | 921600 | Fast upload |
| USBMode | hwcdc | USB CDC for serial |

---

## ⚠️ CRITICAL: Correct vs Wrong Compilation

### ✅ CORRECT
```bash
arduino-cli compile --fqbn "esp32:esp32:esp32s3:...<full FQBN>..." --output-dir build .
```

### ❌ WRONG - DO NOT USE
```bash
# Wrong board (no OTA support)
arduino-cli compile --fqbn esp32:esp32:esp32cam

# Missing output directory (binaries go to cache)
arduino-cli compile --fqbn "esp32:esp32:esp32s3:..."

# Wrong project directory
cd /Users/wadehargrove/Documents/Arduino/mousetrap  # This is the OLD PlatformIO project!
```

---

## Build Output

### Expected Files in `build/`
```
build/
├── mousetrap_arduino.ino.bin          # Firmware binary (deploy this)
├── mousetrap_arduino.ino.elf          # ELF with debug symbols
├── mousetrap_arduino.ino.map          # Memory map
├── mousetrap_arduino.ino.partitions.bin  # Partition table
├── mousetrap_arduino.ino.bootloader.bin  # Bootloader
└── littlefs.bin                       # Filesystem binary (separate build)
```

### Verify Build Success
```bash
ls -lh build/mousetrap_arduino.ino.bin
```

Check that:
1. File exists
2. Timestamp is recent (matches compilation time)
3. Size is ~1.4-1.5 MB

---

## Partition Scheme

### Why Custom Partition Matters

The ESP32-S3 has 16MB flash divided as follows (defined in `partitions.csv`):

| Partition | Type | Size | Purpose |
|-----------|------|------|---------|
| nvs | data | 20KB | Network/config storage |
| otadata | data | 8KB | OTA update metadata |
| **app0** | app | 2.5MB | Primary firmware slot |
| **app1** | app | 2.5MB | Secondary firmware slot (OTA) |
| **littlefs** | data | 10.875MB | Filesystem for SPA/images |
| coredump | data | 64KB | Crash debugging |

**Critical:** Dual app partitions (app0/app1) enable OTA updates. Without custom partition, OTA will fail.

### ⚠️ DO NOT MODIFY partitions.csv

The partition table must not be changed without explicit authorization. Modifying it can:
- Brick devices in the field
- Cause data loss
- Require physical USB access to recover

### Expected Warning (Safe to Ignore)
```
WARNING: Partition has name 'littlefs' which is a partition subtype,
but this partition has non-matching type 0x1 and subtype 0x82.
```

This is cosmetic and safe. The partition uses LittleFS filesystem with SPIFFS subtype (0x82) for OTA compatibility.

---

## Compilation Workflow

### 1. Edit Firmware
```bash
# Edit the main firmware file
vim mousetrap_arduino.ino
```

### 2. Compile
```bash
make compile
```

### 3. Verify Binary Updated
```bash
# Check timestamp matches compilation time
ls -lh build/mousetrap_arduino.ino.bin
```

### 4. Deploy (see [OTA-DEPLOYMENT.md](./OTA-DEPLOYMENT.md))

---

## Common Issues

### Issue: "Sketch too big" Error

**Symptom:**
```
Sketch uses 2686480 bytes (111%) of program storage space
```

**Cause:** Used wrong FQBN or missing custom partition scheme

**Fix:** Ensure you're using the correct FQBN with `PartitionScheme=custom`

---

### Issue: Binary Not Updated After Compilation

**Symptom:** Timestamp on `build/mousetrap_arduino.ino.bin` doesn't change

**Cause:** Missing `--output-dir build` flag

**Fix:** Always use the Makefile or include `--output-dir build`:
```bash
arduino-cli compile --fqbn "..." --output-dir build .
```

---

### Issue: Wrong Project Directory

**Symptom:** Compilation succeeds but changes don't appear in firmware

**Cause:** Editing/compiling the wrong project

**Fix:** Always work in:
```
/Users/wadehargrove/Documents/MouseTrap/Arduino/  ✅ CORRECT
```

NOT:
```
/Users/wadehargrove/Documents/Arduino/mousetrap/  ❌ WRONG (old PlatformIO project)
```

---

### Issue: "Port busy" During Upload

**Symptom:**
```
Error: port busy
```

**Cause:** Another process (IDE, serial monitor) is using the USB port

**Fix:**
```bash
# Find and kill the process
lsof | grep cu.usbmodem
kill <PID>

# Or close Arduino IDE / serial monitors
```

---

## ESP32 Arduino Core Version

- **Mac M1:** ESP32 core 3.3.2 (arduino-cli)
- **Windows PC:** ESP32 core 3.3.3 (Arduino IDE)
- **Compatibility:** Minor version difference is safe

To upgrade:
```bash
arduino-cli core upgrade esp32:esp32
```

---

## Compilation Performance

Typical compilation time:
- **First build:** ~60 seconds
- **Incremental builds:** ~20 seconds

Compiled binary size:
- **Firmware:** ~1.4-1.5 MB (out of 2.5MB app partition)
- **Flash usage:** 56-60%
- **RAM usage:** 13-15% of dynamic memory

---

## Next Steps

After successful compilation:

1. **Deploy via OTA:** See [OTA-DEPLOYMENT.md](./OTA-DEPLOYMENT.md)
2. **Upload via USB:** See [BOARD-SETTINGS.md](./BOARD-SETTINGS.md)
3. **Test on device:** See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

---

## Makefile Commands

```bash
make help        # Show all commands
make compile     # Compile sketch
make upload      # Upload via USB (auto-detect port)
make build       # Compile + upload
make monitor     # Open serial monitor
make clean       # Clean build artifacts
make list-boards # List connected boards
```

---

**Related Documentation:**
- [OTA-DEPLOYMENT.md](./OTA-DEPLOYMENT.md) - Deploy compiled firmware
- [BOARD-SETTINGS.md](./BOARD-SETTINGS.md) - Board configuration details
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues
