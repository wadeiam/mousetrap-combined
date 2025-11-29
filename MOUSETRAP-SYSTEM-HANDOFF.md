# MouseTrap Session Handoff

**Last Updated:** 2025-11-29
**Latest Session:** Two-phase setup wizard with WiFi test-first flow

---

## READ THIS FIRST

**IMPORTANT FOR NEW SESSIONS:** Always read this entire document before beginning any work. This document contains critical information that prevents costly mistakes.

**AI ASSISTANTS:** You are responsible for maintaining all project documentation. When you make changes to any component, update the corresponding `.md` file in the relevant `docs/` folder. Update this HANDOFF.md at the end of each session with significant changes. See "End of Session Checklist" and "Documentation Links" below for the full documentation structure.

This is the primary handoff document for MouseTrap development sessions. It contains:
1. **Persistent operational info** - Commands, credentials, critical warnings
2. **Current session state** - Latest work and pending tasks
3. **Links to detailed documentation** - For specific topics

**For documentation navigation:** See [DOCUMENTATION-SYSTEM-GUIDE.md](./DOCUMENTATION-SYSTEM-GUIDE.md)

---

## CRITICAL WARNINGS

### DO NOT MODIFY `partitions.csv`
- User manages this file
- Modifying can brick devices
- Requires USB access to recover

### ALWAYS USE CORRECT COMPILATION
```bash
cd /Users/wadehargrove/Documents/MouseTrap/mousetrap_arduino
make compile
```

### NEVER USE WRONG BOARD
```bash
# WRONG - DO NOT USE - causes OTA failures
arduino-cli compile --fqbn esp32:esp32:esp32cam
```

### LITTLEFS OFFSET IS 0x510000
- Always use `make upload-fs` for filesystem uploads
- DO NOT use 0x370000 or any other address

---

## Persistent Operational Info

### Firmware Compilation

**Correct FQBN:**
```
esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=921600,DebugLevel=none,EraseFlash=none,USBMode=hwcdc
```

**Commands:**
```bash
# Compile firmware
cd /Users/wadehargrove/Documents/MouseTrap/mousetrap_arduino
make compile

# Upload firmware via serial (auto-detect port, 921600 baud)
make upload

# Upload with lower baud rate (more reliable)
arduino-cli upload -p /dev/cu.usbserial-10 --fqbn "esp32:esp32:esp32s3:..." -UploadSpeed=115200 .

# Deploy firmware OTA
curl -u "ops:changeme" -F "file=@build/mousetrap_arduino.ino.bin" http://192.168.133.46/uploadfw
```

### Serial Monitoring

**Baud Rate:** 115200

```bash
# Via Makefile
make monitor

# Via arduino-cli
arduino-cli monitor -p /dev/cu.usbserial-10 -c baudrate=115200
```

### LittleFS (SPA) Deployment

```bash
# Build LittleFS image from trap-spa
make build-fs

# Upload to device via serial at 0x510000
make upload-fs

# Build and upload in one command
make deploy-fs

# Deploy firmware + LittleFS together
make deploy-all

# OTA upload
curl -u "ops:changeme" -F "file=@build/littlefs.bin" http://192.168.133.46/uploadfs
```

### Device Access Credentials

| Resource | Username | Password |
|----------|----------|----------|
| Device OTA/API | ops | changeme |
| Dashboard | admin@mastertenant.com | Admin123! |
| MQTT Client | mqtt_client | mqtt_password123 |

### Network Addresses

| Resource | Address |
|----------|---------|
| Server API | http://192.168.133.110:4000 |
| Dashboard | http://192.168.133.110:5173 |
| MQTT Broker | 192.168.133.110:1883 |
| Kitchen Device | 192.168.133.46 |
| Biggy Device Serial | /dev/cu.usbserial-10 |

### Database

```bash
# Connect to database (NOTE: actual db name is mousetrap_monitor)
/opt/homebrew/opt/postgresql@15/bin/psql -U wadehargrove -d mousetrap_monitor

# Backup before changes
cd /Users/wadehargrove/Documents/MouseTrap/Server
./scripts/backup-database.sh
```

### Server Management

```bash
# Restart server
pm2 restart mqtt-server

# View logs
pm2 logs mqtt-server

# Rebuild after changes
cd /Users/wadehargrove/Documents/MouseTrap/Server
npm run build
pm2 restart mqtt-server
```

### MQTT (Mosquitto)

**Current Mode:** Dynamic Security (Docker)

```bash
# Restart broker
docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml restart mosquitto

# View logs
docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml logs -f mosquitto

# Config files
/Users/wadehargrove/Documents/MouseTrap/Server/mosquitto/config/mosquitto.conf
/Users/wadehargrove/Documents/MouseTrap/Server/mosquitto/config/dynamic-security.json
```

**Dynamic Security Credentials:**
| User | Role | Purpose |
|------|------|---------|
| server_admin | admin | Manage credentials via `$CONTROL/dynamic-security/#` |
| mqtt_client | server | Server pub/sub to all topics |
| {MAC_ADDRESS} | device | Device pub/sub to `tenant/#` and `global/#` |

**Fallback to Homebrew (if needed):**
```bash
# Stop Docker, start Homebrew
docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml down
brew services start mosquitto

# Update .env: MQTT_AUTH_MODE=password_file
# Rebuild and restart server
```

---

## System Architecture

```
+------------------+      MQTT (1883)      +---------------+
|  ESP32 Devices   |<-------------------->|   Mosquitto   |
|  (Firmware)      |                       |   Broker      |
+------------------+                       +---------------+
         |                                         |
         | HTTP API                                | MQTT
         v                                         v
+------------------+                       +---------------+
|  Device SPA      |                       |   Server      |
|  (Svelte)        |<--------------------->|   (Node.js)   |
+------------------+      HTTP API         +---------------+
                                                   |
                                                   v
                                           +---------------+
                                           |  PostgreSQL   |
                                           +---------------+
                                                   |
                                                   v
                                           +---------------+
                                           |  Dashboard    |
                                           |  (React)      |
                                           +---------------+
```

### Multi-Tenant Access Model

| Role | Scope | Access |
|------|-------|--------|
| **superadmin** | Master Tenant | Implicit access to ALL tenants and devices |
| **admin** | Specific tenant | Full access within their tenant |
| **operator** | Specific tenant | Device management within tenant |
| **viewer** | Specific tenant | Read-only access within tenant |

- Superadmin status is determined by `role = 'superadmin'` membership in Master Tenant (`00000000-0000-0000-0000-000000000001`)
- Superadmins do NOT appear in other tenants' user lists
- Regular users require explicit `user_tenant_memberships` records

---

## Device Information

### Kitchen Device (Production)
- **IP:** 192.168.133.46
- **MAC:** 94A990306028
- **Status:** Claimed to Master Tenant
- **Firmware:** v1.3.7
- **Credentials:** ops:changeme

### Biggy Device (Development)
- **MAC:** D0CF13155060
- **Serial Port:** /dev/cu.usbserial-10
- **Status:** Development/testing device
- **AP SSID (unclaimed):** MouseTrap-5060

---

## Current Session Notes (2025-11-29)

### Latest Work: Device Claim Recovery & Superadmin Snapshot Fix

**Status:** Complete - Both Kitchen and Biggy devices working

**What Was Implemented:**

1. **Device Claim Recovery** (`setup.routes.ts`, `mousetrap_arduino.ino`)
   - New `/api/setup/recover-claim` endpoint allows devices to recover credentials after NVS loss
   - After WiFi connects during setup, device checks if already claimed on server
   - If claimed: Recovers MQTT credentials, skips account setup, connects immediately
   - If not claimed: Proceeds to normal account creation/sign-in flow
   - **Security model:** Devices can only pub/sub to their own MQTT topics, MAC is hardware-burned
   - Device stays in original tenant on recovery (prevents "stealing")

2. **Factory Reset Preserves Server Claim** (`mousetrap_arduino.ino:3936-3940`)
   - Physical factory reset (10s button hold) now only clears LOCAL NVS
   - Does NOT notify server - claim record preserved for recovery
   - Users who want to truly unclaim should use the dashboard
   - Prevents devices getting stranded when NVS is cleared

3. **Superadmin Cross-Tenant Snapshot Fix** (`devices.routes.ts`, `server.ts`)
   - Superadmins can now request snapshots from devices in any tenant
   - Fixed: `request-snapshot` endpoint now allows superadmin access to all devices
   - Fixed: Uses device's actual `tenant_id` for MQTT command (not user's tenant)
   - Fixed: Snapshots from non-Master tenants also forwarded to Master Tenant WebSocket room
   - Allows superadmins in Master Tenant to see snapshots from all devices

4. **AP Channel Optimization at Boot** (`mousetrap_arduino.ino`)
   - Added `channel` field to `CachedNetwork` struct
   - Early boot scan captures WiFi channel info
   - AP starts on strongest network's channel (prevents phone disconnection during setup)
   - Removed channel-change code from WiFi test phase

5. **AP Disabled After Claim Recovery** (`mousetrap_arduino.ino:11749-11759`)
   - After successful claim recovery, device immediately:
     - Connects to MQTT
     - Disables AP mode (`WiFi.softAPdisconnect(true)`)
     - Switches to STA-only mode
   - No reboot required

**Files Modified:**
- `Server/src/routes/setup.routes.ts` - Added `/recover-claim` endpoint
- `Server/src/routes/devices.routes.ts` - Superadmin cross-tenant snapshot access
- `Server/src/server.ts` - Forward snapshots to Master Tenant room for superadmins
- `mousetrap_arduino/mousetrap_arduino.ino` - Recovery logic, factory reset fix, channel optimization

---

## Previous Session Notes (2025-11-29 - Earlier)

### Two-Phase Setup Wizard - WORKING

**Status:** Setup wizard working

**What Was Implemented:**

1. **Two-Phase Setup Flow** (`mousetrap_arduino.ino`, `trap-spa/src/pages/Setup.svelte`, `trap-spa/src/lib/api.js`)
   - **Phase 1:** Test WiFi connection before asking for account info
     - New `/api/setup/test-wifi` endpoint connects to WiFi in AP+STA mode
     - Device scans for target network channel, starts AP on same channel
     - If WiFi fails → User can retry immediately with different credentials
     - If WiFi succeeds → Proceeds to account step
   - **Phase 2:** Register with server (WiFi already connected)
     - New `/api/setup/register` endpoint for registration only
     - WiFi connection already established, more reliable
   - **Channel matching:** Both AP and STA interfaces must be on same channel (ESP32-S3 hardware limitation)

2. **Critical AP Mode Fix** (`mousetrap_arduino.ino:11608-11649`)
   - **Root cause of phone disconnection:** Was switching to `WIFI_STA` mode during network scan, dropping the AP
   - **Fix:** Stay in `WIFI_AP_STA` mode during scan, only restart AP if channel needs to change
   - Phone now stays connected through WiFi test

3. **WiFi Connection Improvements**
   - Reduced WiFi connection timeout from 15s to 10s
   - Added `WiFi.disconnect(true)` before retry to clear stale connection state
   - WiFi retry now works correctly after failed attempt

4. **Server Stability Fix** (`server.ts:84-91`)
   - Added MQTT error handler to prevent Node.js crash on unhandled `error` events
   - Also fixed: Added `rotation_ack` to `ParsedTopic` type union

**Completed: Forgot Password UX** (`trap-spa/src/pages/Setup.svelte`)
- Added "Forgot password?" link below password field on Step 3 (Sign In tab only)
- Tapping shows info box with instructions:
  1. Connect to your home WiFi network
  2. Visit dashboard.mousetrap.com/forgot-password
  3. Reset your password via email
  4. Return here to complete setup
- Info box is dismissible (X button)
- SPA rebuilt and ready for deployment

**Future Enhancement: Register First, Claim Later**
- Deferred for better UX: Device registers without account, user claims from dashboard later
- Would eliminate password issues entirely during captive portal setup
- Queue alerts until device is claimed

---

## Previous Session Notes (2025-11-28)

### Dashboard UX Improvements & Firmware Fixes

**Status:** Complete

**What Was Implemented:**

1. **Dashboard Device Card Click Navigation** (`trap-dashboard/src/components/devices/DeviceCard.tsx`)
   - Entire device card is now clickable to navigate to device details
   - Removed "View Details" button from card footer
   - Action buttons (delete, move) still work independently via `e.stopPropagation()`

2. **Auto-Capture Snapshot on Modal Open** (`trap-dashboard/src/components/SnapshotViewer.tsx`)
   - Added `autoCapture` prop to SnapshotViewer component
   - When clicking "Capture Snapshot" button, modal opens and immediately requests snapshot
   - Uses `useCallback` and `useRef` for proper React hook handling
   - "Capture New" button remains for taking additional snapshots

3. **Firmware: Fixed "Rejected revocation - missing token" Log Spam** (`mousetrap_arduino.ino`)
   - Empty retained MQTT messages on `/revoke` topics were triggering revocation handler
   - Added check to silently ignore empty/null payloads on revoke topic
   - Caused by `clearRetainedRevokeMessage()` which publishes empty retained messages

4. **Firmware: ACK-based Credential Rotation Support** (`mousetrap_arduino.ino`)
   - Device now publishes ACK to `rotation_ack` topic after saving new credentials to NVS
   - ACK is published BEFORE disconnecting so server can update broker
   - Firmware compiled and ready for OTA deployment

5. **APSTA Mode Setup with Real-Time Progress** (`mousetrap_arduino.ino`, `trap-spa/src/pages/Setup.svelte`)
   - ESP32-S3 now uses `WiFi.mode(WIFI_AP_STA)` during setup - AP stays running while connecting to WiFi
   - SPA polls `/api/setup/progress` every 500ms for real-time feedback
   - Added `/api/setup/reset` endpoint to retry setup without reboot
   - Added `/api/setup/reboot` endpoint for user-triggered reboot after success
   - Contextual error messages with specific help (wrong password, WiFi not found, etc.)
   - Deployed to Biggy via serial upload (115200 baud)

**Previous Work (Same Day):**
- Device stranding prevention mitigations (ACK-based rotation, recovery endpoint, scripts)
- Migrated to Docker Mosquitto with Dynamic Security (LIVE)
- Re-claimed both devices (Kitchen, Biggy)

**Previous Sessions:**
- RBAC standardization and role enforcement
- Superadmin multi-tenant access implementation
- Documentation organization and consolidation
- AP+STA mode implementation for captive portal
- Two-generation log rotation (prevLogs.txt, prevLogs2.txt)
- Standalone mode for WiFi-only setup

### Current Tasks

**Completed:**
- [x] Set up Docker Mosquitto with Dynamic Security
- [x] Implement credential rotation endpoint
- [x] Add rotate_credentials firmware command
- [x] Update mqtt-auth.ts for dual-mode support
- [x] Test credential rotation with Biggy device
- [x] Add migration sync to rotation endpoint
- [x] Fixed device connection issues (rc=5) by re-claiming both devices
- [x] Documented parallel rotation migration approach in MQTT-SETUP.md
- [x] **Migrated to Docker Mosquitto with Dynamic Security (LIVE)**
- [x] Re-claimed Kitchen (94A990306028) and Biggy (D0CF13155060) devices
- [x] **Implemented device stranding prevention mitigations**
- [x] Added ACK-based credential rotation
- [x] Added `/device/recover-credentials` endpoint
- [x] Created `rebuild-dynsec-from-db.ts` script
- [x] Created `check-credential-sync.ts` health check script
- [x] Documented stranding scenarios in `docs/DEVICE-STRANDING-SCENARIOS.md`
- [x] Add firmware support for `rotation_ack` MQTT message - **DEPLOYED**
- [x] Fixed "Rejected revocation - missing token" log spam in firmware
- [x] Dashboard: Device cards now clickable to navigate to details
- [x] Dashboard: Capture Snapshot auto-requests on modal open
- [x] Implemented APSTA mode setup with real-time progress polling
- [x] Deployed APSTA firmware to Biggy via serial - **VERIFIED WORKING**
- [x] Deployed APSTA firmware to Kitchen via OTA - **VERIFIED WORKING**
- [x] Implemented device claim recovery (`/api/setup/recover-claim` endpoint)
- [x] Fixed factory reset to preserve server claim for recovery
- [x] Fixed superadmin cross-tenant snapshot access
- [x] Fixed WebSocket snapshot forwarding for cross-tenant devices

**Pending:**
- [ ] Deploy updated firmware to Biggy (factory reset fix compiled but not uploaded)
- [ ] Implement new button handler (click=reset alarm, 2s=reboot, 10s=factory reset)

### Known Issues

**FIXED: Server MQTT Connack Timeout Crashes:**
- ~~Server crashes repeatedly with `Error: connack timeout`~~
- ~~Over 4731 restarts observed in pm2~~
- **Root cause:** Unhandled `error` event from MqttService EventEmitter
- **Fix applied:** Added error handler in `server.ts:84-91`
- Server now handles MQTT errors gracefully without crashing

**WiFi Scanning in AP_STA Mode:**
- `WiFi.scanNetworks()` returns 0 when ESP32-S3 is in AP_STA mode
- **Solution:** Temporarily switch to STA mode during scan, then back to AP_STA
- Status: Fixed in two-phase setup

**AP+STA Mode Channel Requirement:**
- Both AP and STA interfaces must operate on the same WiFi channel
- Firmware now scans for target network channel before starting AP
- Status: Fixed

**Filesystem OTA May Cause Unclaim:**
- After littlefs.bin upload, device may unclaim
- Workaround: Re-claim device if needed

---

## MQTT Topics Reference

### Device to Server
- `tenant/{tenantId}/device/{clientId}/status` - Device status
- `tenant/{tenantId}/device/{MAC}/alert` - Alert notifications
- `tenant/{tenantId}/device/{MAC}/alert_cleared` - Alert cleared confirmation
- `tenant/{tenantId}/device/{clientId}/rotation_ack` - Credential rotation ACK

### Server to Device
- `tenant/{tenantId}/device/{clientId}/command/reboot` - Reboot command
- `tenant/{tenantId}/device/{clientId}/command/alert_reset` - Clear alert
- `tenant/{tenantId}/device/{clientId}/command/rotate_credentials` - Credential rotation
- `global/firmware/latest` - Global firmware updates
- `global/filesystem/latest` - Global filesystem updates

---

## Quick Troubleshooting

### MQTT Connection Failed (rc=5)
1. Check Mosquitto logs: `tail -f /opt/homebrew/var/log/mosquitto.log`
2. Verify credentials in password file
3. Restart Mosquitto: `brew services restart mosquitto`
4. See [Server/docs/MQTT-SETUP.md](./Server/docs/MQTT-SETUP.md) for details

### Device Not Responding
1. Check device is on network: `ping 192.168.133.46`
2. Check device logs: `curl -u ops:changeme http://192.168.133.46/api/system-logs`
3. Access debug dashboard: `http://192.168.133.46/debug`

### Compilation Errors
1. Ensure using correct FQBN (see Persistent Operational Info above)
2. Use `make compile` not manual arduino-cli with wrong board
3. See [mousetrap_arduino/docs/FIRMWARE-COMPILATION.md](./mousetrap_arduino/docs/FIRMWARE-COMPILATION.md)

### Shell Escaping with Passwords (zsh)
The `!` character in passwords like `Admin123!` gets escaped as `\!` in zsh, causing JSON parse errors.

**Wrong:**
```bash
curl -d '{"password":"Admin123!"}'  # ! gets escaped to \!
```

**Right - use heredoc:**
```bash
cat << 'ENDJSON' > /tmp/request.json
{"email":"admin@mastertenant.com","password":"Admin123!"}
ENDJSON
curl -d @/tmp/request.json ...
```

---

## Documentation Links

| Topic | Document |
|-------|----------|
| Documentation navigation | [DOCUMENTATION-SYSTEM-GUIDE.md](./DOCUMENTATION-SYSTEM-GUIDE.md) |
| Device claiming flow | [DEVICE-CLAIMING-FLOW.md](./DEVICE-CLAIMING-FLOW.md) |
| **Device stranding & recovery** | **[Server/docs/DEVICE-STRANDING-SCENARIOS.md](./Server/docs/DEVICE-STRANDING-SCENARIOS.md)** |
| Firmware compilation | [mousetrap_arduino/docs/FIRMWARE-COMPILATION.md](./mousetrap_arduino/docs/FIRMWARE-COMPILATION.md) |
| OTA deployment | [mousetrap_arduino/docs/OTA-DEPLOYMENT.md](./mousetrap_arduino/docs/OTA-DEPLOYMENT.md) |
| SPA development | [mousetrap_arduino/docs/SPA-DEVELOPMENT.md](./mousetrap_arduino/docs/SPA-DEVELOPMENT.md) |
| Board settings | [mousetrap_arduino/docs/BOARD-SETTINGS.md](./mousetrap_arduino/docs/BOARD-SETTINGS.md) |
| Device API | [mousetrap_arduino/docs/DEVICE-API.md](./mousetrap_arduino/docs/DEVICE-API.md) |
| Server API | [Server/docs/API-REFERENCE.md](./Server/docs/API-REFERENCE.md) |
| MQTT setup | [Server/docs/MQTT-SETUP.md](./Server/docs/MQTT-SETUP.md) |
| Server deployment | [Server/docs/DEPLOYMENT.md](./Server/docs/DEPLOYMENT.md) |

---

## End of Session Checklist

When ending a session with significant changes:
- [ ] Update "Latest Work" section above
- [ ] Update "Current Tasks" if they changed
- [ ] Note any new warnings or gotchas
- [ ] Update specific docs if procedures changed

---

**End of Handoff**
