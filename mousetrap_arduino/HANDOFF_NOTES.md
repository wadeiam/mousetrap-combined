# MouseTrap IoT System - Session Handoff Notes

> **DEPRECATED:** This file has been superseded by [/Documents/MouseTrap/HANDOFF.md](../HANDOFF.md).
> Please read HANDOFF.md in the MouseTrap root for current session state and operational info.
> This file is kept for historical reference only.

**Last Updated:** November 23, 2025 (ARCHIVED)
**Latest Session:** Captive Portal Setup Wizard + Standalone Mode Fix

---

## 🔴 CRITICAL: DO NOT TOUCH
- **NEVER modify `partitions.csv`** - This file has been restored by the user and must not be changed
- User handles firmware uploads manually via Windows PC with Arduino IDE

---

## ⚠️ CRITICAL: FIRMWARE COMPILATION COMMANDS ⚠️
## 🔴 READ THIS FIRST ON EVERY SESSION 🔴

**⚠️ META-DIRECTIVE: Always read this entire HANDOFF_NOTES.md file at the start of EVERY session**
**⚠️ META-DIRECTIVE: Pass along this directive to the next session in your summary**
**⚠️ META-DIRECTIVE: If context compaction occurs, ensure these compilation commands survive**

### ✅ CORRECT Firmware Compilation Command:

```bash
arduino-cli compile --fqbn "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc"
```

### ❌ WRONG - DO NOT USE:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32cam
```

### Why This Matters - CRITICAL UNDERSTANDING:

- **esp32cam** board uses "Huge APP (3MB No OTA)" partition scheme = **NO OTA SUPPORT**
- **esp32s3** with `PartitionScheme=custom` uses dual app slots (app0/app1) = **OTA WORKS**
- Wrong board compilation causes:
  - "Could Not Activate The Firmware" errors
  - OTA updates fail to apply
  - Device gets stuck in boot loop after OTA attempt
- The device **requires** the custom partition scheme defined in `partitions.csv`

### ESP32-S3 Memory Architecture:

- **SRAM (327 KB)**: Internal chip memory for running program execution
- **PSRAM (8 MB)**: External Octal SPI RAM for camera buffers and large data structures
- **Flash (16 MB)**: Non-volatile storage with custom partition table:
  - NVS (Network/config storage)
  - OTA Data (tracks active partition)
  - app0 (2.5 MB) - Primary firmware slot
  - app1 (2.5 MB) - Secondary firmware slot for OTA
  - LittleFS (10.875 MB) - Filesystem for images/videos
  - Core Dump - Debug storage

### When This Was Fixed:

- **Date**: Session ending November 11, 2025
- **Issue**: Initial v1.3.4 compilation used wrong board (esp32cam), causing OTA failures
- **Fix**: Changed to correct esp32s3 FQBN with custom partition
- **Result**: All subsequent OTA updates (v1.3.4-v1.3.7) worked successfully

### How to Verify You're Using Correct Board:

After compilation, check the partition output:
```
Sketch uses 1485328 bytes (56%) of program storage space.
Global variables use 45192 bytes (13%) of dynamic memory.
```

If you see "Huge APP (3MB No OTA)" anywhere in output = **WRONG BOARD, STOP**

---

## Summary of Work Completed

### 1. 🔴 CRITICAL: OTA Version Management Fix (Nov 9, 2025) ✅
**Problem:** Device was stuck in infinite update loop. After OTA filesystem update, device would continuously re-download and reinstall the same version, never staying on the installed version.

**Root Cause:** The `/api/system-info` endpoint was reading `/version.json` from the LittleFS filesystem **on every API call**, overriding the version stored in NVS Preferences (which is set by MQTT OTA updates). This caused:
1. Device receives MQTT update for v2.0.25
2. Downloads and installs littlefs.bin
3. Saves "v2.0.25" to Preferences
4. Reboots
5. API endpoint reads `/version.json` from filesystem (contains "v2.0.24")
6. Compares v2.0.24 < v2.0.25 from MQTT
7. Downloads again... infinite loop

**Solution Applied:**
Removed ALL version.json reading from firmware. Version flow is now strictly:
```
MQTT Update → saveVersion() → NVS Preferences → currentFilesystemVersion → API Response
```

**Files Modified:**
- `/mousetrap_arduino.ino:6998-6999` - Removed version.json reading, now uses only `currentFilesystemVersion`
- `/mousetrap_arduino.ino:7001-7003` - Made timestamps unconditional (always included, even when 0)
- `/mousetrap_arduino.ino:1309-1322` - Version loading on boot (Preferences → fallback constant, NO version.json)

**Code Changes:**
```cpp
// BEFORE (WRONG):
File versionFile = LittleFS.open("/version.json", "r");
if (versionFile) {
  fsVersion = versionDoc["version"].as<String>();  // Override Preferences!
}

// AFTER (CORRECT):
doc["filesystemVersion"] = currentFilesystemVersion;  // From Preferences only
```

**Verification:**
- Device successfully updates via MQTT OTA
- Device stays on installed version after reboot
- No more infinite update loops
- Timestamps always display (0 shows as "Never" in frontend)

**Backend Changes:**
- `/server/src/services/mqtt.service.ts:563-582` - Added public `clearRetainedMessage()` method
- `/server/src/routes/firmware.routes.ts:495-560` - DELETE endpoint now clears MQTT retained messages
- Smart behavior: If newer version exists, republish it; otherwise clear message

**Helper Scripts:**
- `/server/clear-mqtt-retained.js` - Updated to include global topics
- `/server/republish-latest-firmware.js` - Republishes latest versions to MQTT

**Critical Understanding:**
⚠️ **NEVER read version.json after OTA installation.** The version in the filesystem file is STALE and represents what was built into the littlefs image. The AUTHORITATIVE version is in NVS Preferences, set by the MQTT OTA process using the version from the server's database.

---

### 2. Bidirectional Alert System - Complete ✅ (Nov 11, 2025)

**Problem:** Alerts created on devices needed to sync to server, and alerts cleared on server needed to clear on device.

**Solution Implemented:**

**Alert Flow (Device → Server):**
1. Device detects motion/trigger event
2. Publishes alert to `tenant/{tenantId}/device/{MAC}/alert` topic
3. Server's mqtt.service.ts receives alert (lines 571-610)
4. Creates alert record in `device_alerts` database table
5. Dashboard displays alert in real-time

**Alert Clearing Flow (Server → Device → Server):**
1. User clicks "Resolve" in dashboard
2. Frontend calls `POST /api/alerts/:id/resolve`
3. Server updates alert status to 'resolved' in database
4. Server sends `alert_reset` command via MQTT (alerts.routes.ts:214-221)
5. Device receives command in mqttCallback() (mousetrap_arduino.ino:1595-1617)
6. Device clears local state: `detectionState = false`, `lastAlertTime = 0`
7. Device publishes confirmation to `alert_cleared` topic
8. Server receives confirmation and logs success

**Files Modified:**

- `/mousetrap_arduino.ino:1550-1553` - Added extern declarations for alert variables
- `/mousetrap_arduino.ino:1595-1617` - Added alert_reset command handler in mqttCallback
- `/server/src/routes/alerts.routes.ts:214-221` - Server sends alert_reset on resolve
- `/server/src/services/mqtt.service.ts:571-610` - Handles alert_cleared confirmations

**Firmware Versions:**
- **v1.3.4**: Fixed OTA partition, added MQTT alert publishing
- **v1.3.5**: Fixed alert topic to use MAC without colons
- **v1.3.6**: Added bidirectional alert clearing (alert_reset handler)
- **v1.3.7**: Fixed MQTT connection status display

**Database Table:**
```sql
device_alerts (
  id UUID,
  device_id UUID,
  tenant_id UUID,
  alert_type VARCHAR,
  alert_status VARCHAR (new/acknowledged/resolved),
  severity VARCHAR,
  message TEXT,
  triggered_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  acknowledged_by UUID,
  resolved_at TIMESTAMP,
  resolved_by UUID
)
```

**MQTT Topics:**
- `tenant/{tenantId}/device/{MAC}/alert` - Device publishes alerts
- `tenant/{tenantId}/device/{MAC}/command/alert_reset` - Server commands device to clear
- `tenant/{tenantId}/device/{MAC}/alert_cleared` - Device confirms clearing

**Verification:** Tested end-to-end on Kitchen device (192.168.133.46, MAC: 94A990306028)
- Alert created successfully on device trigger
- Alert appeared in dashboard instantly
- Alert resolved from dashboard
- Device received alert_reset command
- Device cleared local state
- Device sent alert_cleared confirmation
- **ALL SYSTEMS WORKING PERFECTLY** ✅

---

### 3. MQTT Connection Status Display Fix ✅ (Nov 11, 2025)

**Problem:** `/debug` endpoint showed "MQTT: Disconnected" even though device was actually connected (broker logs showed active ping/pong).

**Root Cause:** PubSubClient library's `connected()` method is unreliable - it only checks an internal flag that can be out of sync with actual TCP connection state.

**Solution:** Implemented custom connection state tracking based on actual events:

**Files Modified:**
- `/mousetrap_arduino.ino:352-353` - Added connection state tracking variables:
  ```cpp
  static bool mqttReallyConnected = false;
  static unsigned long lastMqttActivity = 0;
  ```

- `/mousetrap_arduino.ino:1562-1563` - Update state on message receipt:
  ```cpp
  mqttReallyConnected = true;
  lastMqttActivity = millis();
  ```

- `/mousetrap_arduino.ino:1681` - Clear state on connection failure:
  ```cpp
  mqttReallyConnected = false;
  ```

- `/mousetrap_arduino.ino:1703-1704` - Set state on successful connection:
  ```cpp
  mqttReallyConnected = true;
  lastMqttActivity = millis();
  ```

- `/mousetrap_arduino.ino:5027` - Updated display to use new flag
- `/mousetrap_arduino.ino:7137` - Updated JSON API to use new flag

**Verification:** Device now correctly reports connection status matching broker logs.

---

### 4. Captive Portal Setup Wizard Fix ✅ (Nov 23, 2025)

**Problem:** Captive portal setup wizard on iPhone wasn't communicating with device. API calls silently failed.

**Root Cause:** On iPhone, the captive portal browser uses `window.location.origin` which returns `http://captive.apple.com` (or similar redirect URL) instead of the device's actual IP `http://192.168.4.1`. This caused all `fetch()` calls to go to the wrong server.

**Solution:** Added `getBaseUrl()` function in `trap-spa/src/lib/api.js` to detect captive portal mode:

```javascript
// trap-spa/src/lib/api.js:6-15
function getBaseUrl() {
  const origin = window.location.origin;
  // Check if we're on a captive portal redirect (not a local IP)
  if (origin.includes('192.168.') || origin.includes('localhost') || origin.includes('mousetrap.local')) {
    return origin;
  }
  // In captive portal mode, fall back to the device's AP IP
  console.log('[API] Captive portal detected, using 192.168.4.1 instead of:', origin);
  return 'http://192.168.4.1';
}
```

**Files Modified:**
- `trap-spa/src/lib/api.js:6-17` - Added `getBaseUrl()` detection

**Verification:** API calls now correctly target `192.168.4.1` when in captive portal mode.

---

### 5. Standalone Mode Implementation ✅ (Nov 23, 2025)

**Problem:** Users needed a way to configure WiFi without cloud registration (for debugging/development).

**Solution:** Added standalone mode that:
1. Saves WiFi credentials to NVS
2. Sets `standalone=true` flag in NVS
3. On boot, skips DNS captive portal redirect (allows direct IP access)
4. Device connects to WiFi but doesn't require cloud registration

**Firmware Changes:**

- Added global variable: `static bool standaloneMode = false;`
- Modified `loadWiFiCredentials()` to read standalone flag from NVS
- Modified boot logic to skip DNS server when `standaloneMode=true`:
  ```cpp
  if (!standaloneMode) {
    dnsServer.start(DNS_PORT, "*", apIP);
    Serial.println("[AP MODE] DNS server started for captive portal");
  } else {
    Serial.println("[AP MODE] Standalone mode - DNS server skipped, browse to http://192.168.4.1");
  }
  ```

**SPA Changes:**
- Added `/api/setup/standalone` endpoint call in Setup.svelte
- Added "Use Standalone Mode" button on WiFi step

**API Endpoint:** `POST /api/setup/standalone`
```json
{
  "ssid": "NetworkName",
  "password": "password"
}
```

**Verification:** Device connects to WiFi and is accessible via IP without captive portal redirect.

---

### 6. Critical Bug: Preferences Namespace ⚠️

**Issue Found:** Multiple endpoints were using wrong Preferences object.

**Problem Code:**
```cpp
preferences.begin("wifi", false);  // WRONG - uses 'preferences' not 'devicePrefs'
```

**Correct Code:**
```cpp
devicePrefs.begin("wifi", false);  // CORRECT - uses 'devicePrefs'
```

**Affected Endpoints (Fixed Nov 23, 2025):**
- `/api/setup/standalone` - Was using `preferences`, now uses `devicePrefs`
- `processPendingSetup()` - Was using `preferences`, now uses `devicePrefs`

**Important:** The firmware has multiple Preferences objects:
- `devicePrefs` - Main config storage (wifi, mqtt, claimed status)
- `preferences` - Different/legacy namespace

Always use `devicePrefs` for WiFi and claim-related storage.

---

### 7. Logging Best Practices ⚠️

**Issue Found:** Setup endpoints were using `Serial.println()` which only shows in serial monitor, not in system logs visible via SPA.

**Problem:**
```cpp
Serial.println("[SETUP] Message");  // Only visible via USB serial
```

**Solution:**
```cpp
addSystemLog("[SETUP] Message");    // Visible in /api/system-logs and SPA
Serial.println("[SETUP] Message");  // Also print to serial for debugging
```

**Rule:** Always use `addSystemLog()` for important log messages that users need to see. Add `Serial.println()` as well for USB debugging.

**Files Modified (Nov 23, 2025):**
- `/api/setup/connect` endpoint - Added comprehensive `addSystemLog()` calls

**System Log Tags Used:**
- `[SETUP-CONNECT]` - Captive portal registration flow
- `[STANDALONE]` - Standalone mode activation
- `[BOOT]` - Boot-time messages
- `[MQTT]` - MQTT connection events
- `[CLAIMING]` - Device claiming mode

---

### 8. Two-Generation Log Rotation ✅ (Nov 23, 2025)

**Problem:** When troubleshooting multi-reboot flows (e.g., registration → reboot → standalone → reboot), the registration attempt logs were lost because rotateLogs() only kept one generation of previous logs.

**Solution:** Implemented two-generation log rotation:
- `logs.txt` - Current session logs
- `prevLogs.txt` - Previous boot logs (1 boot ago)
- `prevLogs2.txt` - Older logs (2 boots ago)

**Files Modified:**
- `mousetrap_arduino.ino:6102-6119` - rotateLogs() now rotates prevLogs.txt → prevLogs2.txt
- `mousetrap_arduino.ino:8368-8391` - Added `/api/older-logs` endpoint
- `trap-spa/src/lib/api.js:307-311` - Added getOlderLogs()
- `trap-spa/src/pages/Logs.svelte` - Added "Older Logs (2 boots ago)" collapsible section

**rotateLogs() Code:**
```cpp
void rotateLogs() {
  if (LittleFS.exists("/logs.txt")) {
    // Rotate: prevLogs.txt → prevLogs2.txt (keep 2 generations)
    LittleFS.remove("/prevLogs2.txt");
    if (LittleFS.exists("/prevLogs.txt")) {
      LittleFS.rename("/prevLogs.txt", "/prevLogs2.txt");
    }
    LittleFS.rename("/logs.txt", "/prevLogs.txt");
  }
  File f = LittleFS.open("/logs.txt", "w");
  if (f) f.close();
}
```

**Use Case:** Troubleshoot captive portal registration flow:
1. Attempt cloud registration via captive portal
2. Device reboots → registration logs now in prevLogs.txt
3. Enable standalone mode to access device
4. Device reboots → registration logs now in prevLogs2.txt, standalone logs in prevLogs.txt
5. Check "Older Logs (2 boots ago)" section to see what happened during registration

---

### 9. Fixed Mosquitto MQTT Authentication Configuration ✅
**Problem:** Mosquitto was running with default config (everything commented out), so password authentication was disabled. Devices couldn't connect (rc=5: not authorized).

**Solution:** Created proper Mosquitto configuration at `/opt/homebrew/etc/mosquitto/mosquitto.conf`:
```conf
listener 1883
allow_anonymous false
password_file /opt/homebrew/etc/mosquitto/passwd
log_dest file /opt/homebrew/var/log/mosquitto.log
log_type all
persistence true
persistence_location /opt/homebrew/var/lib/mosquitto/
```

**Files Modified:**
- `/opt/homebrew/etc/mosquitto/mosquitto.conf` (created new config, replaced symlink)

**Verification:**
- Mosquitto logs: `/opt/homebrew/var/log/mosquitto.log`
- Password file: `/opt/homebrew/etc/mosquitto/passwd`
- Restart: `brew services restart mosquitto`

**Additional MQTT Commands Added:**
- `clear_versions` - Clears all NVS Preferences version data and reboots (useful for testing fresh OTA)

**Latest Firmware Binary:**
- Location: `/mousetrap_arduino/build/mousetrap_arduino.ino.bin`
- Compiled: Nov 9, 2025 6:12 PM
- Size: 1.4M
- Includes: Version.json fix, timestamp fix, clear_versions command

---

### 5. MQTT Reboot Command - Working ✅
**Problem:** Reboot command wasn't working initially due to MQTT auth issues (now resolved).

**Current State:**
- Server endpoint: `POST /api/devices/:id/reboot`
- Device firmware handles `{"command":"reboot"}` payload
- Successfully tested - device reboots in ~8 seconds and reconnects

**Location in Code:**
- Server: `/server/src/routes/devices.routes.ts:308-350`
- Device: `/mousetrap_arduino.ino:1513-1514`

---

### 6. Dashboard Real-Time Updates ✅
**Problem:** Dashboard showed stale device status until manual refresh.

**Solution:** Added polling intervals to React Query hooks:
- Device list: 5 second interval
- Device detail: 3 second interval

**Files Modified:**
- `/trap-dashboard/src/hooks/useDevices.ts:15` - Added `refetchInterval: 5000`
- `/trap-dashboard/src/hooks/useDevices.ts:27` - Added `refetchInterval: 3000`

---

### 7. Device Unclaim Sync Flow ✅
**Implementation:** Complete bidirectional unclaim synchronization

**Flow:**
1. **Device → Server:** Device calls `POST /api/device/unclaim-notify` with MAC address
2. **Server Actions:**
   - Sets `unclaimed_at = NOW()` in database (soft delete, 6-month retention)
   - Removes MQTT credentials from Mosquitto passwd file
   - Does NOT delete device record (keeps for historical data)
3. **MQTT Rejection:** Mosquitto rejects reconnection attempts (rc=5)
4. **Dashboard Update:** Device disappears from list (filtered by `unclaimed_at IS NULL`)
5. **Re-claim Support:** Old unclaimed records deleted before fresh claim

**Files Modified:**
- `/server/src/routes/claim.routes.ts:353-414` - Unclaim notify endpoint
- `/server/src/routes/claim.routes.ts:68-83` - Handle re-claiming unclaimed devices
- `/server/src/routes/devices.routes.ts` - Filter queries by `unclaimed_at IS NULL`
- `/server/src/utils/mqtt-auth.ts:45-65` - `removeMqttDevice()` function
- `/mousetrap_arduino.ino:1148-1195` - `unclaimDevice()` function

**Database Migration:**
```sql
ALTER TABLE devices ADD COLUMN unclaimed_at TIMESTAMP DEFAULT NULL;
CREATE INDEX idx_devices_unclaimed ON devices(unclaimed_at);
```

**Cleanup Job:** `/server/src/jobs/cleanup-unclaimed-devices.ts`
- Runs daily at 2 AM
- Deletes devices with `unclaimed_at` older than 6 months

---

### 8. MAC Address Retrieval - RESOLVED ✅
**Problem:** Device initially sent `macAddress: "00:00:00:00:00:00"` during claim.

**Root Cause:** `WiFi.macAddress()` returned empty string when called before WiFi hardware initialization.

**Solution Applied:**
- Use `esp_read_mac()` low-level function instead of `WiFi.macAddress()`
- Reads MAC directly from hardware at boot (before WiFi connection)

**Status:** ✅ RESOLVED - Devices now correctly report MAC addresses (e.g., 94:A9:90:30:60:28)

---

### 9. Firmware Rate Limiting for Crash Prevention ✅
**Problem:** Device crash loop when MQTT auth fails repeatedly.

**Solution:** Added rate limiting to claim-status checks (once per minute max).

**Files Modified:**
- `/mousetrap_arduino.ino:1568-1570` - Rate limiting logic

**Code:**
```cpp
static unsigned long lastClaimStatusCheck = 0;
if (millis() - lastClaimStatusCheck > 60000) {
  lastClaimStatusCheck = millis();
  // Check claim status
}
```

---

## Debug Instrumentation Available

The firmware includes comprehensive debugging tools accessible via `/debug` endpoint:

### Features
- **Memory Usage Tracking** - Heap and PSRAM with color-coded warnings
- **Framebuffer Leak Detection** - Tracks camera buffer allocations/releases
- **I2C Health Monitoring** - VL6180X sensor communication reliability
- **Task Stack Monitoring** - Prevents FreeRTOS stack overflow crashes
- **CrashKit** - Breadcrumbs and system state that survive reboots (RTC memory)
- **Context Snapshots** - System state before critical operations

### Access
- URL: `http://<device-ip>/debug`
- Requires authentication (ops credentials)
- Auto-refreshes every 5 seconds
- JSON API: `http://<device-ip>/api/debug-stats`

### Debug Headers
- `debug_framebuffer.h` - Camera buffer tracking
- `debug_i2c.h` - I2C transaction monitoring
- `debug_tasks.h` - FreeRTOS task stack usage
- `debug_crashkit.h` - Crash context with breadcrumbs
- `debug_context.h` - Pre-operation snapshots
- `debug_dashboard.h` - Web UI for debug data

**See:** `DEBUG_INSTRUMENTATION.md` for complete documentation

---

## Svelte SPA Deployment Workflow

The device serves a local Svelte SPA from LittleFS partition (~11MB).

### Build Process
```bash
cd trap-spa
npm run build           # Build Svelte app to dist/
cd ..
./build-littlefs.sh     # Create littlefs.bin image
```

### Deployment
- **Cloud Dashboard**: Upload `build/littlefs.bin` as "filesystem" type
- **ElegantOTA**: Manual upload to `http://<device-ip>/update`

### Version Management
- Filesystem version stored in NVS Preferences (separate from firmware version)
- Version file: `trap-spa/dist/version.json`
- Format: `"1.2.0"` (semantic versioning)

**Important:** LittleFS partition uses **SPIFFS SubType (0x82)** for OTA compatibility. This is intentional - don't change it to `littlefs` subtype or OTA will fail.

**See:** `SPA_DEPLOYMENT.md` for complete guide

---

## System Credentials

**Dashboard Login:**
- URL: http://192.168.133.110:5173
- Email: `admin@mastertenant.com`
- Password: `Admin123!`

**Device OTA:**
- Username: `ops`
- Password: `changeme`

---

## System Architecture

### MQTT Broker (Mosquitto)
- **Location:** Homebrew installation on Mac (`/opt/homebrew`)
- **Config:** `/opt/homebrew/etc/mosquitto/mosquitto.conf`
- **Passwords:** `/opt/homebrew/etc/mosquitto/passwd`
- **Logs:** `/opt/homebrew/var/log/mosquitto.log`
- **Control:** `brew services restart mosquitto`

### Server (Node.js/TypeScript)
- **Location:** `/Users/wadehargrove/Documents/server-deployment/server`
- **Process Manager:** PM2 (`pm2 logs mqtt-server`)
- **Port:** 4000
- **Database:** PostgreSQL

### Dashboard (React/Vite)
- **Location:** `/Users/wadehargrove/Documents/server-deployment/trap-dashboard`
- **Tech:** React Query, Vite, TypeScript

### Device Firmware (ESP32-CAM)
- **Location:** `/Users/wadehargrove/Documents/Arduino/mousetrap_arduino/mousetrap_arduino.ino`
- **⚠️ DO NOT TOUCH:** `partitions.csv` in same directory
- **Upload Process:** User copies folder to Windows PC → Arduino IDE → Upload

---

## Key Database Tables

### `devices`
- `id` - UUID primary key
- `tenant_id` - Foreign key to tenants
- `mqtt_client_id` - Used for MQTT connection (should be MAC without colons)
- `mqtt_username` - Format: `device_{first8charsOfUUID}`
- `mqtt_password` - Bcrypt hash
- `mqtt_password_plain` - Plaintext (for Mosquitto sync)
- `unclaimed_at` - Timestamp when device was unclaimed (NULL = claimed)
- `claimed_at` - Timestamp when device was claimed
- `last_seen` - Last heartbeat timestamp
- `online` - Boolean status

### `claim_codes`
- `claim_code` - 8-character alphanumeric (no ambiguous chars)
- `tenant_id` - Which tenant owns this code
- `device_name` - Name to assign to device
- `status` - 'active' | 'claimed' | 'expired'
- `expires_at` - 7 days from creation
- `claimed_by_device_id` - Links to device after claim

---

## API Endpoints

### Claim/Unclaim (No Auth Required)
- `POST /api/devices/claim` - Device claim with code
- `GET /api/device/claim-status?mac={MAC}` - Check if device is claimed
- `POST /api/device/unclaim-notify` - Device notifies server of unclaim

### Admin (Auth Required)
- `POST /api/admin/claim-codes` - Generate claim code
- `GET /api/admin/claim-codes` - List all claim codes
- `GET /api/admin/devices` - List all devices

### Device Management (Auth Required)
- `GET /api/devices` - List claimed devices (filters `unclaimed_at IS NULL`)
- `GET /api/devices/:id` - Get device details
- `POST /api/devices/:id/reboot` - Reboot device
- `POST /api/devices/:id/unclaim` - Unclaim device (dashboard-initiated)

---

## MQTT Topics

### Device → Server
- `tenant/{tenantId}/device/{clientId}/status` - Device status updates
- `tenant/{tenantId}/device/{clientId}/ota/progress` - OTA update progress
- `tenant/{tenantId}/device/{MAC}/alert` - Alert notifications (motion detected, etc.)
- `tenant/{tenantId}/device/{MAC}/alert_cleared` - Confirmation that device cleared alert

### Server → Device
- `tenant/{tenantId}/device/{clientId}/command/reboot` - Reboot command
- `tenant/{tenantId}/device/{clientId}/command/alert_reset` - Clear alert on device
- `tenant/{tenantId}/device/{clientId}/command/{cmd}` - Other commands
- `tenant/{tenantId}/device/{clientId}/ota/firmware` - OTA firmware update

---

## Troubleshooting

### OTA Update Loop / Device Won't Stay on New Version
**Cause:** version.json being read from filesystem, overriding NVS Preferences
**Symptoms:**
- Device downloads update successfully
- Reboots but immediately downloads again
- Serial logs show repeated "[OTA] New filesystem available"
- Never stays on installed version

**Fix:** ✅ RESOLVED - Firmware no longer reads version.json
**Verify:**
- Check `/mousetrap_arduino.ino` around line 6998
- Should see: `doc["filesystemVersion"] = currentFilesystemVersion;`
- Should NOT see: `LittleFS.open("/version.json")`

### Stale MQTT Retained Messages
**Cause:** Deleted firmware versions still have retained messages on MQTT broker
**Symptoms:**
- Dashboard shows version X deleted
- Devices still receive update notifications for version X
- MQTT broker has old retained message

**Fix:**
```bash
# Clear stale retained messages
cd /server
node clear-mqtt-retained.js

# Republish current versions
node republish-latest-firmware.js
```

**Prevention:** DELETE endpoint now automatically handles this (Nov 9, 2025)

### Timestamps Show "Invalid Date"
**Cause:** Backend not including timestamp fields when value is 0
**Fix:** ✅ RESOLVED - Timestamps always included now
**Code:** `/mousetrap_arduino.ino:7001-7003`
```cpp
doc["firmwareUpdateTime"] = firmwareUpdateTimestamp;  // Always include, even if 0
doc["filesystemUpdateTime"] = filesystemUpdateTimestamp;
```

### Device Shows 000000000000
**Cause:** MAC address not initialized in firmware
**Fix:** Upload latest firmware with `esp_read_mac()` fix
**Verify:** Check serial logs for `[SETUP] MAC address: D0:CF:13:15:50:60`

### MQTT Connection Failed (rc=5)
**Cause:** Authentication failure
**Check:**
1. Mosquitto config has `allow_anonymous false` and `password_file` set
2. Device credentials in `/opt/homebrew/etc/mosquitto/passwd`
3. Mosquitto restarted after credential changes
4. Mosquitto logs: `tail -f /opt/homebrew/var/log/mosquitto.log`

### Device Won't Claim
**Causes:**
1. Claim code expired (7 days)
2. Device already claimed (check `unclaimed_at IS NULL`)
3. MAC address issue (check server logs for `macAddress` value)

**Fix:**
- Generate new claim code
- If re-claiming, old unclaimed record should be auto-deleted
- Check server logs: `pm2 logs mqtt-server | grep CLAIM`

### Dashboard Shows Stale Data
**Cause:** React Query polling not working
**Verify:** Check `refetchInterval` in `/trap-dashboard/src/hooks/useDevices.ts`
**Expected:** Device list polls every 5s, detail page every 3s

### Device Crash Loop
**Cause:** MQTT auth failures triggering rapid claim-status checks
**Fix:** Firmware has rate limiting (once per minute)
**Verify:** Serial logs should show `[MQTT] ⚠ Authentication failed` but only once per minute

### ⚠️ MQTT Connection Fails After Claim (CONNACK Code 5)
**THIS IS THE #1 TIME WASTER - READ CAREFULLY**

**Symptom:** Device shows as claimed but MQTT shows "Not Connected". Mosquitto logs show `CONNACK code 5 "not authorised"`.

**Root Cause:** Mosquitto doesn't automatically reload password file after updates. The claim succeeds and device has correct password, but Mosquitto still uses old password in memory.

**Quick Fix:**
```bash
# 1. Get device password from database
cd /Users/wadehargrove/Documents/server-deployment/server
node check_device_password.js

# 2. Update mosquitto password file with EXACT password from database
mosquitto_passwd -b /opt/homebrew/etc/mosquitto/passwd <MAC_ADDRESS> <PASSWORD>

# 3. Restart mosquitto
brew services restart mosquitto

# 4. Wait 10 seconds and verify connection
```

**Permanent Fix (Applied Nov 9, 2025):**
- Server now sends SIGHUP to Mosquitto after password updates
- Uses debounced reload (2-second timer) to handle concurrent claims
- Located in: `/server/src/utils/mqtt-auth.ts`

**Prevention:**
- ❌ DO NOT enable anonymous auth - masks the problem
- ❌ DO NOT waste time debugging network/ports - it's always the password sync
- ✅ Check Mosquitto logs first: `tail -f /opt/homebrew/var/log/mosquitto.log`
- ✅ Always verify password file matches database

**See:** `ESP32_SETTINGS_REFERENCE.md` lines 494-680 for complete diagnostic procedure

---

## Important File Locations

### Mac (Development/Server)
```
/opt/homebrew/etc/mosquitto/mosquitto.conf  # Mosquitto config
/opt/homebrew/etc/mosquitto/passwd          # MQTT credentials
/opt/homebrew/var/log/mosquitto.log         # MQTT broker logs
/Users/wadehargrove/Documents/server-deployment/server/  # Node.js server
/Users/wadehargrove/Documents/server-deployment/trap-dashboard/  # React dashboard
/Users/wadehargrove/Documents/Arduino/mousetrap_arduino/  # Firmware source
```

### Windows (Firmware Upload)
- User copies entire `mousetrap_arduino` folder to Windows
- Opens `.ino` file in Arduino IDE
- **Must verify timestamp matches before upload**
- Arduino IDE: Sketch → Clean → Upload

---

## Next Steps / Pending Tasks

1. **🔴 CRITICAL: Upload MAC Address Fix**
   - Latest firmware in `/mousetrap_arduino/mousetrap_arduino.ino`
   - Includes `esp_read_mac()` fix
   - Verify `[SETUP] MAC address:` appears in serial logs

2. **Test Complete Claim/Unclaim Cycle**
   - Unclaim device
   - Verify MQTT rejection (rc=5)
   - Verify dashboard updates (device disappears)
   - Generate new claim code
   - Claim with real MAC address
   - Verify dashboard shows actual MAC

3. **Monitor 6-Month Cleanup Job**
   - First run scheduled for next 2 AM
   - Check logs in `/server/src/jobs/cleanup-unclaimed-devices.ts`

---

## Known Issues

### Partitions.csv
- **⚠️ RESTORED BY USER - DO NOT MODIFY**
- This file controls ESP32 flash memory layout
- Modifying it can brick the device
- User has working version in place

### Device Firmware Upload Process
- User must manually copy to Windows PC
- Arduino IDE cache can cause issues
- Always verify file timestamp before upload
- Use "Sketch → Clean" if build seems cached

---

## Success Criteria Checklist

- [x] Mosquitto authentication configured and working
- [x] MQTT reboot command working
- [x] Dashboard real-time updates (3-5s polling)
- [x] Unclaim sync flow (device → server → MQTT → dashboard)
- [x] Database migration for `unclaimed_at` column
- [x] Cleanup job for 6-month retention
- [x] Firmware rate limiting for crash prevention
- [x] **OTA version management infinite loop fixed** ✅ Nov 9, 2025
- [x] **Firmware/filesystem timestamps always displayed** ✅ Nov 9, 2025
- [x] **MQTT retained message management** ✅ Nov 9, 2025
- [x] **MAC address fix uploaded and verified** ✅ RESOLVED
- [x] **Bidirectional alert system** ✅ Nov 11, 2025
- [x] **MQTT connection status display fix** ✅ Nov 11, 2025

---

## Commands Reference

### MQTT Commands to Device
```bash
# Reboot device
mosquitto_pub -h 192.168.133.110 -t 'tenant/{tenantId}/device/{macWithoutColons}/command/reboot' \
  -u mqtt_client -P mqtt_password123 -m '{"command":"reboot"}'

# Clear version preferences (useful for testing OTA)
mosquitto_pub -h 192.168.133.110 -t 'tenant/{tenantId}/device/{macWithoutColons}/command/clear_versions' \
  -u mqtt_client -P mqtt_password123 -m '{"command":"clear_versions"}'

# Check MQTT retained message
mosquitto_sub -h 192.168.133.110 -t 'global/filesystem/latest' \
  -u mqtt_client -P mqtt_password123 -C 1
```

### Mosquitto
```bash
# Restart broker
brew services restart mosquitto

# View logs
tail -f /opt/homebrew/var/log/mosquitto.log

# Check password file
cat /opt/homebrew/etc/mosquitto/passwd

# Add MQTT user (done by server automatically)
mosquitto_passwd /opt/homebrew/etc/mosquitto/passwd device_username
```

### Server
```bash
# View logs
pm2 logs mqtt-server

# Restart server
cd /Users/wadehargrove/Documents/server-deployment/server
pm2 restart mqtt-server

# Rebuild after code changes
npm run build
pm2 restart mqtt-server
```

### Dashboard
```bash
# Rebuild
cd /Users/wadehargrove/Documents/server-deployment/trap-dashboard
npm run build

# Development
npm run dev
```

### Database
```bash
# Check devices
psql -h localhost -U wadehargrove -d mousetrap_db
SELECT name, mqtt_client_id, unclaimed_at FROM devices;

# Check claim codes
SELECT claim_code, device_name, status, expires_at FROM claim_codes;
```

---

## Contact Points for Issues

1. **Device won't connect to MQTT**
   - Check Mosquitto logs first
   - Verify credentials in passwd file
   - Check device serial logs for rc code

2. **Dashboard not updating**
   - Check React Query polling intervals
   - Verify server is running (pm2 list)
   - Check MQTT broker is running

3. **Claim/Unclaim not working**
   - Check server logs for detailed error messages
   - Verify database `unclaimed_at` column exists
   - Check MQTT credential sync

---

## Related Documentation

This handoff file contains the most critical information for ongoing development. For specialized topics, see:

- **`DEBUG_INSTRUMENTATION.md`** - Comprehensive guide to debug tools, dashboard, and crash analysis
- **`SPA_DEPLOYMENT.md`** - Complete Svelte SPA build and deployment workflow
- **`ESP32_SETTINGS_REFERENCE.md`** - Arduino CLI FQBN settings, partition scheme, MQTT auth troubleshooting, OTA process, system credentials

**⚠️ META-DIRECTIVE:** When context compaction occurs, ensure these documentation files are mentioned in the summary so future sessions know where to find detailed information.

---

**End of Handoff Notes**
