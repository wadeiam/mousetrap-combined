# MouseTrap Session Handoff

**Last Updated:** 2025-11-27
**Latest Session:** Dashboard tenant filtering fix + device move claim preservation

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

# Upload with lower baud rate (RECOMMENDED - 921600 often fails)
arduino-cli upload -p /dev/cu.usbserial-10 --fqbn "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=custom,CPUFreq=240,FlashMode=qio,UploadSpeed=115200,DebugLevel=none,EraseFlash=none,USBMode=hwcdc" .

# Deploy firmware OTA
curl -u "ops:changeme" -F "file=@build/mousetrap_arduino.ino.bin" http://192.168.133.46/uploadfw
```

**IMPORTANT:** Serial upload at 921600 baud often fails with "chip stopped responding". Use 115200 baud for reliable uploads.

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

### Latest Work: Dashboard Tenant Filtering + Device Move Claim Preservation

**Completed:**
- **Fixed Master Tenant aggregate view logic** - Superadmins now see correct data:
  - When viewing Master Tenant → Shows ALL devices/alerts/stats across all tenants
  - When switched to a subtenant → Shows only that specific tenant's data
  - Files modified: `devices.routes.ts`, `alerts.routes.ts`, `dashboard.routes.ts`
- **Fixed device move to preserve claim status** - Moving devices between tenants no longer breaks claim:
  - Device UUID is preserved (no longer generates new ID)
  - Uses correct `publishDeviceCommand` method
  - Sends `update_tenant` command to device's OLD tenant topic
  - No revocation messages are sent
  - Files modified: `devices.routes.ts`, `mqtt.types.ts`
- **Dashboard UI improvements:**
  - Fixed stats grid layout (5 cards with responsive columns)
  - Added "Offline Devices" stat card
  - Fixed invalid role 'member' → 'viewer' in Users page
  - AlertCard now shows tenant name and location for Master Tenant view

**Previous Sessions:**
- Robust device tenant move with MQTT coordination
- AP mode not broadcasting after WiFi scan fix
- MQTT retained revoke message fix (changed to non-retained)
- Subtenant Firmware page (simplified view vs Master Tenant admin view)
- Kitchen device tenant mismatch fix
- Documentation organization

### Current Tasks

**Pending:**
- [ ] Add tenant purge settings to master tenant
- [ ] Implement new button handler (click=reset alarm, 2s=reboot, 10s=factory reset)
- [ ] Test AP mode broadcasting after fix

### Known Issues

**Serial Upload at 921600 Baud:**
- Often fails with "chip stopped responding"
- Use 115200 baud for reliable uploads (see Firmware Compilation section)

**Stranded Device Root Cause (Kitchen Device 2025-11-27):**
- Device was moved between tenants in the dashboard but device wasn't notified
- Device still had old tenant ID in NVS (stored in "device" namespace)
- Server database showed new tenant, but device connected with old tenant credentials
- MQTT authentication failed because credentials didn't match
- **Fix implemented:** Server now sends `update_tenant` MQTT command before updating database
- **If device is offline during move:** Warning is shown; device needs manual re-provisioning

**WiFi Scanning in AP_STA Mode:**
- `WiFi.scanNetworks()` returns 0 when ESP32-S3 is in AP_STA mode
- Current approach: Temporarily switch to STA mode during scan, then restore AP
- AP is now always restored after scan completes (fix applied 2025-11-27)

---

## MQTT Topics Reference

### Device to Server
- `tenant/{tenantId}/device/{clientId}/status` - Device status
- `tenant/{tenantId}/device/{MAC}/alert` - Alert notifications
- `tenant/{tenantId}/device/{MAC}/alert_cleared` - Alert cleared confirmation

### Server to Device
- `tenant/{tenantId}/device/{clientId}/command/reboot` - Reboot command
- `tenant/{tenantId}/device/{clientId}/command/alert_reset` - Clear alert
- `tenant/{tenantId}/device/{clientId}/command/update_tenant` - Move device to new tenant
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
