# MouseTrap Session Handoff

**Last Updated:** 2025-11-27
**Latest Session:** RBAC standardization and role enforcement

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

## Current Session Notes (2025-11-27)

### Latest Work: RBAC Standardization

**Completed:**
- Standardized role-based access control across all routes
- Created migration 009 with SQL helper functions:
  - `user_is_superadmin(UUID)` - checks superadmin status in Master Tenant
  - `user_is_tenant_admin(UUID, UUID)` - checks admin+ in specific tenant
  - `user_role_in_tenant(UUID, UUID)` - returns user's role
- Added role enforcement to device command routes (reboot, firmware-update, clear-alerts, unclaim, request-snapshot) - now require admin+
- Added role enforcement to firmware routes (POST/PUT/DELETE require admin+, GET open to all)
- Added self-profile endpoints (`GET /users/me`, `PUT /users/me`) for viewers to manage their own accounts
- Added role escalation prevention (can't change own role, only superadmins can assign superadmin)
- Standardized logs routes to use `requireRole('superadmin')`

**Role Hierarchy (industry standard):**
| Role | Can Do |
|------|--------|
| viewer | Read-only, can only edit own profile (not tenant settings) |
| operator | Reserved for future use |
| admin | Full control within their tenant |
| superadmin | Global access, must be in Master Tenant |

**Previous Sessions:**
- Superadmin multi-tenant access implementation
- Documentation organization and consolidation
- AP+STA mode implementation for captive portal
- Two-generation log rotation (prevLogs.txt, prevLogs2.txt)
- Standalone mode for WiFi-only setup

### Current Tasks

**Completed:**
- [x] Fix superadmin visibility to all tenants
- [x] Fix superadmin access to devices across tenants
- [x] Verify device claiming with new tenant
- [x] Standardize RBAC roles (viewer/admin/superadmin)
- [x] Add self-profile management endpoints
- [x] Add role escalation prevention

**Pending:**
- [ ] Implement new button handler (click=reset alarm, 2s=reboot, 10s=factory reset)

### Known Issues

**WiFi Scanning in AP_STA Mode:**
- `WiFi.scanNetworks()` returns 0 when ESP32-S3 is in AP_STA mode
- Current approach: Temporarily switch to STA mode during scan
- Status: Testing

**Filesystem OTA May Cause Unclaim:**
- After littlefs.bin upload, device may unclaim
- Workaround: Re-claim device if needed

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
