# MQTT Broker Setup & Troubleshooting

**Mosquitto MQTT broker configuration for device connectivity**

---

## Quick Reference

### Mosquitto Control
```bash
# Restart
brew services restart mosquitto

# View logs
tail -f /opt/homebrew/var/log/mosquitto.log

# Check status
brew services list | grep mosquitto
```

### File Locations
- **Config:** `/opt/homebrew/etc/mosquitto/mosquitto.conf`
- **Passwords:** `/opt/homebrew/etc/mosquitto/passwd`
- **Logs:** `/opt/homebrew/var/log/mosquitto.log`

---

## Configuration

### mosquitto.conf
```conf
listener 1883
allow_anonymous false
password_file /opt/homebrew/etc/mosquitto/passwd
log_dest file /opt/homebrew/var/log/mosquitto.log
log_type all
persistence true
persistence_location /opt/homebrew/var/lib/mosquitto/
```

### Add Device Credentials
```bash
mosquitto_passwd -b /opt/homebrew/etc/mosquitto/passwd <username> <password>
brew services restart mosquitto
```

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

**Related:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md), [CLAIM-CODES.md](./CLAIM-CODES.md)
