# Scout Device Firmware

ESP32-S3-CAM based motion detection device for entry point surveillance.

## Overview

The Scout is a camera-based motion detection device that monitors entry points (doorways, vents, holes) for rodent activity. Unlike the full Trap device, Scout is:
- Camera-only (no physical trap mechanism)
- USB-powered only (no battery/solar)
- Simpler firmware (~2000 lines vs Trap's 13,000 lines)

## Hardware

- **Board:** ESP32-S3 with OV2640 camera
- **Supported Models:** ESP32S3-EYE (default), AI-Thinker, XIAO ESP32S3
- **Flash:** 16MB
- **PSRAM:** 8MB OPI

## Quick Start

### Compile
```bash
make compile
```

### Build Filesystem (SPA)
```bash
make build-fs
```

### Flash (First Time or After Erase)
```bash
# Compile with all binaries exported
arduino-cli compile --fqbn "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc" --export-binaries .

# Build filesystem
make build-fs

# Flash everything
esptool --chip esp32s3 --port /dev/cu.usbserial-10 --baud 115200 write_flash \
  0x0 build/esp32.esp32.esp32s3/scout_arduino.ino.bootloader.bin \
  0x8000 build/esp32.esp32.esp32s3/scout_arduino.ino.partitions.bin \
  0x10000 build/esp32.esp32.esp32s3/scout_arduino.ino.bin \
  0x510000 build/littlefs.bin
```

### Flash (Firmware Only)
```bash
make compile
esptool --chip esp32s3 --port /dev/cu.usbserial-10 --baud 115200 \
  write_flash 0x10000 build/scout_arduino.ino.bin
```

### Erase Flash (Factory Reset)
```bash
esptool --chip esp32s3 --port /dev/cu.usbserial-10 erase_flash
```
**Note:** After erase, you must flash ALL components (bootloader, partitions, firmware, filesystem).

## Setup Flow

1. Power on Scout device
2. Connect phone to `Scout-XXXXXX` WiFi network
3. iOS captive portal auto-popups with setup wizard
4. Select WiFi network, enter password
5. Create account or sign in
6. Device registers with server and connects to MQTT

## Captive Portal Architecture

The Scout uses a two-level redirect pattern (same as Trap) to trigger iOS captive portal:

```
iOS request → /generate_204 → onNotFound redirects to /setup
           → /setup redirects to /#/setup
           → / SERVES index.html (HTTP 200)
           → SPA loads, hash router handles #/setup
```

Key: The root `/` handler serves content (HTTP 200), not another redirect. This breaks the redirect chain and makes iOS show the captive portal popup.

## WiFi Scanning

The firmware uses **synchronous** WiFi scanning with 4-attempt retry logic:
1. Standard scan (500ms dwell)
2. Active scan (1000ms dwell)
3. Disconnect STA, retry (800ms)
4. Switch to STA-only mode, scan (1000ms), restore AP

After scanning, AP mode is fully restored with correct IP (192.168.4.1).

## Key Files

| File | Description |
|------|-------------|
| `scout_arduino.ino` | Main firmware |
| `camera_pins.h` | GPIO definitions for different camera boards |
| `motion_detect.h` | Motion detection algorithm |
| `partitions.csv` | Flash partition layout |
| `Makefile` | Build commands |
| `build-littlefs.sh` | SPA filesystem builder |
| `scout-spa/` | Svelte web interface |

## API Endpoints

### Setup
- `GET /api/wifi/scan` - Scan for WiFi networks (synchronous)
- `POST /api/setup/test-wifi` - Test WiFi connection
- `POST /api/setup/register` - Register with server
- `GET /api/setup/progress` - Poll setup progress
- `POST /api/setup/reboot` - Trigger reboot

### Device
- `GET /api/status` - Device status
- `GET /api/system-status` - System info (heap, uptime, etc.)
- `GET /api/captures` - List captured images
- `GET /camera` - Live camera snapshot

### Claiming
- `GET /api/device/claim-status` - Check if device is claimed
- `POST /api/device/claim` - Claim device with code `{claimCode}` (matches Trap)
- `POST /api/device/unclaim` - Unclaim device

### System/Logs
- `GET /api/logs` - Current system logs
- `GET /api/system-logs` - Alias for /api/logs (SPA compatibility)
- `GET /api/mqtt/reconnect` - Debug: force MQTT reconnect with diagnostics

## MQTT Topics

### Device to Server
- `tenant/{tenantId}/device/{mac}/status` - Device heartbeat
- `tenant/{tenantId}/device/{mac}/motion` - Motion event with image

### Server to Device
- `tenant/{tenantId}/device/{mac}/command/reboot` - Reboot device
- `tenant/{tenantId}/device/{mac}/command/get_camera_settings` - Request camera settings
- `tenant/{tenantId}/device/{mac}/command/set_camera_settings` - Update camera settings

## Troubleshooting

### No SSID Broadcasting
- Check serial output for errors
- Ensure flash includes bootloader (`invalid header: 0xffffffff` means missing bootloader)
- Try erasing flash and reflashing all components

### Captive Portal Not Auto-Opening
- Must use two-level redirect pattern
- Check serial for `[CAPTIVE]` log messages
- Manually browse to `http://192.168.4.1` as fallback

### WiFi Scan Shows "No Networks"
- Ensure using synchronous scanning (not async)
- Check that AP is restored after scan
- Try manual rescan with `?rescan=1` parameter

### Registration Fails (400 Error)
- Check MAC address format includes colons (`1C:DB:D4:99:30:CC`)
- Verify server is running and reachable
- Check server logs for detailed error

### MQTT Not Connecting After Claim
- **Root Cause:** `mqttClient.setServer()` stores pointer, not value. If you pass `String.c_str()` from a local String, the pointer becomes invalid after the function returns.
- **Fix:** Use a static buffer for the broker address:
```cpp
// WRONG - pointer invalidates after function returns
void mqttSetup() {
  String broker = claimedMqttBroker;
  mqttClient.setServer(broker.c_str(), MQTT_PORT);  // BAD!
}

// CORRECT - static buffer persists
static char mqttBrokerAddress[128];
void mqttSetup() {
  String broker = claimedMqttBroker;
  strncpy(mqttBrokerAddress, broker.c_str(), sizeof(mqttBrokerAddress)-1);
  mqttClient.setServer(mqttBrokerAddress, MQTT_PORT);  // GOOD!
}
```

## Version History

- **2026-01-19:** Added claim code support, fixed MQTT broker address memory bug, added /api/system-logs endpoint
- **2025-12-21:** Fixed captive portal (two-level redirect), synchronous WiFi scanning, MAC address format
