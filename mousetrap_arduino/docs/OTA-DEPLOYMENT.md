# OTA Deployment Guide

**Over-the-Air firmware and filesystem updates for ESP32-S3 devices**

---

## Quick Reference

### Deploy Firmware to Single Device
```bash
cd /Users/wadehargrove/Documents/MouseTrap/Arduino
curl -u "ops:changeme" \
  -F "file=@build/mousetrap_arduino.ino.bin" \
  http://192.168.133.46/uploadfw
```

### Deploy Filesystem to Single Device
```bash
curl -u "ops:changeme" \
  -F "file=@build/littlefs.bin" \
  http://192.168.133.46/uploadfs
```

---

## Two Types of OTA Updates

### 1. HTTP Direct Upload (Device Endpoint)
- Deploy to a single specific device
- Requires device IP address
- Immediate update
- **Use for:** Testing, emergency fixes, single-device updates

### 2. MQTT-Based OTA (Server-Pushed)
- Deploy to all devices or specific tenants
- Devices download automatically when available
- Version-controlled
- **Use for:** Fleet updates, production releases

*Note: MQTT-based OTA is configured via the server dashboard. See server documentation.*

---

## HTTP Direct Upload (ElegantOTA)

### Firmware Update

```bash
# From project root
curl -u "ops:changeme" \
  -F "file=@build/mousetrap_arduino.ino.bin" \
  http://<device-ip>/uploadfw
```

**Process:**
1. Device receives firmware binary
2. Flashes to alternate app partition (app1 if currently app0)
3. Sets boot partition to new firmware
4. Reboots (~8 seconds)
5. Boots into new firmware

### Filesystem Update

```bash
curl -u "ops:changeme" \
  -F "file=@build/littlefs.bin" \
  http://<device-ip>/uploadfs
```

**Process:**
1. Device receives littlefs.bin
2. Flashes to littlefs partition
3. Reboots (~30 seconds)
4. LittleFS auto-mounts with new content

### Via Web Interface

Navigate to `http://<device-ip>/update`:
1. Login with `ops:changeme`
2. Select tab:
   - **Firmware** for `.ino.bin`
   - **Filesystem** for `littlefs.bin`
3. Choose file
4. Click "Update"
5. Wait for reboot

---

## Deployment Workflow

### Complete Firmware Deployment

```bash
# 1. Compile firmware
cd /Users/wadehargrove/Documents/MouseTrap/Arduino
make compile

# 2. Verify binary was created
ls -lh build/mousetrap_arduino.ino.bin

# 3. Deploy to Kitchen device
curl -u "ops:changeme" \
  -F "file=@build/mousetrap_arduino.ino.bin" \
  http://192.168.133.46/uploadfw

# 4. Wait for reboot (~8 seconds)
sleep 10

# 5. Verify new firmware is running
curl http://192.168.133.46/api/system-info | grep firmwareVersion
```

### Complete Filesystem Deployment

```bash
# 1. Build SPA (see SPA-DEVELOPMENT.md)
cd trap-spa && npm run build && cd ..

# 2. Build LittleFS image
./build-littlefs.sh

# 3. Verify binary was created
ls -lh build/littlefs.bin

# 4. Deploy to device
curl -u "ops:changeme" \
  -F "file=@build/littlefs.bin" \
  http://192.168.133.46/uploadfs

# 5. Wait for reboot (~30 seconds)
sleep 35

# 6. Verify SPA loads
curl http://192.168.133.46/app/ | head -20
```

---

## ⚠️ Important Notes

### Filesystem OTA May Unclaim Device

**Symptom:** After filesystem OTA, device shows as unclaimed

**Why:** LittleFS partition and NVS are separate, but filesystem OTA can sometimes trigger unclaim logic

**Prevention:**
- Check claim status before filesystem updates
- Monitor device after deployment

**Fix:** Re-claim device if needed (see [DEVICE-CLAIMING.md](./DEVICE-CLAIMING.md))

### Device Credentials Required

All OTA endpoints require authentication:
- **Username:** `ops`
- **Password:** `changeme`

Without credentials, you'll get `401 Unauthorized`.

### Wait for Reboot

After OTA upload:
- **Firmware:** Wait ~8-10 seconds
- **Filesystem:** Wait ~30-35 seconds

Device is unresponsive during reboot. Don't attempt another upload until fully rebooted.

---

## Verification

### Check Firmware Version

```bash
# Query system info
curl http://192.168.133.46/api/system-info

# Look for firmwareVersion field
```

### Check Filesystem Version

```bash
# Query system info
curl http://192.168.133.46/api/system-info

# Look for filesystemVersion field
```

### Check System Logs

```bash
# Get last 50 log entries
curl -u "ops:changeme" http://192.168.133.46/api/system-logs | \
  python3 -c "import sys, json; logs=json.load(sys.stdin); print('\\n'.join(logs[-50:]))"
```

Look for:
- `[OTA] Update successful`
- `[SETUP] Firmware version: vX.X.X`
- `[LITTLEFS] Mounted successfully`

---

## Troubleshooting

### Upload Fails with "Update Error"

**Possible causes:**
1. Wrong file type (firmware vs filesystem)
2. Binary too large for partition
3. Corrupt binary file
4. Device out of memory

**Fix:**
- Verify you're using correct endpoint (`/uploadfw` vs `/uploadfs`)
- Check binary size is within partition limits
- Recompile binary
- Reboot device and try again

### Device Doesn't Reboot After Upload

**Symptom:** Upload completes but device doesn't reboot

**Cause:** Upload may have failed silently

**Fix:**
- Check system logs for errors
- Manually reboot device:
  ```bash
  curl -u "ops:changeme" -X POST http://192.168.133.46/api/reboot
  ```
- If still unresponsive, power cycle device

### Device Boots to Old Firmware

**Symptom:** After firmware OTA, device still runs old version

**Possible causes:**
1. Compilation didn't update binary (timestamp not recent)
2. Uploaded wrong file
3. OTA partition switch failed

**Fix:**
1. Verify binary timestamp:
   ```bash
   ls -lh build/mousetrap_arduino.ino.bin
   ```
2. Recompile with `make compile`
3. Try upload again
4. Check system logs for boot partition info

### Filesystem OTA Causes Device to Unclaim

**Symptom:** After filesystem update, device shows as unclaimed in SPA

**Why:** Known issue where filesystem OTA can trigger unclaim

**Fix:**
1. Check system logs for unclaim events
2. Look for IP address that triggered unclaim
3. Re-claim device if necessary

---

## Device-Specific IPs

### Kitchen Device
- **IP:** 192.168.133.46
- **MAC:** 94A990306028

---

## Upload Progress Monitoring

The web interface (`http://<device-ip>/update`) shows real-time progress:
- Upload percentage
- Bytes transferred
- Success/failure status

For curl uploads, you'll see:
```
######################################################################## 100.0%
```

---

## Partition Sizes

### Firmware Partition
- **Size:** 2.5 MB (2,621,440 bytes)
- **Current usage:** ~1.4-1.5 MB (56-60%)
- **Max firmware size:** 2.5 MB

### Filesystem Partition
- **Size:** 10.875 MB (11,403,264 bytes)
- **Current usage:** ~120 KB (SPA)
- **Plenty of headroom** for images/videos

If firmware exceeds 2.5 MB, it won't fit and upload will fail.

---

## Safety Features

### Dual App Partitions (app0/app1)
- New firmware flashes to inactive partition
- If boot fails, device can roll back to previous partition
- Protects against bricking

### Filesystem Validation
- Device validates filesystem binary before flashing
- Prevents corrupt filesystem from being written

### Watchdog Timer
- If new firmware crashes on boot, watchdog will reboot device
- Multiple crashes may trigger rollback to previous partition

---

## Next Steps

After successful OTA deployment:
1. Verify device is reachable
2. Check firmware/filesystem version
3. Test SPA interface
4. Review system logs for errors
5. Test device features

---

**Related Documentation:**
- [FIRMWARE-COMPILATION.md](./FIRMWARE-COMPILATION.md) - Compile firmware before deploying
- [SPA-DEVELOPMENT.md](./SPA-DEVELOPMENT.md) - Build filesystem before deploying
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues
- [DEVICE-API.md](./DEVICE-API.md) - Device API endpoints
