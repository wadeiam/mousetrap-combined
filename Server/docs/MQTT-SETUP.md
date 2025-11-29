# MQTT Broker Setup & Troubleshooting

**Mosquitto MQTT broker configuration for device connectivity**

---

## Current Configuration: Dynamic Security (ACTIVE)

**As of 2025-11-28, the system is running Docker Mosquitto with Dynamic Security.**

### Quick Reference (Docker/Dynamic Security)

```bash
# Restart broker
docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml restart mosquitto

# View logs
docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml logs -f mosquitto

# Check status
docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml ps
```

### File Locations (Docker)
- **Config:** `/Users/wadehargrove/Documents/MouseTrap/Server/mosquitto/config/mosquitto.conf`
- **Credentials:** `/Users/wadehargrove/Documents/MouseTrap/Server/mosquitto/config/dynamic-security.json`
- **Data:** `/Users/wadehargrove/Documents/MouseTrap/Server/mosquitto/data/`

### Environment (.env)
```bash
MQTT_AUTH_MODE=dynamic_security
MQTT_DYNSEC_BROKER_URL=mqtt://192.168.133.110:1883
MQTT_DYNSEC_ADMIN_USER=server_admin
MQTT_DYNSEC_ADMIN_PASS=mqtt_admin_password
MQTT_DYNSEC_DEFAULT_ROLE=device
```

---

## Fallback: Homebrew Mosquitto (Password File)

If you need to revert to Homebrew Mosquitto:

```bash
# 1. Stop Docker Mosquitto
docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml down

# 2. Start Homebrew Mosquitto
brew services start mosquitto

# 3. Update .env
MQTT_AUTH_MODE=password_file

# 4. Rebuild and restart server
cd /Users/wadehargrove/Documents/MouseTrap/Server
npm run build && pm2 restart mqtt-server

# 5. Re-claim devices (passwords won't match)
```

### Homebrew File Locations
- **Config:** `/opt/homebrew/etc/mosquitto/mosquitto.conf`
- **Passwords:** `/opt/homebrew/etc/mosquitto/passwd`
- **Logs:** `/opt/homebrew/var/log/mosquitto.log`

---

## ⚠️ CRITICAL: CONNACK Code 5 Troubleshooting

**THIS IS THE #1 TIME WASTER - READ CAREFULLY**

### Symptom
- Device shows as claimed but MQTT "Not Connected"
- Mosquitto logs: `CONNACK code 5 "not authorised"`

### Root Cause
Mosquitto doesn't auto-reload password file after updates. Device has correct password but Mosquitto uses stale password in memory.

### Quick Fix
```bash
# 1. Get device password from database
cd /Users/wadehargrove/Documents/MouseTrap/Server
node check_device_password.js

# 2. Update mosquitto password file
mosquitto_passwd -b /opt/homebrew/etc/mosquitto/passwd <MAC_ADDRESS> <PASSWORD>

# 3. Restart mosquitto
brew services restart mosquitto

# 4. Wait 10 seconds and verify
tail -f /opt/homebrew/var/log/mosquitto.log | grep "New client connected"
```

### Permanent Fix (Implemented)
Server now sends SIGHUP to Mosquitto after password updates:
- Debounced reload (2-second timer)
- Handles concurrent claims
- Located in: `src/utils/mqtt-auth.ts`

### Prevention
- ❌ DO NOT enable anonymous auth - masks the problem
- ✅ Check Mosquitto logs first
- ✅ Verify password file matches database

---

## MQTT Topics

### Device → Server
- `tenant/{tenantId}/device/{clientId}/status` - Device status
- `tenant/{tenantId}/device/{clientId}/ota/progress` - OTA progress
- `tenant/{tenantId}/device/{MAC}/alert` - Alert notifications
- `tenant/{tenantId}/device/{MAC}/alert_cleared` - Alert cleared confirmation

### Server → Device
- `tenant/{tenantId}/device/{clientId}/command/reboot` - Reboot command
- `tenant/{tenantId}/device/{clientId}/command/alert_reset` - Clear alert
- `tenant/{tenantId}/device/{clientId}/ota/firmware` - OTA firmware
- `global/firmware/latest` - Global firmware updates
- `global/filesystem/latest` - Global filesystem updates

---

## Troubleshooting

### Device Can't Connect (rc=5)
1. Check password file has device entry
2. Verify Mosquitto reloaded after claim
3. Check device has correct credentials in NVS
4. Manually sync password and restart Mosquitto

### Mosquitto Not Running
```bash
brew services start mosquitto
```

### Permission Denied
```bash
sudo chown -R mosquitto:mosquitto /opt/homebrew/var/lib/mosquitto
```

---

## Dynamic Security (CURRENT)

The server supports two MQTT authentication modes:

| Mode | Setting | Status |
|------|---------|--------|
| `password_file` | Fallback | Uses Homebrew Mosquitto with passwd file |
| `dynamic_security` | **ACTIVE** | Uses Docker Mosquitto with Dynamic Security plugin |

### How Dynamic Security Works

1. **Credentials via MQTT API**: Server manages credentials by publishing to `$CONTROL/dynamic-security/#`
2. **No broker restart needed**: Changes take effect immediately
3. **Role-based ACLs**: Devices get the `device` role with limited topic access

### Dynamic Security Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access including `$CONTROL/dynamic-security/#` |
| `server` | Publish/subscribe to all topics (`#`) |
| `device` | Publish/subscribe to `tenant/#` and `global/#` |

### Starting Docker Mosquitto

```bash
cd /Users/wadehargrove/Documents/MouseTrap/Server
docker-compose up -d mosquitto
```

Configuration files:
- `mosquitto/config/mosquitto.conf`
- `mosquitto/config/dynamic-security.json`

---

## Migration History: Password File → Dynamic Security

**Migration completed on 2025-11-28 using Option A (Re-claim Devices)**

### What Was Done

1. Stopped Homebrew Mosquitto: `brew services stop mosquitto`
2. Started Docker Mosquitto: `docker compose up -d mosquitto`
3. Updated `.env` to `MQTT_AUTH_MODE=dynamic_security`
4. Rebuilt and restarted server
5. Re-claimed both devices (Kitchen, Biggy) with fresh claim codes

### Implementation Details

The `rotate-credentials` endpoint in `src/routes/devices.routes.ts`:
- Updates credentials via Dynamic Security API (when in dynamic_security mode)
- Syncs to both systems (when in password_file mode with Docker running)
- Updates database with bcrypt hash
- Sends `rotate_credentials` MQTT command to device

The credential management functions in `src/utils/mqtt-auth.ts`:
- `addMqttDevice()` - Creates device credentials via Dynamic Security API
- `removeMqttDevice()` - Removes device credentials
- `updateMqttDevicePassword()` - Updates password for existing device
- `addToDynsecForMigration()` - Syncs credentials to Dynamic Security (used during migration)

### Alternative: Option B (Parallel Rotation)

For future reference, if zero-downtime migration is needed:

1. Run Docker Mosquitto on port 1884 alongside Homebrew on 1883
2. Keep `MQTT_AUTH_MODE=password_file` but set `MQTT_DYNSEC_BROKER_URL=mqtt://...:1884`
3. Rotate credentials for each device (syncs to both systems)
4. Switch to `dynamic_security` mode and reconfigure Docker to port 1883
5. Requires firmware with `rotate_credentials` command support

---

**Related:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md), [CLAIM-CODES.md](./CLAIM-CODES.md)
