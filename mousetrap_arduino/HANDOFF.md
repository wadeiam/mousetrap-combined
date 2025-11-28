# MouseTrap Session Handoff

**Last Updated:** 2025-11-26
**Latest Session:** Documentation organization and consolidation

---

## READ THIS FIRST

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
# Connect to database
psql -U wadehargrove -d mousetrap_db

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

```bash
# Restart broker
brew services restart mosquitto

# View logs
tail -f /opt/homebrew/var/log/mosquitto.log

# Config file
/opt/homebrew/etc/mosquitto/mosquitto.conf

# Password file
/opt/homebrew/etc/mosquitto/passwd
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

## Current Session Notes (2025-11-27)

### Latest Work: Bulletproof Device Claiming System

**Completed:**
- Implemented token-verified MQTT revocation (prevents accidental unclaims)
- Added `/api/device/verify-revocation` endpoint for device token verification
- Hardened `/api/device/claim-status` endpoint (returns 404 instead of `claimed:false` for missing devices)
- Created `device_claim_audit` table for complete audit trail of all claim/unclaim operations
- Added source tracking to all unclaim operations (`factory_reset`, `local_ui`, `mqtt_revoke`, `claim_verify`)
- Firmware changes: `verifyRevocationToken()`, `unclaimDeviceWithSource()`, hardened MQTT revoke handler

**Previous Sessions:**
- Documentation organization (2025-11-26)
- AP+STA mode implementation for captive portal
- Two-generation log rotation (prevLogs.txt, prevLogs2.txt)
- Standalone mode for WiFi-only setup
- Captive portal URL detection fix (getBaseUrl())

### Bulletproof Claiming: How It Works

**Problem Solved:** Devices were accidentally unclaiming due to network issues, server errors, or malformed MQTT messages.

**Solution:** Token-verified revocation - device MUST verify with server before unclaiming.

**Flow:**
1. Admin clicks "Unclaim" in dashboard
2. Server generates one-time revocation token (5 min expiry)
3. Server sends MQTT `/revoke` message with token
4. Device receives message, extracts token
5. Device calls `POST /api/device/verify-revocation` to verify token
6. Server confirms token validity → Device unclaims
7. **Any error = Device stays claimed** (network error, invalid token, timeout)

### Current Tasks

**Completed:**
- [x] Token-verified MQTT revocation
- [x] Hardened claim-status endpoint
- [x] Device audit logging
- [x] Source tracking for all unclaims

**Known Issues:**

**WiFi Scanning in AP_STA Mode:**
- `WiFi.scanNetworks()` returns 0 when ESP32-S3 is in AP_STA mode
- Current approach: Temporarily switch to STA mode during scan
- Status: Testing

---

## MQTT Topics Reference

### Device to Server
- `tenant/{tenantId}/device/{clientId}/status` - Device status
- `tenant/{tenantId}/device/{MAC}/alert` - Alert notifications
- `tenant/{tenantId}/device/{MAC}/alert_cleared` - Alert cleared confirmation

### Server to Device
- `tenant/{tenantId}/device/{clientId}/command/reboot` - Reboot command
- `tenant/{tenantId}/device/{clientId}/command/alert_reset` - Clear alert
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

---

## Documentation Links

| Topic | Document |
|-------|----------|
| Documentation navigation | [DOCUMENTATION-SYSTEM-GUIDE.md](./DOCUMENTATION-SYSTEM-GUIDE.md) |
| Device claiming flow | [DEVICE-CLAIMING-FLOW.md](./DEVICE-CLAIMING-FLOW.md) |
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
