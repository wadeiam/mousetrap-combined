# Device API Reference

**HTTP API endpoints served by the ESP32 device**

Access at: `http://<device-ip>/<endpoint>`

---

## Authentication

Most endpoints require HTTP Basic Auth:
- **Username:** `ops`
- **Password:** `changeme`

Public endpoints (no auth required):
- `/` - Main SPA entry
- `/app/*` - SPA assets
- `/camera` - Camera feed (no LED)
- `/auto.jpg` - Camera snapshot (with LED)
- Claim/provisioning endpoints

---

## SPA & Static Files

### `GET /`
Redirects to `/app/`

**Response:** 302 redirect

### `GET /app/`
Serves the Svelte SPA from LittleFS

**Response:** HTML (index.html)

### `GET /app/assets/*`
Serves SPA assets (JS, CSS, images)

**Response:** Static files

---

## Camera

### `GET /camera`
Camera image without LED flash

**Use case:** Live video feed, frequent polling

**Response:** JPEG image

**Example:**
```bash
curl http://192.168.133.46/camera > snapshot.jpg
```

### `GET /auto.jpg`
Camera image with LED flash

**Use case:** Manual refresh, better quality

**Response:** JPEG image

**Example:**
```bash
curl http://192.168.133.46/auto.jpg > snapshot.jpg
```

---

## Device Status & Info

### `GET /api/status`
Get current device status

**Response:**
```json
{
  "wifi_connected": true,
  "mqtt_connected": true,
  "sensor_range_mm": 45,
  "alarm_armed": true,
  "led_enabled": false
}
```

### `GET /api/system-info`
Get comprehensive system information

**Response:**
```json
{
  "deviceId": "94A990306028",
  "firmwareVersion": "v1.3.7",
  "filesystemVersion": "2.0.39",
  "firmwareUpdateTime": 1731234567,
  "filesystemUpdateTime": 1731234890,
  "mac": "94:A9:90:30:60:28",
  "heap_free": 156000,
  "psram_free": 2048000
}
```

### `GET /api/device/claim-status`
Check if device is claimed

**Response (claimed):**
```json
{
  "claimed": true,
  "deviceId": "abc-123",
  "deviceName": "Kitchen Trap",
  "tenantId": "tenant-uuid",
  "mqttClientId": "94A990306028",
  "mqttBroker": "192.168.133.110",
  "mqttConnected": true
}
```

**Response (unclaimed):**
```json
{
  "claimed": false,
  "macAddress": "94A990306028",
  "message": "Device not claimed - provisioning required"
}
```

---

## Device Control

### `POST /api/toggle-led`
Toggle LED on/off

**Auth:** Required

**Request:** None

**Response:**
```json
{
  "led_enabled": true
}
```

### `POST /api/reboot`
Reboot device

**Auth:** Required

**Request:** None

**Response:**
```json
{
  "message": "Rebooting..."
}
```

Device becomes unresponsive for ~8 seconds.

### `POST /api/reset-alarm`
Reset alarm state (after trigger)

**Auth:** Required

**Request:** None

**Response:**
```json
{
  "success": true
}
```

### `POST /api/false-alarm`
Report false alarm (adjusts detection threshold)

**Auth:** Required

**Request:** None

**Response:**
```json
{
  "success": true,
  "new_threshold_mm": 50
}
```

### `POST /api/heartbeat`
Send heartbeat (resets watchdog timer)

**Auth:** Required

**Request:** None

**Response:**
```json
{
  "success": true
}
```

---

## Device Claiming

### `POST /api/devices/claim`
Claim device with claim code

**Auth:** NOT required (public endpoint for provisioning)

**Request:**
```json
{
  "claimCode": "ABC12XYZ",
  "macAddress": "94A990306028"
}
```

**Response (success):**
```json
{
  "success": true,
  "device": {
    "id": "device-uuid",
    "name": "Kitchen Trap",
    "mqttUsername": "94A990306028",
    "mqttPassword": "generated-password",
    "mqttBroker": "192.168.133.110",
    "mqttPort": 1883,
    "tenantId": "tenant-uuid"
  }
}
```

**Response (error):**
```json
{
  "error": "Invalid claim code or already used"
}
```

### `POST /api/device/unclaim`
Unclaim device (reset to factory provisioning state)

**Auth:** Required

**Request:** None

**Response:**
```json
{
  "success": true,
  "message": "Device unclaimed successfully"
}
```

**Side effects:**
- Clears NVS credentials
- Notifies server via `POST /api/device/unclaim-notify`
- Device shows as unclaimed in SPA
- Logs IP address of requester

---

## Logs & Debug

### `GET /api/system-logs`
Get system log entries

**Auth:** Required

**Response:**
```json
[
  "[2025-11-16 10:23:45] WiFi connected",
  "[2025-11-16 10:23:50] MQTT connected",
  "[2025-11-16 10:24:00] Sensor reading: 45mm",
  ...
]
```

**Example:**
```bash
curl -u "ops:changeme" http://192.168.133.46/api/system-logs | \
  python3 -c "import sys, json; logs=json.load(sys.stdin); print('\\n'.join(logs[-50:]))"
```

### `GET /debug`
Debug dashboard (HTML interface)

**Auth:** Required

**Response:** HTML page with:
- Memory usage (heap, PSRAM)
- Task stack usage
- Framebuffer statistics
- I2C health metrics
- System component status
- Last crash info

See [DEBUG-TOOLS.md](./DEBUG-TOOLS.md) for details.

### `GET /api/debug-stats`
Debug statistics (JSON API)

**Auth:** Required

**Response:**
```json
{
  "memory": {
    "heap_free": 152000,
    "heap_total": 200000,
    "psram_free": 1572864,
    "psram_total": 4194304
  },
  "tasks": [
    {"name": "SensorTask", "usage_pct": 30, "stack_size": 8192}
  ],
  "framebuffer": {
    "allocations": 1250,
    "releases": 1248,
    "outstanding": 2
  },
  "i2c": {
    "transactions": 10542,
    "successful": 10489,
    "failed": 53
  }
}
```

---

## OTA Updates

### `POST /uploadfw`
Upload firmware binary (OTA)

**Auth:** Required

**Request:** multipart/form-data with `file` field

**Response:** Upload progress, then "Update Success! Rebooting..."

**Example:**
```bash
curl -u "ops:changeme" \
  -F "file=@build/mousetrap_arduino.ino.bin" \
  http://192.168.133.46/uploadfw
```

**Process:**
1. Firmware uploaded to alternate app partition
2. Boot partition switched
3. Device reboots (~8 seconds)
4. Boots into new firmware

### `POST /uploadfs`
Upload filesystem binary (OTA)

**Auth:** Required

**Request:** multipart/form-data with `file` field

**Response:** Upload progress, then "Update Success! Rebooting..."

**Example:**
```bash
curl -u "ops:changeme" \
  -F "file=@build/littlefs.bin" \
  http://192.168.133.46/uploadfs
```

**Process:**
1. Filesystem uploaded to LittleFS partition
2. Device reboots (~30 seconds)
3. LittleFS auto-mounts with new content

**Warning:** Filesystem OTA may trigger device unclaim (known issue).

### `GET /update`
ElegantOTA web interface

**Auth:** Required

**Response:** HTML page with:
- Firmware upload tab
- Filesystem upload tab
- Upload progress
- Success/error messages

**Use case:** Manual OTA updates via web browser

---

## WiFi Configuration

### `POST /api/wifi/configure`
Configure WiFi credentials

**Auth:** Required

**Request:**
```json
{
  "ssid": "NetworkName",
  "password": "network-password"
}
```

**Response:**
```json
{
  "success": true,
  "message": "WiFi configured, rebooting..."
}
```

**Process:**
- Saves credentials to NVS
- Reboots device
- Connects to new network

---

## Servo & Calibration

### `GET /api/servo/status`
Get servo positions and calibration

**Auth:** Required

**Response:**
```json
{
  "armed_position": 90,
  "disarmed_position": 45,
  "current_position": 90,
  "calibrated": true
}
```

### `POST /api/servo/calibrate`
Set servo calibration positions

**Auth:** Required

**Request:**
```json
{
  "armed_position": 90,
  "disarmed_position": 45
}
```

**Response:**
```json
{
  "success": true,
  "saved": true
}
```

---

## Response Codes

| Code | Meaning | Common Cause |
|------|---------|--------------|
| 200 | OK | Request succeeded |
| 302 | Redirect | Root `/` redirects to `/app/` |
| 401 | Unauthorized | Missing or incorrect credentials |
| 404 | Not Found | Endpoint doesn't exist or file not in LittleFS |
| 500 | Internal Server Error | Device error or crash |

---

## Rate Limiting

No formal rate limiting, but:
- Camera endpoints: Recommended max 1 req/second
- Status endpoints: Can poll every 3-5 seconds
- Log endpoints: Recommended max 1 req/5 seconds

Excessive requests may cause:
- Device slowdown
- Memory exhaustion
- Connection timeouts

---

## CORS

All API endpoints support CORS for web-based clients.

**Headers:**
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

---

## Content Types

| Endpoint | Content-Type |
|----------|--------------|
| `/camera`, `/auto.jpg` | `image/jpeg` |
| `/api/*` | `application/json` |
| `/app/assets/*.js` | `application/javascript` |
| `/app/assets/*.css` | `text/css` |
| `/app/`, `/debug` | `text/html` |

---

## Error Responses

Most API endpoints return JSON errors:

```json
{
  "error": "Description of what went wrong",
  "code": "ERROR_CODE_IF_APPLICABLE"
}
```

Example:
```json
{
  "error": "Claim code not found or expired"
}
```

---

## Testing Endpoints

### Quick Health Check
```bash
# Check device is reachable
curl http://192.168.133.46/api/status

# Check claim status
curl http://192.168.133.46/api/device/claim-status

# Check system info
curl http://192.168.133.46/api/system-info
```

### Authenticated Endpoints
```bash
# Get logs
curl -u "ops:changeme" http://192.168.133.46/api/system-logs

# Reboot device
curl -u "ops:changeme" -X POST http://192.168.133.46/api/reboot

# View debug dashboard
open http://192.168.133.46/debug  # Browser will prompt for credentials
```

---

## Integration with SPA

The Svelte SPA uses these endpoints via `src/lib/api.js`:

```javascript
// Example API client functions
export async function getStatus() {
  const res = await fetch('/api/status');
  return res.json();
}

export async function getClaimStatus() {
  const res = await fetch('/api/device/claim-status');
  return res.json();
}

export async function rebootDevice() {
  const res = await fetch('/api/reboot', { method: 'POST' });
  return res.json();
}
```

See [SPA-DEVELOPMENT.md](./SPA-DEVELOPMENT.md) for SPA integration details.

---

**Related Documentation:**
- [SPA-DEVELOPMENT.md](./SPA-DEVELOPMENT.md) - SPA API integration
- [DEVICE-CLAIMING.md](./DEVICE-CLAIMING.md) - Claiming process
- [DEBUG-TOOLS.md](./DEBUG-TOOLS.md) - Debug dashboard
- [OTA-DEPLOYMENT.md](./OTA-DEPLOYMENT.md) - OTA endpoints
