# Troubleshooting Guide

**Common device and firmware issues with solutions**

---

## Compilation Issues

### Sketch Too Big (111% of flash)

**Symptom:**
```
Sketch uses 2686480 bytes (111%) of program storage space
```

**Cause:** Wrong FQBN or missing custom partition scheme

**Fix:**
```bash
# Use correct FQBN with PartitionScheme=custom
make compile
```

See [FIRMWARE-COMPILATION.md](./FIRMWARE-COMPILATION.md)

---

### Binary Not Updated After Compilation

**Symptom:** Timestamp on `build/mousetrap_arduino.ino.bin` doesn't change

**Cause:** Missing `--output-dir build` flag

**Fix:**
```bash
# Always use Makefile or include --output-dir
arduino-cli compile --fqbn "..." --output-dir build .
```

---

### Library Compilation Errors

**Symptom:** Errors about AsyncTCP or other libraries

**Cause:** Wrong library version or missing dependencies

**Fix:**
1. Ensure using **Async_TCP v3.4.9** (not AsyncTCP v1.1.4)
2. Install via Arduino IDE Library Manager
3. Verify library path in compilation output

---

## OTA Update Issues

### Upload Fails with "Update Error"

**Causes:**
- Wrong endpoint (`/uploadfw` vs `/uploadfs`)
- Binary too large for partition
- Corrupt binary
- Device out of memory

**Fix:**
1. Use correct endpoint
2. Check binary size < partition size
3. Recompile binary
4. Reboot device and retry

---

### Device Doesn't Reboot After Upload

**Symptom:** Upload completes but no reboot

**Fix:**
```bash
# Manually reboot
curl -u "ops:changeme" -X POST http://192.168.133.46/api/reboot
```

If unresponsive, power cycle device.

---

### Device Boots to Old Firmware

**Symptom:** After OTA, device still runs old version

**Cause:**
1. Binary not updated (old timestamp)
2. Uploaded wrong file
3. OTA partition switch failed

**Fix:**
1. Verify binary timestamp:
   ```bash
   ls -lh build/mousetrap_arduino.ino.bin
   ```
2. Recompile: `make compile`
3. Upload again
4. Check system logs

---

### Filesystem OTA Causes Unclaim

**Symptom:** After filesystem OTA, device shows unclaimed

**Cause:** Known issue - filesystem OTA can trigger unclaim

**Fix:**
1. Check system logs for unclaim IP
2. Re-claim device if needed
3. See [DEVICE-CLAIMING.md](./DEVICE-CLAIMING.md)

---

## Device Connectivity

### Device Not Reachable

**Check:**
1. Device on same network
2. IP address correct
3. Device powered on
4. WiFi connected

**Verify:**
```bash
ping 192.168.133.46
```

**Fix:**
- Check serial logs for WiFi connection
- Verify SSID/password in NVS
- Reboot device
- Check router DHCP leases

---

### WiFi Won't Connect

**Symptom:** Device can't connect to WiFi

**Check:**
- SSID correct (case-sensitive)
- Password correct
- 2.4GHz network (ESP32 doesn't support 5GHz)
- Network allows new devices

**Serial logs:**
```
[WiFi] Connecting to NetworkName...
[WiFi] Failed to connect
```

**Fix:**
1. Reconfigure WiFi via device SPA
2. Power cycle router
3. Factory reset device

---

### MQTT Won't Connect

**Symptom:** Device claimed but MQTT shows "Not Connected"

**Cause:** MQTT credential sync failure (server-side)

**Device serial logs:**
```
[MQTT] Connection failed, rc=5 (not authorized)
```

**Quick fix:**
1. Get credentials from server database
2. Update Mosquitto password file
3. Restart Mosquitto
4. Wait 10 seconds

*Note: MQTT setup is server-side. See server documentation.*

---

## Captive Portal / Setup Wizard

### Setup Wizard API Calls Failing (iPhone)

**Symptom:** Setup wizard on iPhone doesn't communicate with device. No `[SETUP-CONNECT]` entries in system logs.

**Cause:** iPhone captive portal browser uses `window.location.origin` which returns `http://captive.apple.com` instead of `http://192.168.4.1`. API calls silently fail because they go to wrong server.

**Fix (Applied Nov 23, 2025):** `trap-spa/src/lib/api.js` now has `getBaseUrl()` function that detects captive portal mode and redirects to `192.168.4.1`:
```javascript
function getBaseUrl() {
  const origin = window.location.origin;
  if (origin.includes('192.168.') || origin.includes('localhost') || origin.includes('mousetrap.local')) {
    return origin;
  }
  return 'http://192.168.4.1';  // Captive portal fallback
}
```

**If issue persists:**
1. Rebuild SPA: `./build-littlefs.sh`
2. Upload to device: `curl -u "ops:changeme" -F "file=@build/littlefs.bin" http://<device-ip>/uploadfs`

---

### Standalone Mode Not Working

**Symptom:** Device still shows captive portal redirect after enabling standalone mode.

**Causes:**
1. Wrong Preferences object used (bug fixed Nov 23, 2025)
2. `standalone` flag not being read from NVS

**Check system logs for:**
```
[BOOT] Standalone mode: true
[AP MODE] Standalone mode - DNS server skipped
```

**If missing:**
1. Ensure firmware has `loadWiFiCredentials()` reading standalone flag from `devicePrefs`
2. Ensure `/api/setup/standalone` endpoint uses `devicePrefs` not `preferences`

---

### No Logs Appearing in System Logs

**Symptom:** Endpoints execute but no log entries in `/api/system-logs`

**Cause:** Endpoint using `Serial.println()` instead of `addSystemLog()`

**Fix:** Ensure endpoints use:
```cpp
addSystemLog("[TAG] Message");    // Shows in SPA
Serial.println("[TAG] Message");  // Shows in serial monitor
```

---

## Device Claiming

### Can't Claim Device

**Causes:**
- Claim code expired (7 days)
- Code already used
- Device already claimed
- MAC address issue

**Fix:**
1. Generate new claim code
2. Unclaim device first if needed
3. Check system logs for MAC address
4. Verify server is reachable

---

### Device Shows Wrong MAC

**Symptom:** MAC shows as `00:00:00:00:00:00`

**Cause:** MAC read before WiFi init

**Status:** ✅ FIXED in latest firmware

**Verify:** Serial logs show:
```
[SETUP] MAC address: 94:A9:90:30:60:28
```

---

## SPA Issues

### SPA Doesn't Load (404)

**Cause:** LittleFS not mounted or files missing

**Fix:**
1. Check serial logs for LittleFS mount
2. Rebuild filesystem:
   ```bash
   ./build-littlefs.sh
   ```
3. Upload to device:
   ```bash
   curl -u "ops:changeme" -F "file=@build/littlefs.bin" http://192.168.133.46/uploadfs
   ```

---

### SPA Shows Old Version

**Cause:** Browser cache

**Fix:**
- Hard refresh: `Ctrl+Shift+R` (Win) or `Cmd+Shift+R` (Mac)
- Clear cache
- Incognito mode

---

### Assets Not Loading (CSS/JS 404)

**Cause:** SPA not rebuilt before filesystem image created

**Fix:**
1. Rebuild SPA:
   ```bash
   cd trap-spa && npm run build && cd ..
   ```
2. Rebuild filesystem:
   ```bash
   ./build-littlefs.sh
   ```
3. Redeploy to device

---

## Camera Issues

### Camera Not Working

**Symptom:** `/camera` endpoint returns error

**Check:**
- Camera initialized in setup()
- PSRAM available
- Camera hardware connected

**Serial logs:**
```
[Camera] Failed to initialize
[Camera] PSRAM not found
```

**Fix:**
- Verify FQBN has `PSRAM=opi`
- Check camera hardware connection
- Power cycle device

---

### Camera Images Blank/Corrupt

**Cause:**
- Insufficient PSRAM
- Framebuffer leak
- Camera settings

**Fix:**
1. Check debug dashboard for framebuffer stats
2. Monitor PSRAM usage
3. Reboot device

See [DEBUG-TOOLS.md](./DEBUG-TOOLS.md)

---

## System Crashes

### Device Crashes on Boot

**Check:**
1. Boot reason in serial logs
2. Watchdog timeout
3. Memory issues

**Serial logs:**
```
rst:0x10 (RTCWDT_RTC_RESET),boot:0x33 (SPI_FAST_FLASH_BOOT)
```

**Fix:**
- Flash known-good firmware
- Check for infinite loops in code
- Monitor memory usage

---

### Random Crashes During Operation

**Symptom:** Device reboots unexpectedly

**Check:**
1. Debug dashboard for memory usage
2. Task stack overflows
3. Framebuffer leaks

**Fix:**
1. Access `/debug` endpoint
2. Check for:
   - Heap/PSRAM exhaustion
   - Stack overflow (>80%)
   - Framebuffer outstanding >3
3. Review crash breadcrumbs

See [DEBUG-TOOLS.md](./DEBUG-TOOLS.md)

---

### Stack Overflow

**Symptom:**
```
***ERROR*** A stack overflow in task <TaskName> has been detected.
```

**Cause:** Task stack too small for operations

**Fix:**
- Increase task stack size in firmware
- Reduce local variable sizes
- Move large buffers to heap/PSRAM

---

## Memory Issues

### Out of Memory (OOM)

**Symptom:**
```
[ERROR] Failed to allocate memory
```

**Causes:**
- Too many camera buffers allocated
- Large data structures
- Memory leak

**Check:**
```bash
curl http://192.168.133.46/api/debug-stats | grep memory
```

**Fix:**
1. Monitor framebuffer statistics
2. Reduce buffer sizes
3. Implement buffer cleanup
4. Reboot device

---

### PSRAM Exhausted

**Symptom:** Camera operations fail

**Cause:** PSRAM full from framebuffers or other allocations

**Fix:**
1. Check debug dashboard: PSRAM usage
2. Ensure framebuffers are released
3. Reboot device

---

## Upload/Port Issues

### Port Busy Error

**Symptom:**
```
Error: port busy
```

**Cause:** Another process using USB port

**Fix:**
```bash
# Find process
lsof | grep cu.usbmodem
# Kill it
kill <PID>
```

Or close Arduino IDE / serial monitors

---

### Device Not Detected

**Symptom:** `arduino-cli board list` shows no devices

**Fix:**
1. Try different USB port
2. Try different USB cable (must support data)
3. Install CH340 drivers:
   ```bash
   brew install --cask wch-ch34x-usb-serial-driver
   ```
4. Hold BOOT button while connecting

---

## Debug Information

### View System Logs

```bash
curl -u "ops:changeme" http://192.168.133.46/api/system-logs | \
  python3 -c "import sys, json; logs=json.load(sys.stdin); print('\\n'.join(logs[-50:]))"
```

### View Debug Dashboard

Browser: `http://192.168.133.46/debug`

Login: `ops:changeme`

Shows:
- Memory usage
- Task stacks
- Framebuffer stats
- I2C health
- Crash info

---

## Getting Help

When reporting issues, include:

1. **Device info:**
   ```bash
   curl http://192.168.133.46/api/system-info
   ```

2. **System logs:**
   ```bash
   curl -u "ops:changeme" http://192.168.133.46/api/system-logs
   ```

3. **Debug stats:**
   ```bash
   curl -u "ops:changeme" http://192.168.133.46/api/debug-stats
   ```

4. **Serial output** (if device accessible via USB)

5. **Steps to reproduce**

---

**Related Documentation:**
- [FIRMWARE-COMPILATION.md](./FIRMWARE-COMPILATION.md) - Compilation issues
- [OTA-DEPLOYMENT.md](./OTA-DEPLOYMENT.md) - OTA issues
- [DEVICE-CLAIMING.md](./DEVICE-CLAIMING.md) - Claiming issues
- [DEBUG-TOOLS.md](./DEBUG-TOOLS.md) - Debug dashboard
- [SPA-DEVELOPMENT.md](./SPA-DEVELOPMENT.md) - SPA issues
