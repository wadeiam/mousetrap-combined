# ESP32-S3 Board Settings Reference

## ⚠️ DEFAULT SYSTEM CREDENTIALS

**Web Dashboard Login:**
- URL: http://192.168.133.110:5173
- Email: `admin@mastertenant.com`
- Password: `Admin123!`

**Device OTA Configuration:**
- Username: `ops`
- Password: `changeme`

---

This document describes the board configuration for ESP32-S3 development on Mac M1 using arduino-cli.

**Important Notes:**
- Mac is currently using ESP32 core 3.3.2 (latest available via arduino-cli)
- Windows PC is using ESP32 core 3.3.3 (available via Arduino IDE)
- Minor version difference should not cause compatibility issues
- When 3.3.3 becomes available: run `arduino-cli core upgrade esp32:esp32`

This configuration matches your Windows Arduino IDE setup.

## Board Configuration

**Board:** ESP32S3 Dev Module

### Settings Breakdown

| Setting | Value | Description |
|---------|-------|-------------|
| **USB CDC On Boot** | Enabled | Enables USB CDC (Communication Device Class) on boot for serial communication |
| **CPU Frequency** | 240MHz (WiFi) | Maximum CPU speed with WiFi enabled |
| **Core Debug Level** | None | No debug output (production build) |
| **USB DFU On Boot** | Disabled | DFU (Device Firmware Update) mode disabled |
| **Erase Flash Before Upload** | Disabled | Preserves data across uploads |
| **Events Run On** | Core 1 | Arduino loop runs on Core 1 |
| **Flash Mode** | QIO 80MHz | Quad I/O mode for faster flash access |
| **Flash Size** | 16MB (128Mb) | Total flash storage capacity |
| **JTAG Adapter** | Disabled | JTAG debugging disabled |
| **Arduino Runs On** | Core 1 | Arduino framework runs on Core 1 |
| **USB Firmware MSC On Boot** | Disabled | Mass Storage Class disabled on boot |
| **Partition Scheme** | Custom | Custom partition layout (see below) |
| **PSRAM** | OPI PSRAM | Octal SPI PSRAM (8MB) |
| **Upload Mode** | UART0 / Hardware CDC | Upload via USB CDC |
| **Upload Speed** | 921600 | Fast upload speed (921600 baud) |
| **USB Mode** | Hardware CDC and JTAG | USB configured for CDC + JTAG |
| **Zigbee Mode** | Disabled | Zigbee functionality disabled |

## Custom Partition Scheme

The custom partition layout (`custom_16mb_ota.csv`) allocates the 16MB flash as follows:

| Partition | Type | Subtype | Offset | Size | Description |
|-----------|------|---------|--------|------|-------------|
| nvs | data | nvs | 0x9000 | 20KB | Non-volatile storage for WiFi, etc. |
| otadata | data | ota | 0xE000 | 8KB | OTA update metadata |
| app0 | app | ota_0 | 0x10000 | 2.5MB | Primary application slot |
| app1 | app | ota_1 | 0x290000 | 2.5MB | Secondary application slot (OTA) |
| littlefs | data | spiffs | 0x510000 | 10.875MB | File system storage (LittleFS on SPIFFS subtype) |
| coredump | data | coredump | 0xFF0000 | 64KB | Core dump storage for debugging |

**Total Allocated:** ~16MB

### Partition Benefits

- **OTA Updates:** Dual app partitions allow safe over-the-air firmware updates
- **Large Filesystem:** 10.875MB LittleFS partition for storing files, configs, etc.
- **Core Dumps:** Dedicated space for crash debugging
- **NVS:** Separate storage for system configuration

### Important: LittleFS Partition SubType

**Critical Configuration Detail:**

The filesystem partition uses **LittleFS filesystem** but requires **SPIFFS SubType (0x82)** for OTA updates to work correctly.

```csv
# partitions.csv
littlefs, data, spiffs,  0x510000, 0xAE0000,
#         name  ^^^^^^ SubType MUST be "spiffs" not "littlefs"!
```

**Why this matters:**

1. **Partition Name:** `littlefs` - This is what `LittleFS.begin()` uses to mount the filesystem
2. **Partition SubType:** `spiffs` (0x82) - This is what `Update.begin(size, U_SPIFFS)` expects for filesystem OTA

**Technical Explanation:**

- The Arduino ESP32 `Update` library uses the constant `U_SPIFFS` for filesystem OTA updates
- `U_SPIFFS` specifically looks for SubType `0x82` (historically used for SPIFFS)
- Even though we're using LittleFS, the OTA update mechanism requires SubType `0x82`
- The partition *name* can still be "littlefs" for mounting purposes
- This allows LittleFS filesystem on a partition with SPIFFS SubType

**Warning:** Using SubType `littlefs` (0x83) will cause "Partition Could Not be Found" errors during filesystem OTA updates.

**You will see this warning during flash operations (this is expected and safe):**
```
WARNING: Partition has name 'littlefs' which is a partition subtype,
but this partition has non-matching type 0x1 and subtype 0x82.
```

## Arduino CLI FQBN

The complete Fully Qualified Board Name (FQBN) for arduino-cli:

```
esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc
```

**Important:**
- `PartitionScheme=custom` uses the `partitions.csv` file in your sketch directory
- The `FlashFreq` option was removed in ESP32 core 3.x (flash frequency is now part of FlashMode)
- Flash Mode `qio` defaults to 80MHz operation

## Usage Examples

### Compile
```bash
arduino-cli compile --fqbn "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc" .
```

### Upload
```bash
arduino-cli upload --fqbn "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc" -p /dev/cu.usbserial-* .
```

### Using Make (Recommended)

**IMPORTANT:** Always use `make` commands for compilation and upload. The Makefile contains the correct FQBN with all required settings including the custom partition scheme.

```bash
make compile  # Compile only
make upload   # Upload via USB (auto-detects port)
make build    # Compile and upload
make monitor  # Open serial monitor
```

### Manual Compilation (If Make Unavailable)

If you must compile manually, use this exact FQBN:

```bash
arduino-cli compile --fqbn "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc" .
```

**Critical:** The `PartitionScheme=custom` setting requires `partitions.csv` in the sketch directory. Without this, the sketch will be too large (111% of default partition space).

## Port Detection

On macOS, the ESP32-S3 typically appears as:
- `/dev/cu.usbserial-*` (if using external USB-UART adapter)
- `/dev/cu.usbmodem*` (if using built-in USB CDC)

Use `arduino-cli board list` to detect the correct port automatically.

## Troubleshooting

### Upload Issues

1. **Board not detected:**
   - Check USB cable (must support data transfer)
   - Try different USB port
   - Install CH340 drivers: `brew install --cask wch-ch34x-usb-serial-driver`

2. **Upload fails:**
   - Hold BOOT button while connecting
   - Press RESET button before uploading
   - Reduce upload speed to 115200 in FQBN
   - **CRITICAL:** Close Arduino IDE or other serial monitors before uploading
   - **Port busy error:** Kill any processes using the port:
     ```bash
     lsof | grep cu.usbmodem
     kill <PID>
     ```

3. **Session freezes when reading serial:**
   - Avoid using background processes to read serial port (can freeze session)
   - Use simple commands: `make monitor` or user opens serial monitor manually
   - Do not use complex shell redirections or `cat` in background with the serial port

3. **Custom partition not found:**
   - Run `./setup_esp32.sh` to install partition scheme
   - Verify file exists: `ls ~/Library/Arduino15/packages/esp32/hardware/esp32/*/tools/partitions/custom_16mb_ota.csv`

### Compilation Issues

1. **Missing libraries:**
   - Install required libraries via arduino-cli or Arduino IDE
   - Check library dependencies

2. **Flash/PSRAM errors:**
   - Verify FQBN matches exactly (FlashSize=16M,PSRAM=opi)
   - Ensure custom partition scheme is installed

3. **Mac-specific library modifications required:**

   **ESP_Async_WebServer** - Fixed const-correctness issue:
   - File: `~/Documents/Arduino/libraries/ESP_Async_WebServer/src/ESPAsyncWebServer.h`
   - Lines 1124-1125: Added const_cast for ESP32 (matching ESP8266 implementation)
   ```cpp
   // ESP32 AsyncTCP also has the same const issue
   return static_cast<tcp_state>(const_cast<AsyncWebServer *>(this)->_server.status());
   ```

   **ElegantOTA** - AsyncWebServer compatibility:
   - File: `~/Documents/Arduino/libraries/ElegantOTA/src/ElegantOTA.h`
   - Line 27: Set `ELEGANTOTA_USE_ASYNC_WEBSERVER` to 0
   - Note: ElegantOTA is currently disabled in firmware (incompatible with AsyncWebServer)
   - Alternative: Use MQTT for firmware updates instead of web-based OTA

## Hardware Specifications

Based on your board settings:
- **Chip:** ESP32-S3
- **Flash:** 16MB
- **PSRAM:** 8MB (OPI)
- **Cores:** Dual-core Xtensa LX7
- **WiFi:** 2.4GHz 802.11 b/g/n
- **Bluetooth:** Bluetooth 5 (LE)

## Files Created

- `setup_esp32.sh` - Setup script for installing partition scheme
- `Makefile` - Make commands for build/upload
- `compile.sh` - Compile helper script
- `upload.sh` - Upload helper script
- `build_upload.sh` - Combined compile + upload
- `partitions.csv` - Custom partition layout
- `ESP32_SETTINGS_REFERENCE.md` - This file

## Quick Reference Card

```
╔══════════════════════════════════════════╗
║  ESP32-S3 Quick Reference                ║
╠══════════════════════════════════════════╣
║  Board:      ESP32S3 Dev Module          ║
║  Flash:      16MB @ QIO 80MHz            ║
║  PSRAM:      8MB OPI                     ║
║  CPU:        240MHz (WiFi)               ║
║  Partition:  Custom OTA + LittleFS       ║
║  Upload:     921600 baud via USB CDC     ║
╠══════════════════════════════════════════╣
║  Commands:                               ║
║    make compile  - Compile sketch        ║
║    make upload   - Upload to board       ║
║    make build    - Compile + upload      ║
║    make monitor  - Serial monitor        ║
╚══════════════════════════════════════════╝
```

## For Claude Code

When working with Claude Code, you can use:

```
Use make build to compile and upload the code
```

Or provide the FQBN directly:

```
Compile using arduino-cli with FQBN:
esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc

The custom partition scheme uses partitions.csv in the sketch directory.
```

## Version Compatibility

- **Mac M1**: ESP32 core 3.3.2 (arduino-cli)
- **Windows PC**: ESP32 core 3.3.3 (Arduino IDE)
- **Difference**: Minor patch version - no compatibility issues expected
- **To upgrade Mac** (when 3.3.3 is available): `arduino-cli core upgrade esp32:esp32`

The FQBN configuration is identical between both platforms.

## OTA Firmware Update Process

The system supports two OTA update methods:

### 1. MQTT-Based OTA (Server-Pushed Updates)

**⚠️ CRITICAL: Version Number Must Match**

The firmware version hardcoded in the source code **MUST match** the version you upload to the dashboard, otherwise devices will enter an update loop.

**Step-by-step process:**

1. **Update the firmware version in source code** (mousetrap_arduino.ino around line 157):
   ```cpp
   #define FIRMWARE_VERSION "v1.X.X"  // Change this to your new version
   ```

2. **Compile the firmware:**
   ```bash
   make compile
   ```
   Binary location: `build/esp32.esp32.esp32s3/mousetrap_arduino.ino.bin`

3. **Upload via dashboard:**
   - Navigate to: http://192.168.133.110:5173/firmware
   - Select the compiled `.bin` file
   - Enter the **SAME version** as in `FIRMWARE_VERSION` (e.g., `v1.X.X`)
   - Choose update type: `firmware` or `filesystem`
   - Optionally add changelog notes
   - Check "Required Update" if mandatory
   - Check "Global (All Tenants)" to push to all devices across all tenants
   - Click "Upload & Publish to Devices"

4. **Devices receive update automatically:**
   - Server publishes MQTT notification to `global/firmware/latest` (or tenant-specific topic)
   - Devices subscribed to the topic receive the notification
   - Device checks if new version > current version
   - If yes, downloads firmware from server
   - Verifies SHA256 checksum
   - Flashes to alternate partition
   - Reboots into new firmware
   - Reports new version via MQTT status

**Update flow visible in device System Logs:**
```
[MQTT] Connected as DeviceName
[OTA] Updating firmware to v1.X.X
[OTA] Starting download: http://192.168.133.110:4000/api/firmware-files/...
[OTA] Download progress: XX%
[OTA] Update successful, rebooting...
```

**Troubleshooting:**
- **Update loop**: Version mismatch between `FIRMWARE_VERSION` and uploaded version
- **HTTP -1 error**: URL pointing to `localhost` instead of network IP
  - Check `API_BASE_URL=http://192.168.133.110:4000` in server `.env`
- **Not receiving update**: Device firmware may not have MQTT OTA code (use ElegantOTA instead)
- **Version check fails**: Ensure version format is consistent (e.g., `v1.2.3` not `v1.23`)

### 2. ElegantOTA (Manual Web-Based Updates)

ElegantOTA provides a web interface for manual firmware uploads:

**Access:** http://[device-ip]/update
- Username: `ops`
- Password: `changeme`

**Usage:**
1. Navigate to device's `/update` endpoint
2. Login with credentials above
3. Select firmware type (Firmware or Filesystem)
4. Choose the `.bin` file
5. Click "Update"
6. Device will flash and reboot automatically

**When to use:**
- Initial deployment of MQTT OTA functionality
- Emergency updates when MQTT is down
- Individual device updates without affecting fleet
- Downgrading firmware (MQTT OTA blocks downgrades)

**Note:** ElegantOTA does not require version numbers to match - it will flash any valid firmware binary.

---

## Web Interfaces

The system has **two separate web interfaces**:

### 1. Local Device Interface (Svelte SPA)

A lightweight single-page application served directly from the ESP32's LittleFS filesystem.

**Access:**
- URL: `http://<device-ip>/` (e.g., http://192.168.1.100/)
- No authentication required (device is on local network)
- Works offline - no internet or server required

**Features:**
- Dashboard - Device status, battery, signal strength
- Settings - WiFi, MQTT, device configuration
- Gallery - View captured images stored on device
- Logs - System logs and events
- Calibration - Servo and sensor calibration
- Firmware - Local OTA updates via ElegantOTA
- Servo Settings - Fine-tune servo positions
- Test Alert - Send test notifications

**Technology:**
- Built with Svelte + Vite
- Source: `trap-spa/` directory
- Minified build size: ~120KB total
- Served from LittleFS partition (~11MB available)

**Development:**
```bash
cd trap-spa
npm install
npm run dev          # Development server on localhost:5173
npm run build        # Build for production (outputs to dist/)
```

**Deployment to Device:**

The SPA must be packaged as a LittleFS filesystem image for OTA deployment:

```bash
# Build LittleFS image containing the SPA
./build-littlefs.sh
```

This script:
1. Builds the Svelte app (`npm run build`)
2. Creates a LittleFS filesystem image from `trap-spa/dist/`
3. Outputs `build/littlefs.bin` (~11MB)

**Upload via Dashboard:**
1. Run `./build-littlefs.sh` to generate `build/littlefs.bin`
2. Go to Dashboard → Firmware page
3. Select **"filesystem"** type
4. Upload the `littlefs.bin` file
5. Devices will receive MQTT notification and update automatically

**Upload via ElegantOTA:**
1. Navigate to `http://<device-ip>/update`
2. Select "Filesystem" tab
3. Choose `build/littlefs.bin`
4. Click "Update"

**Version Management:**
- SPA version tracked separately from firmware version
- Stored in `currentFilesystemVersion` preference
- Version file: `trap-spa/dist/version.json`

### 2. Cloud Dashboard (React)

Enterprise-grade multi-tenant management dashboard hosted on server.

**Access:**
- URL: http://192.168.133.110:5173 (development)
- Requires authentication
- Email: `admin@mastertenant.com`
- Password: `Admin123!`

**Features:**
- Multi-device management across tenants
- Real-time device status and alerts
- Firmware/filesystem OTA deployment
- User management and permissions
- Analytics and reporting
- Device claiming/provisioning
- System logs aggregation

**Technology:**
- Built with React + TypeScript + Vite
- Source: `../server-deployment/trap-dashboard/`
- API: Node.js + Express + PostgreSQL
- Real-time: MQTT + WebSocket

---

## Known Issues

### TCP Lock Assertion Crash (RESOLVED)

**Symptom:** Device crashed after ~20 seconds with network becoming unresponsive.

**Root Cause:** AsyncTCP library v1.1.4 is incompatible with ESP-IDF 5.x (used by ESP32 Arduino Core 3.3.x). The library makes direct lwIP TCP function calls without proper TCPIP core locking required by ESP-IDF 5.x.

**Solution:** Updated to Async_TCP v3.4.9 from ESP32Async which includes proper ESP-IDF 5.x compatibility with conditional TCPIP core locking.

**Fix Applied:**
1. Removed old AsyncTCP v1.1.4 library
2. Installed Async_TCP v3.4.9 via Arduino IDE Library Manager
3. Re-enabled all firmware features (MQTT, web server, endpoints)

**Key Debugging Lessons:**
1. **Use backtrace analysis first** - The backtrace immediately points to the exact crash location
2. **Check library compatibility** - ESP-IDF 5.x requires different locking than ESP-IDF 4.x
3. **Verify which library version is actually being compiled** - Use `arduino-cli compile --verbose` to confirm include paths
4. **Systematic isolation** - When multiple components are involved, disable all and re-enable one at a time
5. **Don't randomly patch libraries** - Manual TCPIP locking patches caused deadlocks because lwIP callbacks already hold locks

**Compiler Verification:**
```bash
arduino-cli compile --verbose 2>&1 | grep -i "asynctcp"
```
Ensure it shows the correct library path (Async_TCP, not AsyncTCP.old).

**Status:** ✅ RESOLVED - Device now stable with all features enabled

### ⚠️ MQTT CONNECTION ISSUES - READ THIS FIRST ⚠️

**THIS HAS WASTED 3+ HOURS MULTIPLE TIMES. READ CAREFULLY BEFORE DEBUGGING MQTT.**

**Symptom:** Device shows as claimed but MQTT status shows "No" / "Not Connected". Mosquitto logs show CONNACK code 5 "not authorised".

**Root Cause:** The server's `syncMqttDevice()` function (called during claim at claim.routes.js:139) **FAILS SILENTLY**. The claim succeeds and returns credentials to the device, but mosquitto's password file doesn't get updated. The device has the correct password, but mosquitto has a stale/incorrect password hash.

---

## STEP-BY-STEP DIAGNOSTIC PROCEDURE (FOLLOW THIS EXACTLY)

### 1. Verify the Symptom
```bash
# Check device status
curl -s http://192.168.133.21/systemStatus | grep "MQTT Connected"
# Should show: MQTT Connected: No

# Check mosquitto logs
tail -50 /opt/homebrew/var/log/mosquitto.log | grep CONNACK
# Should show: Sending CONNACK to <MAC> (0, 5)
# Code 5 = not authorised
```

### 2. Find the Device's Credentials in Database
```bash
cd /Users/wadehargrove/Documents/server-deployment/server
node check_device_password.js
```

This shows:
- MQTT Client ID (should be MAC address without colons, e.g., D0CF13155060)
- MQTT Username (should match Client ID)
- MQTT Password (plain text, e.g., ada864908ace233590baa5d4079303e2)

### 3. Update Mosquitto Password File
```bash
# Use the EXACT password from step 2
mosquitto_passwd -b /opt/homebrew/etc/mosquitto/passwd <username> <password>

# Example:
mosquitto_passwd -b /opt/homebrew/etc/mosquitto/passwd D0CF13155060 ada864908ace233590baa5d4079303e2
```

### 4. Restart Mosquitto
```bash
brew services restart mosquitto
```

### 5. Verify Connection (wait 10 seconds for device to reconnect)
```bash
tail -50 /opt/homebrew/var/log/mosquitto.log | grep "New client connected"
# Should show: New client connected from 192.168.133.21:XXXXX as <MAC> (p2, c1, k15, u'<MAC>')

# Check device status again
curl -s http://192.168.133.21/systemStatus | grep "MQTT Connected"
# Should show: MQTT Connected: Yes
```

---

## WHY THIS KEEPS HAPPENING

**ROOT CAUSE:** Mosquitto does NOT automatically reload the password file when it changes. The server updates the file with `mosquitto_passwd`, but mosquitto keeps using the old passwords in memory until it's restarted or sent SIGHUP.

**The Sequence:**
1. Server calls `mosquitto_passwd -b /opt/homebrew/etc/mosquitto/passwd D0CF13155060 <password>`
2. Password file gets updated on disk ✅
3. Mosquitto is still using OLD password file from memory ❌
4. Device tries to connect with NEW password
5. Mosquitto rejects with CONNACK code 5 (not authorized) ❌

**Previous Code (BROKEN):**
```javascript
await syncMqttDevice(mqttUsername, mqttPassword, false); // false = don't reload
```

**Fixed Code:**
```javascript
await syncMqttDevice(mqttUsername, mqttPassword, true); // true = RELOAD MOSQUITTO
```

---

## PREVENTION

**DO NOT:**
- ❌ Enable anonymous auth (`allow_anonymous true`) - masks the problem
- ❌ Assume the claim process worked correctly
- ❌ Unclaim/reclaim repeatedly - doesn't fix the underlying issue
- ❌ Edit server TypeScript source and expect tsx watch to pick it up - it doesn't always work
- ❌ Waste time debugging network, ports, or device code - **IT'S ALWAYS THE PASSWORD SYNC**

**DO:**
- ✅ Follow the diagnostic procedure above
- ✅ Check server logs for "Failed to sync MQTT credentials" errors
- ✅ Manually update mosquitto password file after every claim
- ✅ Fix the `syncMqttDevice()` function in `src/utils/mqtt-auth.ts` to be more robust
- ✅ Add better error handling/logging to claim endpoint

---

## KEY FILES

- **Server claim endpoint:** `/Users/wadehargrove/Documents/server-deployment/server/dist/routes/claim.routes.js`
- **MQTT sync utility:** `/Users/wadehargrove/Documents/server-deployment/server/src/utils/mqtt-auth.ts`
- **Database query script:** `/Users/wadehargrove/Documents/server-deployment/server/check_device_password.js`
- **Mosquitto config:** `/opt/homebrew/etc/mosquitto/mosquitto.conf`
- **Mosquitto password file:** `/opt/homebrew/etc/mosquitto/passwd`
- **Mosquitto logs:** `/opt/homebrew/var/log/mosquitto.log`

---

## PERMANENT FIX IMPLEMENTED

**Date:** 2025-11-09
**THE ACTUAL PROBLEM:** Mosquitto doesn't reload password file automatically. Must signal mosquitto after updating passwords.

**Root Cause Analysis:**
1. Server calls `mosquitto_passwd -b /path/to/passwd username password`
2. Password file updates on disk ✅
3. Mosquitto keeps OLD passwords in memory ❌
4. Device connects with NEW password → rejected with CONNACK code 5

**The Fix (v3 - FINAL + SCALABLE):**
Use DEBOUNCED SIGHUP to handle concurrent claims:

```javascript
// src/utils/mqtt-auth.ts - reloadMosquitto()
const RELOAD_DEBOUNCE_MS = 2000; // Batch multiple claims
let reloadTimer: NodeJS.Timeout | null = null;

// Clear existing timer and schedule new reload
if (reloadTimer) clearTimeout(reloadTimer);
reloadTimer = setTimeout(() => {
  execAsync('pkill -SIGHUP mosquitto'); // One reload for multiple claims
}, RELOAD_DEBOUNCE_MS);
```

**Why Debouncing:**
- Multiple devices claiming simultaneously = multiple password updates
- Without debounce: 10 claims = 10 SIGHUP signals = potential crash
- With debounce: 10 claims in 2 seconds = 1 SIGHUP signal = stable

**Scalability:**
- ✅ Handles dozens of concurrent claims
- ✅ Mosquitto reloaded only once after all claims complete
- ✅ No race conditions or crashes
- ✅ Devices connect within 2 seconds of claim

**Changes Made:**
1. `src/routes/claim.routes.ts` line 131: Changed `false` to `true` to reload mosquitto
2. `src/utils/mqtt-auth.ts` lines 61-97: Debounced reload with 2-second timer
3. `src/routes/claim.routes.ts` lines 126-146: Fail claim if MQTT sync fails, rollback device
4. `src/utils/mqtt-auth.ts` lines 13-38: Add validation, better error handling, detailed logging

**Result:**
- Device connects immediately after claim (within 2 seconds)
- No mosquitto crashes even with dozens of concurrent claims
- No manual intervention needed
- Production-ready scalability

---

## CURRENT STATUS

**Username Format:** MAC address without colons (e.g., `D0CF13155060`)
**Server:** Port 4000 (NOT 3000 - that's the old Docker container)
**Authentication:** Enabled (`allow_anonymous false`)

**Last Incident:** 2025-11-09 - Wasted 3 hours because syncMqttDevice() failed silently during claim. Fixed by:
1. Manually running `mosquitto_passwd` with password from database
2. Implementing permanent fix (see above) to prevent silent failures

---

## MQTT Authentication Issues Checklist

When device shows "MQTT Connected: No":

1. ☐ Check mosquitto logs for CONNACK code 5
2. ☐ Query database for device's actual password using `check_device_password.js`
3. ☐ Update mosquitto password file with correct password
4. ☐ Restart mosquitto
5. ☐ Wait 10 seconds and verify connection
6. ☐ **DO NOT** waste time on anything else until you've done steps 1-5
