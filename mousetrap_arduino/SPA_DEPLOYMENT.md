# Svelte SPA Deployment Workflow

Complete guide for building and deploying the on-device web interface.

## Overview

The Svelte SPA (`trap-spa/`) is a local web interface that runs directly on each ESP32 device. It's stored in the LittleFS filesystem partition and served by the device's AsyncWebServer.

## Quick Start

```bash
# From the project root
./build-littlefs.sh
```

This will:
1. Build the Svelte app
2. Create a LittleFS filesystem image
3. Output `build/littlefs.bin` ready for upload

## Detailed Steps

### 1. Update SPA Version

Edit `trap-spa/dist/version.json` (or create if missing):

```json
{
  "version": "1.2.0",
  "buildDate": "2024-11-09",
  "changelog": "Added new calibration features"
}
```

### 2. Build the SPA

```bash
cd trap-spa
npm install              # First time only
npm run build
```

This creates production-ready files in `trap-spa/dist/`:
- `index.html` - Entry point
- `assets/*.js` - JavaScript bundles
- `assets/*.css` - Stylesheets
- `version.json` - Version metadata
- `vite.svg` - Logo/favicon

### 3. Build LittleFS Image

```bash
cd ..                    # Back to project root
./build-littlefs.sh
```

Output example:
```
Using mklittlefs: /Users/.../mklittlefs/4.0.2-db0513a/mklittlefs
Building Svelte SPA...
Creating LittleFS image...

✓ LittleFS image created successfully!
  File: /Users/.../build/littlefs.bin
  Size: 11403264 bytes
  SHA256: a1b2c3d4e5f6...

To upload via OTA:
  1. Go to Dashboard → Firmware
  2. Select 'filesystem' type
  3. Upload: /Users/.../build/littlefs.bin
```

### 4. Deploy to Devices

#### Option A: Cloud Dashboard (Recommended for Fleet Updates)

1. Open Dashboard: http://192.168.133.110:5173
2. Login with admin credentials
3. Navigate to **Firmware** page
4. Fill in upload form:
   - **File**: Select `build/littlefs.bin`
   - **Version**: Match the version in `version.json` (e.g., `1.2.0`)
   - **Type**: Select **"filesystem"**
   - **Changelog**: Brief description of changes
   - **Required Update**: Check if mandatory
   - **Global**: Check to deploy to all tenants
5. Click **"Upload & Publish to Devices"**

The server will:
- Upload and store the `.bin` file
- Calculate SHA256 checksum
- Publish MQTT notification to `global/filesystem/latest` or `tenant/{id}/filesystem/latest`
- Devices receive notification and download automatically

#### Option B: ElegantOTA (Manual Single Device)

1. Navigate to device: `http://<device-ip>/update`
2. Enter OTA credentials:
   - Username: `ops`
   - Password: `changeme`
3. Click **"Filesystem"** tab
4. Choose `build/littlefs.bin`
5. Click **"Update"**
6. Wait for upload and flash (~30 seconds)
7. Device will reboot automatically

### 5. Verify Deployment

After device reboots:

1. Navigate to device: `http://<device-ip>/`
2. Check version in footer or settings page
3. Verify new features are present
4. Check System Logs for any errors

You can also check via MQTT:
```bash
mosquitto_sub -h 192.168.133.110 -p 1883 \
  -u mqtt_client -P mqtt_password123 \
  -t "device/+/status" -v
```

Look for `filesystemVersion` in device status messages.

## Version Management

### Filesystem Version vs Firmware Version

The device tracks two separate versions:

1. **Firmware Version** (`FIRMWARE_VERSION` in `.ino` file)
   - ESP32 application code
   - Flashed to app0/app1 partitions
   - Example: `v1.1.0`

2. **Filesystem Version** (stored in Preferences)
   - Svelte SPA and static assets
   - Flashed to littlefs partition
   - Example: `1.2.0`

### Version Comparison

The OTA update handler compares versions lexicographically:
- `1.2.0` > `1.1.0` ✓ (will update)
- `1.1.0` <= `1.1.0` ✗ (skips - already up to date)
- `1.0.9` < `1.1.0` ✗ (skips - downgrade blocked)

**Important:** Always use semantic versioning (e.g., `1.2.0`) for proper comparison.

## Troubleshooting

### Build Failures

**Error: `mklittlefs not found`**
```bash
# Install ESP32 Arduino core
arduino-cli core install esp32:esp32
```

**Error: `npm: command not found`**
```bash
# Install Node.js
brew install node
```

### Upload Failures

**Error: `Download failed: HTTP -1`**
- Check `API_BASE_URL` in server `.env` points to network-accessible IP
- Don't use `localhost` - use actual IP like `192.168.133.110`

**Error: `SHA256 mismatch`**
- File corrupted during download
- Try uploading again
- Check network stability

**Error: `Not enough space`**
- LittleFS partition is 11MB (0xAE0000)
- Current build is ~120KB, plenty of room
- If needed, reduce asset sizes or partition size

### Runtime Issues

**SPA doesn't load (404 errors)**
```cpp
// Check LittleFS is mounted in setup()
if (!LittleFS.begin(true)) {
  Serial.println("LittleFS mount failed");
}
```

**Old version still showing**
- Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- Clear browser cache
- Try incognito/private mode

**Assets not loading (CSS/JS 404)**
- Vite generates hashed filenames (e.g., `index-DcOznUuf.js`)
- Ensure you built with `npm run build` before running `build-littlefs.sh`
- Check files exist in `trap-spa/dist/assets/`

## Development Workflow

For active SPA development:

1. **Local Development** (fastest iteration):
   ```bash
   cd trap-spa
   npm run dev
   ```
   - Opens on `http://localhost:5173`
   - Hot module replacement (instant updates)
   - Connect to real device API by updating fetch URLs

2. **Test on Device** (realistic environment):
   ```bash
   ./build-littlefs.sh
   # Upload via ElegantOTA to test device
   ```

3. **Production Deployment** (fleet rollout):
   ```bash
   ./build-littlefs.sh
   # Upload via Dashboard with "Global" checked
   ```

## File Sizes

Typical build sizes (after minification):

| File | Size |
|------|------|
| index.html | ~550 bytes |
| JavaScript bundle | ~90 KB |
| CSS bundle | ~31 KB |
| Images/SVG | ~2 KB |
| **Total** | **~124 KB** |

LittleFS partition: 11 MB (plenty of headroom for future growth)

## Best Practices

1. **Always version your builds** - Include version in `version.json`
2. **Test locally first** - Use ElegantOTA on one device before fleet deployment
3. **Semantic versioning** - Use `MAJOR.MINOR.PATCH` format
4. **Changelog everything** - Document what changed for troubleshooting
5. **Backup before major updates** - Save current `littlefs.bin` in case rollback needed
6. **Monitor first device** - Watch System Logs during first deployment
7. **Staged rollouts** - Deploy to test tenant before marking Global

## Architecture Notes

### Why LittleFS Instead of Multiple File Upload?

ESP32 OTA can only flash complete partition images, not individual files. The `U_SPIFFS` update type expects a complete filesystem binary.

### Why Not SPIFFS?

LittleFS is more robust and modern:
- Wear leveling
- Faster mount times
- Better power-loss resistance
- Recommended for ESP-IDF 5.x

### Build Tool: mklittlefs

The `mklittlefs` tool is part of ESP32 Arduino core and creates filesystem images compatible with ESP32's partition format.

Parameters:
- `-c <dir>` - Source directory (trap-spa/dist)
- `-s <size>` - Partition size in bytes (0xAE0000 = 11403264)
- `-b <size>` - Block size (4096 - matches flash)
- `-p <size>` - Page size (256 - matches flash)

## Related Files

- `build-littlefs.sh` - Main build script
- `partitions.csv` - Partition layout (defines LittleFS size)
- `trap-spa/` - Svelte source code
- `trap-spa/dist/` - Built SPA files
- `build/littlefs.bin` - Final filesystem image
- `ESP32_SETTINGS_REFERENCE.md` - Full system documentation
