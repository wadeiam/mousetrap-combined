# Device Claiming Guide

**Device provisioning and tenant binding system**

---

## Overview

Devices start **unclaimed** and must be provisioned with tenant credentials before connecting to the server/MQTT broker.

**Two Claiming Methods Available:**
1. **Seamless Claiming (NEW)** - Button-activated, zero-configuration setup for retail/consumer devices
2. **Manual Claiming (Legacy)** - Claim code entry for advanced users

---

## Method 1: Seamless Claiming (Recommended)

**Added:** 2025-11-19
**Purpose:** Amazon/retail device setup - zero technical knowledge required

### User Experience Flow

```
1. User receives device from Amazon
    ↓
2. User powers on device, connects to WiFi (via AP mode)
    ↓
3. User presses and holds button for 5 seconds
    ↓
4. Device enters claiming mode (10-minute window)
   - Device beeps (ascending tones: 400→600→800Hz)
   - LED blinks rapidly (5 times)
   - Device notifies server via HTTP POST
   - mDNS advertising updates (claiming=true)
    ↓
5. User opens browser to setup.domain.com
    ↓
6. User creates account (email + password + tenant name)
    ↓
7. Browser discovers device (Web Bluetooth or mDNS)
   - Gets device MAC address
    ↓
8. Browser submits claim to server
   - Server generates claim code
   - Server validates claiming window
   - Server creates MQTT credentials
   - Server returns credentials to browser
    ↓
9. Browser completes claiming
   - Device polls server for credentials
   - Device saves to NVS
   - Device connects to MQTT
    ↓
10. Claimed Device
```

### Button Behavior

**Normal Press (< 5 seconds):**
- Clears alarm/detection state (existing behavior)

**Long Press (≥ 5 seconds):**
- Enters claiming mode (if device is unclaimed)
- Audio feedback every second during hold (300Hz beep)
- Final confirmation: ascending tones + LED blinks

**If Already Claimed:**
- Button long-press is rejected
- Error feedback: 3 rapid low beeps (200Hz)
- Log message: "Attempted to enter claiming mode while already claimed"

### Claiming Mode Details

**Duration:** 10 minutes (600,000 ms)

**Auto-Exit Triggers:**
- 10-minute timeout
- Device successfully claimed
- Manual exit (future feature)

**Server Notification:**
- Endpoint: `POST /api/device/claiming-mode`
- Payload: `{ "mac": "AA:BB:CC:DD:EE:FF", "ip": "192.168.1.100" }`
- Server adds entry to `device_claiming_queue` table
- Entry expires after 10 minutes

**mDNS Advertising:**
- Hostname: `mousetrap.local`
- Service: `_http._tcp`
- TXT Records:
  - `device=mousetrap`
  - `mac=AABBCCDDEEFF`
  - `ip=192.168.1.100`
  - `claiming=true` (updated dynamically)
  - `name=DeviceName` (or "MouseTrap" if unclaimed)

**Credential Polling:**
- While in claiming mode, device polls server every 5 seconds
- Endpoint: `GET /api/device/check-claim/{macAddress}`
- Server returns `claimed: false` until browser completes claim
- When claimed, server returns credentials (deviceId, tenantId, MQTT credentials)
- Device saves credentials to NVS, connects to MQTT, exits claiming mode

**Flow:**
```
1. Device enters claiming mode
2. Device notifies server (POST /api/device/claiming-mode)
3. User completes registration & claim via browser
4. Device polls server every 5s (GET /api/device/check-claim)
5. Server returns credentials when claim complete
6. Device saves to NVS, connects MQTT, exits claiming mode
```

### LED & Audio Feedback

**Entering Claiming Mode:**
```
1. Ascending tone sequence (400Hz → 600Hz → 800Hz)
2. 5 rapid LED blinks (100ms on, 100ms off)
3. Log: "[CLAIMING] Device entered claiming mode"
```

**Button Hold Feedback:**
```
Every 1 second: 50ms beep at 300Hz
```

**Exiting Claiming Mode:**
```
Single beep at 400Hz for 200ms
```

**Error (Already Claimed):**
```
3 rapid low beeps at 200Hz
```

### Web Portal Discovery

**Development (Server on Local Network):**
- Browser calls `GET /api/device/discover`
- Server performs mDNS discovery
- Returns list of devices in claiming mode

**Production (Server in Cloud):**
- Browser uses Web Bluetooth API
- OR user visits device's IP directly
- Browser gets MAC address from device
- Browser submits claim with MAC to server

**Important:** Server-side mDNS discovery doesn't work when server is in the cloud (NAT/firewall). Use Web Bluetooth or manual IP discovery.

### Firmware Code Locations

| Function | Location | Purpose |
|----------|----------|---------|
| `enterClaimingMode()` | `mousetrap_arduino.ino:2794-2837` | Enter claiming mode with validations |
| `exitClaimingMode()` | `mousetrap_arduino.ino:2839-2857` | Exit claiming mode, update mDNS |
| `checkClaimCompletion()` | `mousetrap_arduino.ino:2862-3010` | Poll server for claim status & retrieve credentials |
| `checkClaimingModeTimeout()` | `mousetrap_arduino.ino:3012-3018` | Auto-exit after 10 minutes |
| `checkButtonForClaimingMode()` | `mousetrap_arduino.ino:3020-3070` | 5-second press detection |
| `notifyServerClaimingMode()` | `mousetrap_arduino.ino:2738-2791` | HTTP POST to server |
| `startMdnsService()` | `mousetrap_arduino.ino:3073-3087` | Initialize mDNS advertising |
| `updateMdnsTxtRecords()` | `mousetrap_arduino.ino:3089-3111` | Update claiming flag in mDNS |

**State Variables:**
```cpp
bool claimingModeActive = false;
unsigned long claimingModeStartTime = 0;
const unsigned long CLAIMING_MODE_BUTTON_HOLD_MS = 5000;
const unsigned long CLAIMING_MODE_DURATION_MS = 600000;  // 10 min
bool claimingModeNotified = false;
unsigned long lastClaimCheckTime = 0;
const unsigned long CLAIM_CHECK_INTERVAL_MS = 5000;  // Check every 5 seconds
```

**Loop Integration:**
```cpp
// In loop() at line 10159-10161:
checkButtonForClaimingMode();
checkClaimCompletion();  // Poll server to check if claimed
checkClaimingModeTimeout();
```

---

---

## Method 2: Captive Portal Setup Wizard (New Devices)

**Added:** 2025-11-23
**Purpose:** WiFi setup with optional cloud registration via captive portal

### User Experience Flow

```
1. User powers on new device
    ↓
2. Device starts as WiFi AP (MouseTrap-XXXX)
    ↓
3. User connects phone to AP
    ↓
4. Captive portal automatically opens (or go to 192.168.4.1)
    ↓
5. Setup wizard shows:
   - Welcome screen with options:
     a) "Get Started" → Cloud registration flow
     b) "Standalone Mode" → Local-only mode
    ↓
6a. Cloud Registration:
   - Scan for WiFi networks
   - Enter WiFi credentials
   - Enter email/password for account
   - Device saves credentials, reboots
   - Device connects to WiFi and registers with server
    ↓
6b. Standalone Mode:
   - Scan for WiFi networks
   - Enter WiFi credentials only
   - Device saves credentials + standalone flag
   - Device reboots
   - Device connects to WiFi (no cloud registration)
   - User can browse to device IP directly
```

### Standalone Mode

**Purpose:** Allow device to connect to WiFi without cloud registration. Useful for:
- Development/debugging
- Users who don't want cloud features
- Testing device locally

**How it works:**
1. Device saves `standalone=true` flag to NVS
2. On boot, device checks this flag
3. If standalone, DNS captive portal redirect is disabled
4. Device connects to WiFi normally
5. User browses directly to device IP (shown in SPA after setup)

**API Endpoint:** `POST /api/setup/standalone`
```json
{
  "ssid": "NetworkName",
  "password": "wifiPassword"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Standalone mode enabled. Device will reboot."
}
```

### Captive Portal URL Detection

**Problem:** On iPhone, captive portal browser uses `window.location.origin` = `http://captive.apple.com` instead of `http://192.168.4.1`. This breaks API calls.

**Solution:** `trap-spa/src/lib/api.js` has `getBaseUrl()` function that detects captive portal mode:
```javascript
function getBaseUrl() {
  const origin = window.location.origin;
  if (origin.includes('192.168.') || origin.includes('localhost') || origin.includes('mousetrap.local')) {
    return origin;
  }
  return 'http://192.168.4.1';  // Captive portal fallback
}
```

### Firmware Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/wifi/scan` | GET | Scan for available WiFi networks |
| `/api/setup/connect` | POST | Cloud registration setup |
| `/api/setup/standalone` | POST | Standalone mode setup |

### Firmware Code Locations

| Function | Location | Purpose |
|----------|----------|---------|
| `/api/setup/connect` handler | `mousetrap_arduino.ino:8595-8640` | Process cloud registration |
| `/api/setup/standalone` handler | `mousetrap_arduino.ino:8650-8720` | Process standalone mode |
| `loadWiFiCredentials()` | `mousetrap_arduino.ino:1749-1764` | Load WiFi + standalone flag |
| Boot logic (DNS skip) | `mousetrap_arduino.ino:10145-10151` | Skip DNS if standalone |

---

## Method 3: Manual Claiming (Legacy)

### Claiming Flow

```
Unclaimed Device
    ↓
User generates claim code (via server dashboard)
    ↓
User enters claim code on device
    ↓
Device contacts server with code + MAC address
    ↓
Server validates code and assigns tenant
    ↓
Server returns MQTT credentials
    ↓
Device saves credentials to NVS
    ↓
Device connects to MQTT broker
    ↓
Claimed Device
```

---

## Device-Side Claiming

### Claim API Endpoint

**POST** `/api/devices/claim`

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

### Stored in NVS

Credentials saved to Non-Volatile Storage:
- `claimed` (boolean)
- `deviceId` (UUID)
- `deviceName` (string)
- `tenantId` (UUID)
- `mqttClientId` (MAC without colons)
- `mqttUsername` (same as clientId)
- `mqttPassword` (plaintext)
- `mqttBroker` (IP)
- `mqttPort` (1883)

**Important:** NVS is separate from LittleFS, so filesystem updates don't affect claim status.

---

## Check Claim Status

### API Endpoint

**GET** `/api/device/claim-status`

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

## Unclaiming

### User-Initiated Unclaim

From device SPA: Navigate to **Maintenance → Claim** page and click "Unclaim Device"

**POST** `/api/device/unclaim`

**Process:**
1. Device clears NVS credentials
2. Device notifies server via `POST /api/device/unclaim-notify` (with MAC)
3. Server marks device as unclaimed (soft delete)
4. Server removes MQTT credentials from Mosquitto
5. Device disconnected from MQTT (rc=5: not authorized)
6. Device shows as unclaimed in SPA

**Logs IP address of unclaim requester** (added 2025-11-16)

### Server-Initiated Unclaim (Bulletproof Token Verification)

**Added:** 2025-11-27

Server unclaims use **token-verified revocation** to prevent accidental unclaims from network issues.

**Flow:**
```
1. Admin clicks "Unclaim" in dashboard
2. Server generates one-time revocation token (5 min expiry)
3. Server stores token in revocationTokens Map (devices.routes.ts)
4. Server sends MQTT /revoke message WITH token
5. Device receives message, extracts token
6. Device calls POST /api/device/verify-revocation
7. Server validates: token exists, not expired, matches device MAC
8. If valid: Server deletes token, returns {valid: true}
9. Device unclaims only if server confirms token
10. ANY ERROR = Device stays claimed
```

**MQTT Revocation Topic:** `tenant/{tenantId}/device/{MAC}/revoke`

**Revocation Message:**
```json
{
  "action": "revoke",
  "token": "64-char-hex-token",
  "timestamp": 1700000000000,
  "reason": "Admin unclaimed device"
}
```

**Device Token Verification:**
- Endpoint: `POST /api/device/verify-revocation`
- Request: `{ "mac": "94A990306028", "token": "..." }`
- Response: `{ "valid": true }` or `{ "valid": false, "reason": "..." }`

**Security Hardening:**
- Token is one-time use (deleted after verification)
- Token expires after 5 minutes
- Token is bound to specific device MAC
- Network errors = device stays claimed
- Invalid token = device stays claimed
- Server 500 error = device stays claimed

**Firmware Code:**
- Token verification: `verifyRevocationToken()` at `mousetrap_arduino.ino:1403-1478`
- MQTT revoke handler: `mousetrap_arduino.ino:2430-2466`

**Server Code:**
- Token generation: `devices.routes.ts` `/devices/:id/unclaim` endpoint
- Token store: `revocationTokens` Map with 5-min expiry
- Verification endpoint: `claim.routes.ts` `/device/verify-revocation`

---

## Re-Claiming

Can re-claim previously unclaimed device:
1. Server deletes old unclaimed record (if exists)
2. Generate new claim code
3. Enter code on device
4. Device gets fresh credentials

---

## MAC Address

### How Device Gets MAC

Firmware uses `esp_read_mac()` to read MAC directly from hardware:

```cpp
uint8_t mac[6];
esp_read_mac(mac, ESP_MAC_WIFI_STA);
```

**Format:**
- With colons: `94:A9:90:30:60:28`
- Without colons (for MQTT clientId): `94A990306028`

### MAC in Claim Process

Device sends MAC without colons during claim. Server uses this as:
- MQTT client ID
- MQTT username
- Device identifier

---

## Claim Codes

*Note: Claim codes are generated by the server. See server documentation.*

**Format:** 8-character alphanumeric (no ambiguous chars)
- Example: `ABC12XYZ`
- Valid for: 7 days
- Single-use: Marked as 'claimed' after use

---

## NVS Preferences

Firmware uses ESP32 Preferences library:

```cpp
Preferences preferences;
preferences.begin("config", false);

// Save
preferences.putBool("claimed", true);
preferences.putString("deviceId", deviceId);
// ... etc

// Load
bool claimed = preferences.getBool("claimed", false);
String deviceId = preferences.getString("deviceId", "");

preferences.end();
```

**Namespace:** `config`

---

## Troubleshooting

### Device Won't Claim

**Check:**
1. Claim code is valid (not expired, not already used)
2. Device has internet access
3. Server is reachable
4. System logs for errors

**Common errors:**
- `Claim code not found or expired` - Generate new code
- `Device already claimed` - Unclaim first
- `Network error` - Check WiFi connection

### MQTT Won't Connect After Claim

**Symptom:** Device claimed but MQTT shows "Not Connected"

**Cause:** Server-side MQTT credential sync failure

**Check:**
1. Mosquitto password file has device entry
2. Mosquitto was reloaded after claim
3. Device has correct MQTT credentials in NVS

**Fix:** See server MQTT troubleshooting guide

### Spontaneous Unclaim (FIXED in v2.0.49)

**Symptom:** Device unclaims unexpectedly

**Status:** ✅ FIXED with bulletproof token-verified revocation (2025-11-27)

**Previous causes (now mitigated):**
1. ~~Filesystem OTA triggered unclaim~~ → OTA no longer affects claim status
2. ~~MQTT auth failure triggered auto-unclaim~~ → Now requires token verification
3. ~~Server sent unclaim command~~ → Now requires valid token
4. User clicked unclaim in SPA → Legitimate unclaim with audit trail

**New Security:**
- Device ONLY unclaims if server verifies token via HTTP
- Network errors = device stays claimed
- Invalid/expired tokens = device stays claimed
- `/api/device/claim-status` returns 404 (not `claimed:false`) if device not found

**Audit Trail:**
- All unclaim operations logged to `device_claim_audit` table
- Source tracked: `factory_reset`, `local_ui`, `mqtt_revoke`, `claim_verify`, `admin_dashboard`
- Actor IP address recorded

**Check:**
- System logs for unclaim event with source
- Database `device_claim_audit` table for full history
- Server logs for `/api/device/verify-revocation` calls

### Device Shows Wrong MAC (00:00:00:00:00:00)

**Cause:** MAC read before WiFi hardware initialized

**Status:** ✅ FIXED - Firmware now uses `esp_read_mac()` before WiFi init

**Verify:** Check serial logs for correct MAC:
```
[SETUP] MAC address: 94:A9:90:30:60:28
```

---

## Claim Status in SPA

The device SPA shows claim status on Dashboard page:

**Unclaimed:**
```
Claim Status: Device not claimed - provisioning required
```

**Claimed:**
```
Claim Status: Claimed to Kitchen Trap
```

**Location:** Dashboard → Claim Status card

**Code:** `trap-spa/src/pages/Dashboard.svelte:362-367`

---

## Security Notes

- MQTT credentials stored in NVS (not visible in SPA)
- Claim endpoint is public (required for provisioning)
- Unclaim endpoint requires device auth
- Server validates claim codes before issuing credentials

---

## Related Firmware Code

| File/Location | Purpose |
|---------------|---------|
| `mousetrap_arduino.ino:1148-1195` | `unclaimDevice()` function |
| `mousetrap_arduino.ino:7398-7402` | Unclaim API endpoint with IP logging |
| `mousetrap_arduino.ino:7335-7353` | Claim status API endpoint |
| `mousetrap_arduino.ino:1806-1819` | Auto-unclaim on auth failure |

---

**Related Documentation:**
- [DEVICE-API.md](./DEVICE-API.md) - Claim/unclaim API endpoints
- [SPA-DEVELOPMENT.md](./SPA-DEVELOPMENT.md) - Claim status UI
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Claim issues
