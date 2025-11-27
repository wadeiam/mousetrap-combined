# Firmware Development Guide

**Last Updated**: 2025-11-16

## IMPORTANT: Project Location

⚠️ **DO NOT EDIT THE WRONG PROJECT!**

### Active Firmware Project (Arduino CLI)
```
/Users/wadehargrove/Documents/Arduino/mousetrap_arduino/
```
- **Main File**: `mousetrap_arduino.ino`
- **Build Tool**: Arduino CLI with ESP32 board support
- **This is the CORRECT project to edit**

### Obsolete Project (DO NOT USE)
```
/Users/wadehargrove/Documents/Arduino/mousetrap/
```
- **Build Tool**: PlatformIO
- **Status**: DEPRECATED - DO NOT EDIT THIS DIRECTORY
- **Reason**: This is an older PlatformIO-based project that is no longer maintained

---

## Firmware Compilation

### Build Directory Structure

The project uses a specific build output directory:
```
/Users/wadehargrove/Documents/Arduino/mousetrap_arduino/build/
```

### Correct Compile Command

**ALWAYS use the `--output-dir build` flag to ensure binaries are written to the correct location:**

```bash
cd /Users/wadehargrove/Documents/Arduino/mousetrap_arduino

arduino-cli compile \
  --fqbn "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc" \
  --output-dir build \
  .
```

Or use the Makefile:
```bash
cd /Users/wadehargrove/Documents/Arduino/mousetrap_arduino
make compile
```

### Build Outputs

After successful compilation, the following files will be in the `build/` directory:
- `mousetrap_arduino.ino.bin` - Firmware binary
- `mousetrap_arduino.ino.elf` - ELF file with debug symbols
- `mousetrap_arduino.ino.map` - Memory map
- `mousetrap_arduino.ino.partitions.bin` - Partition table

---

## Partition Table

### ⚠️ CRITICAL WARNING

**NEVER ALTER `partitions.csv` without explicit authorization**

The partition table defines the memory layout for:
- Firmware (app)
- LittleFS filesystem
- OTA partition
- NVS (Non-Volatile Storage)

Changing the partition table can:
- Brick devices in the field
- Cause data loss
- Require physical USB access to recover

### Partition Warning

If you see this warning during compilation:
```
WARNING: Partition has name 'littlefs' which is a partition subtype,
but this partition has non-matching type 0x1 and subtype 0x82.
Mistake in partition table?
```

**This warning is normal and can be ignored.** It's a cosmetic issue with naming conventions, not a functional problem.

---

## ESP32-S3 Board Configuration

The Kitchen device uses the following configuration:

| Setting | Value |
|---------|-------|
| Board | ESP32-S3 |
| Flash Size | 16MB |
| PSRAM | OPI PSRAM |
| Partition Scheme | Custom (partitions.csv) |
| CPU Frequency | 240MHz |
| Flash Mode | QIO |
| Upload Speed | 921600 |
| USB Mode | Hardware CDC |

**FQBN (Fully Qualified Board Name)**:
```
esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc
```

---

## Device Information

### Kitchen Device (ESP32-S3)
- **MAC Address**: 94A990306028
- **IP Address**: 192.168.133.46
- **Device Credentials**: `ops:changeme`
- **Tenant**: Master Tenant (00000000-0000-0000-0000-000000000001)

### Biggy Device (Details TBD)
- MAC: (unknown)
- IP: (unknown)

---

## Development Workflow

### 1. Making Code Changes

Edit the firmware source:
```bash
/Users/wadehargrove/Documents/Arduino/mousetrap_arduino/mousetrap_arduino.ino
```

### 2. Compile

**Always verify the timestamp after compilation to ensure the binary was updated:**

```bash
cd /Users/wadehargrove/Documents/Arduino/mousetrap_arduino
arduino-cli compile --fqbn "esp32:esp32:esp32s3:..." --output-dir build .

# Verify the build output was updated
ls -lh build/mousetrap_arduino.ino.bin
```

### 3. Deploy via OTA

Deploy to Kitchen device:
```bash
cd /Users/wadehargrove/Documents/Arduino/mousetrap_arduino
curl -u "ops:changeme" \
  -F "file=@build/mousetrap_arduino.ino.bin" \
  http://192.168.133.46/uploadfw
```

### 4. Verify Deployment

Wait ~20 seconds for the device to reboot, then check the system logs:
```bash
curl -u "ops:changeme" http://192.168.133.46/api/system-logs | python3 -c \
  "import sys, json; data=json.load(sys.stdin); print('\\n'.join(data[-50:]))"
```

---

## Firmware Features

### Device Claiming System

- Devices start unclaimed and host a WiFi access point
- Claim codes are generated via the server dashboard
- Once claimed, credentials are stored in NVS (separate from filesystem)
- **Important**: NVS is separate from LittleFS, so filesystem OTA updates don't affect claim status

### Unclaim Logging (Added 2025-11-16)

Location: `mousetrap_arduino.ino:7398-7402`

The `/api/device/unclaim` HTTP endpoint now logs the IP address of the client making the unclaim request:

```cpp
server.on("/api/device/unclaim", HTTP_POST, [](AsyncWebServerRequest* req) {
  // Log who is unclaiming the device
  IPAddress clientIP = req->client()->remoteIP();
  String logMsg = "[UNCLAIM] Request from: " + clientIP.toString();
  addSystemLog(logMsg);
  Serial.println(logMsg);

  // ... rest of unclaim logic
});
```

This helps track spontaneous unclaim events.

---

## Common Issues

### Issue: Firmware binary not updated after compilation

**Symptom**: Timestamp on `build/mousetrap_arduino.ino.bin` doesn't change

**Cause**: Arduino CLI output directory not specified

**Solution**: Always use `--output-dir build` flag:
```bash
arduino-cli compile --fqbn "..." --output-dir build .
```

### Issue: Device doesn't boot after firmware update

**Possible Causes**:
1. Wrong FQBN used during compilation
2. Partition table mismatch
3. Code exceeds flash size

**Recovery**:
1. Check compilation output for size warnings
2. Recompile with correct FQBN
3. If all else fails, deploy a known-good firmware version

---

## File Structure

```
/Users/wadehargrove/Documents/Arduino/mousetrap_arduino/
├── mousetrap_arduino.ino       # Main firmware file (EDIT THIS)
├── Makefile                     # Build automation
├── partitions.csv               # Partition table (DO NOT EDIT)
├── build/                       # Compiled binaries (OUTPUT DIR)
│   ├── mousetrap_arduino.ino.bin
│   └── ...
├── data/                        # LittleFS filesystem data
│   └── index.html
└── v1.3.X_build/                # Version-specific builds (ARCHIVE)
```

---

## Related Documentation

- [Server Deployment Guide](./DEPLOYMENT.md) - Server update procedures
- [Server Handoff](./HANDOFF.md) - Main server documentation
- [Test Index](./TEST-INDEX.md) - Testing procedures

---

## Version History

### 2025-11-16 - Unclaim IP Logging
- **Change**: Added IP address logging to `/api/device/unclaim` endpoint
- **File**: `mousetrap_arduino.ino:7398-7402`
- **Reason**: Track spontaneous unclaim events (Kitchen device unclaimed during filesystem OTA)
- **Binary Size**: 1,491,899 bytes (8% of 16MB flash)

---

## Emergency Contacts

If you encounter issues beyond this documentation:
1. Check server logs: `pm2 logs mqtt-server`
2. Check device logs: `curl -u ops:changeme http://192.168.133.46/api/system-logs`
3. Review git history for recent firmware changes
4. Test on Biggy device before deploying to Kitchen

---

**Remember**: Always backup before making changes, and NEVER edit the PlatformIO project (`/Users/wadehargrove/Documents/Arduino/mousetrap/`)!
