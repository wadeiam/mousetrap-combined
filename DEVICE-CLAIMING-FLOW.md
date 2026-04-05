# MouseTrap Device Claiming Flow

**Last Updated:** 2026-01-19

This document describes the complete device claiming process, from factory-new device to fully operational and connected.

---

## Overview

MouseTrap uses a **Captive Portal** approach for device setup, combined with **HMAC-based authentication** to eliminate the need for manual claim codes.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DEVICE LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐          │
│   │   FACTORY    │      │   AP MODE    │      │  CONFIGURED  │          │
│   │     NEW      │ ───► │   + SETUP    │ ───► │  + CLAIMED   │          │
│   │              │      │   WIZARD     │      │              │          │
│   └──────────────┘      └──────────────┘      └──────────────┘          │
│                                ▲                      │                  │
│                                │   10-sec button     │                  │
│                                │   (Factory Reset)   │                  │
│                                └──────────────────────┘                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Button Functions

The device button has three functions based on press duration:

| Press Duration | Action | Feedback | Function |
|----------------|--------|----------|----------|
| < 1 second (click) | Release | Single beep | **Reset Alarm** - Clears active alert state. No effect if no active alert. |
| 2 seconds | Release | Double beep | **Reboot** - Soft restart of device. Preserves all settings and credentials. |
| 10 seconds | Continue holding | Ascending tones at 2s, 5s, 10s | **Factory Reset** - Unclaims device, clears WiFi credentials, enters AP mode for reclaiming. |

### Button Feedback Timeline (10-second hold)

```
0s          2s          5s          10s
│           │           │           │
▼           ▼           ▼           ▼
[Press]     [Beep 1]    [Beep 2]    [Long tone + LED flash]
            "Reboot     "Still      "Factory reset!"
            point"      holding..."
```

If released between 2-10 seconds: Device reboots (preserving settings)
If held past 10 seconds: Factory reset initiated

---

## HMAC-Based Device Authentication

Instead of manual claim codes, devices self-authenticate using HMAC.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HMAC AUTHENTICATION FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  DEVICE (Firmware)                    SERVER                             │
│  ┌────────────────────┐               ┌────────────────────┐            │
│  │ DEVICE_SECRET =    │               │ DEVICE_SECRET =    │            │
│  │ "shared-secret"    │               │ "shared-secret"    │            │
│  └────────────────────┘               └────────────────────┘            │
│           │                                    │                         │
│           ▼                                    │                         │
│  ┌────────────────────┐                        │                         │
│  │ token = HMAC-SHA256│                        │                         │
│  │  (secret, MAC)     │                        │                         │
│  └────────────────────┘                        │                         │
│           │                                    │                         │
│           │   POST /api/setup/register-and-claim                        │
│           │   {mac, token, email, password, deviceName}                 │
│           └──────────────────────────────────────►                      │
│                                                │                         │
│                                    ┌───────────▼───────────┐            │
│                                    │ expected = HMAC-SHA256│            │
│                                    │   (secret, MAC)       │            │
│                                    └───────────────────────┘            │
│                                                │                         │
│                                    ┌───────────▼───────────┐            │
│                                    │ if token == expected: │            │
│                                    │   ✓ Device authentic  │            │
│                                    │   → Create account    │            │
│                                    │   → Claim device      │            │
│                                    │   → Return creds      │            │
│                                    └───────────────────────┘            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Security Considerations

| Concern | Mitigation |
|---------|------------|
| Secret extraction from firmware | Use ESP32-S3 secure boot + flash encryption |
| Replay attacks | Include timestamp in HMAC, verify within 5-minute window |
| Secret compromise | Rotate secret, requires re-flashing devices |
| Brute force | Rate limiting on server endpoint |

### Implementation

**Firmware (ESP32):**
```cpp
#include <mbedtls/md.h>

const char* DEVICE_SECRET = "your-256-bit-secret-here";

String generateClaimToken() {
  String mac = WiFi.macAddress();
  String timestamp = String(time(nullptr));  // Unix timestamp
  String data = mac + ":" + timestamp;

  uint8_t hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (uint8_t*)DEVICE_SECRET, strlen(DEVICE_SECRET));
  mbedtls_md_hmac_update(&ctx, (uint8_t*)data.c_str(), data.length());
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  // Convert to hex
  String token = "";
  for (int i = 0; i < 32; i++) {
    if (hmacResult[i] < 16) token += "0";
    token += String(hmacResult[i], HEX);
  }
  return token;
}
```

**Server (Node.js/TypeScript):**
```typescript
import crypto from 'crypto';

const DEVICE_SECRET = process.env.DEVICE_SECRET!;
const TOKEN_VALIDITY_SECONDS = 300; // 5 minutes

function verifyClaimToken(mac: string, timestamp: string, token: string): boolean {
  // Check timestamp freshness
  const tokenTime = parseInt(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tokenTime) > TOKEN_VALIDITY_SECONDS) {
    return false; // Token expired
  }

  // Verify HMAC
  const data = `${mac}:${timestamp}`;
  const expected = crypto
    .createHmac('sha256', DEVICE_SECRET)
    .update(data)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(token.toLowerCase()),
    Buffer.from(expected.toLowerCase())
  );
}
```

---

## Captive Portal Setup Flow

### User Experience

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     STEP-BY-STEP USER FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. PLUG IN DEVICE                                                       │
│     └─► Device powers on, no WiFi credentials → Starts AP mode          │
│     └─► LED blinks slowly (AP mode indicator)                           │
│                                                                          │
│  2. CONNECT TO DEVICE WIFI                                               │
│     └─► User sees "MouseTrap-XXXX" in WiFi list                         │
│     └─► User connects (no password required)                            │
│     └─► Captive portal auto-opens (or user navigates to 192.168.4.1)    │
│                                                                          │
│  3. SETUP WIZARD APPEARS                                                 │
│     ┌─────────────────────────────────────┐                             │
│     │  Welcome to MouseTrap Setup!        │                             │
│     │                                      │                             │
│     │  Let's get your device connected.   │                             │
│     │                                      │                             │
│     │  [Get Started →]                    │                             │
│     └─────────────────────────────────────┘                             │
│                                                                          │
│  4. SELECT WIFI NETWORK                                                  │
│     ┌─────────────────────────────────────┐                             │
│     │  Select your WiFi network:          │                             │
│     │  ┌─────────────────────────────┐    │                             │
│     │  │ ● MyHomeNetwork-5G      📶  │    │                             │
│     │  │ ○ MyHomeNetwork         📶  │    │                             │
│     │  │ ○ Neighbor-WiFi         📶  │    │                             │
│     │  └─────────────────────────────┘    │                             │
│     │  Password: [••••••••••]             │                             │
│     │                                      │                             │
│     │  [Next →]                           │                             │
│     └─────────────────────────────────────┘                             │
│                                                                          │
│  5. CREATE ACCOUNT                                                       │
│     ┌─────────────────────────────────────┐                             │
│     │  Create your account:               │                             │
│     │                                      │                             │
│     │  Email:    [user@example.com    ]   │                             │
│     │  Password: [••••••••••••        ]   │                             │
│     │                                      │                             │
│     │  Name your device:                  │                             │
│     │  [Kitchen                       ]   │                             │
│     │                                      │                             │
│     │  [Activate →]                       │                             │
│     └─────────────────────────────────────┘                             │
│                                                                          │
│  6. ACTIVATION IN PROGRESS                                               │
│     ┌─────────────────────────────────────┐                             │
│     │  Setting up your device...          │                             │
│     │                                      │                             │
│     │  ✓ Connecting to WiFi               │                             │
│     │  ✓ Creating your account            │                             │
│     │  ⏳ Activating device...            │                             │
│     └─────────────────────────────────────┘                             │
│                                                                          │
│  7. SUCCESS!                                                             │
│     ┌─────────────────────────────────────┐                             │
│     │  ✅ You're all set!                 │                             │
│     │                                      │                             │
│     │  Your device "Kitchen" is now       │                             │
│     │  connected and monitoring.          │                             │
│     │                                      │                             │
│     │  Access your dashboard at:          │                             │
│     │  https://dashboard.mousetrap.com    │                             │
│     │                                      │                             │
│     │  You can close this page.           │                             │
│     │  The device will reconnect to       │                             │
│     │  your home WiFi automatically.      │                             │
│     └─────────────────────────────────────┘                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Technical Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     TECHNICAL SEQUENCE DIAGRAM                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  User          Device (AP)           Device (STA)         Server        │
│   │                │                      │                  │          │
│   │  Connect to    │                      │                  │          │
│   │  MouseTrap-XXX │                      │                  │          │
│   │───────────────►│                      │                  │          │
│   │                │                      │                  │          │
│   │  GET /         │                      │                  │          │
│   │───────────────►│                      │                  │          │
│   │◄───────────────│ Setup wizard HTML   │                  │          │
│   │                │                      │                  │          │
│   │  POST /setup   │                      │                  │          │
│   │  {wifi, email, │                      │                  │          │
│   │   pass, name}  │                      │                  │          │
│   │───────────────►│                      │                  │          │
│   │                │                      │                  │          │
│   │                │  Store WiFi creds    │                  │          │
│   │                │  Switch to STA mode  │                  │          │
│   │                │─────────────────────►│                  │          │
│   │                │                      │                  │          │
│   │                │                      │  Connect WiFi    │          │
│   │                │                      │─────────────────►│          │
│   │                │                      │                  │          │
│   │                │                      │  POST /api/setup/│          │
│   │                │                      │  register-and-   │          │
│   │                │                      │  claim           │          │
│   │                │                      │  {mac, token,    │          │
│   │                │                      │   email, pass,   │          │
│   │                │                      │   deviceName}    │          │
│   │                │                      │─────────────────►│          │
│   │                │                      │                  │          │
│   │                │                      │                  │ Verify   │
│   │                │                      │                  │ HMAC     │
│   │                │                      │                  │          │
│   │                │                      │                  │ Create   │
│   │                │                      │                  │ account  │
│   │                │                      │                  │          │
│   │                │                      │                  │ Claim    │
│   │                │                      │                  │ device   │
│   │                │                      │                  │          │
│   │                │                      │◄─────────────────│ Return   │
│   │                │                      │  {mqttCreds,     │ creds    │
│   │                │                      │   jwt, ...}      │          │
│   │                │                      │                  │          │
│   │                │                      │  Save to NVS     │          │
│   │                │                      │  Connect MQTT    │          │
│   │                │                      │─────────────────►│          │
│   │                │                      │                  │          │
│   │◄──────────────────────────────────────│  Success page    │          │
│   │                │                      │                  │          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Factory Reset Process

When user holds button for 10 seconds:

1. **Audio Feedback:**
   - 2 seconds: Single beep (reboot point)
   - 5 seconds: Double beep (warning - keep holding for reset)
   - 10 seconds: Long ascending tone (reset initiated)

2. **Reset Actions:**
   - Clear WiFi credentials from NVS
   - Clear device claim status (deviceClaimed = false)
   - Clear MQTT credentials from NVS
   - Notify server of unclaim (if connected)
   - Restart into AP mode

3. **Post-Reset State:**
   - Device broadcasts `MouseTrap-XXXX` AP
   - Captive portal ready for new setup
   - Can be claimed by same or different tenant

---

## Server Endpoints

### POST /api/setup/register-and-claim

Creates user account and claims device in one atomic operation.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "deviceName": "Kitchen",
  "mac": "AA:BB:CC:DD:EE:FF",
  "claimToken": "a1b2c3d4e5f6...",
  "timestamp": "1700000000"
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "tenantId": "uuid"
    },
    "device": {
      "id": "uuid",
      "name": "Kitchen",
      "mqttClientId": "AABBCCDDEEFF",
      "mqttUsername": "AABBCCDDEEFF",
      "mqttPassword": "generated-password",
      "mqttBrokerUrl": "mqtt://broker.example.com:1883"
    },
    "jwt": "eyJhbG..."
  }
}
```

**Response (Invalid Token):**
```json
{
  "success": false,
  "error": "Invalid device authentication token"
}
```

**Response (Email Exists - Login Instead):**
```json
{
  "success": false,
  "error": "Account already exists",
  "action": "login",
  "message": "Please log in with your existing account"
}
```

---

## mDNS Hostnames

Devices advertise via mDNS for easy discovery:

| Device State | mDNS Hostname | Example |
|--------------|---------------|---------|
| Unclaimed / AP Mode | `mousetrap.local` | `http://mousetrap.local` |
| Claimed | `<devicename>.local` | `http://kitchen.local` |

**Hostname Sanitization:**
- Lowercase conversion
- Spaces → hyphens
- Special characters removed
- Example: "Kitchen Trap #1" → `kitchen-trap-1.local`

---

## Error Handling

### WiFi Connection Failures

```
┌─────────────────────────────────────┐
│  ❌ Could not connect to WiFi       │
│                                      │
│  Please check:                       │
│  • WiFi password is correct          │
│  • Router is in range                │
│  • Network is 2.4GHz (not 5GHz only) │
│                                      │
│  [Try Again]                         │
└─────────────────────────────────────┘
```

### Server Unreachable

```
┌─────────────────────────────────────┐
│  ❌ Could not reach server          │
│                                      │
│  Your device connected to WiFi but   │
│  couldn't reach the activation       │
│  server.                             │
│                                      │
│  Please check your internet          │
│  connection and try again.           │
│                                      │
│  [Retry]                             │
└─────────────────────────────────────┘
```

### Account Already Exists

```
┌─────────────────────────────────────┐
│  ℹ️ Account Already Exists          │
│                                      │
│  An account with this email already  │
│  exists. Please log in instead.      │
│                                      │
│  Email:    [user@example.com    ]   │
│  Password: [                    ]   │
│                                      │
│  [Log In & Add Device]              │
└─────────────────────────────────────┘
```

---

## Legacy Manual Claim Flow

For backward compatibility, manual claim codes are still supported:

1. Admin generates claim code in dashboard
2. User accesses device at `http://mousetrap.local` or IP
3. User navigates to Claim page
4. User enters 8-character claim code
5. Device claims itself using the code

This flow is useful for:
- Pre-provisioning devices before shipping
- Enterprise deployments with central management
- Situations where captive portal doesn't work

---

## Scout vs Trap Claiming

Both Trap and Scout devices now support the same claim code flow:

| Feature | Trap | Scout |
|---------|------|-------|
| Claim code endpoint | `POST /api/device/claim` | `POST /api/device/claim` |
| Request body | `{claimCode}` | `{claimCode}` |
| Server API | `POST /api/devices/claim` | `POST /api/devices/claim` |
| Legacy endpoint | — | `POST /api/device/register-claim` (deprecated) |

The Scout initially used a different endpoint (`/api/device/register-claim` with `{email, password}`) but was updated (2026-01-19) to match the Trap's claim code flow for consistency.

---

## Files Reference

### Firmware
- `mousetrap_arduino.ino` - Button handler, HMAC generation, AP mode, claiming logic
- `trap-spa/src/pages/Setup.svelte` - Captive portal setup wizard (new)
- `trap-spa/src/pages/Claim.svelte` - Legacy manual claim page

### Server
- `src/routes/setup.routes.ts` - Register-and-claim endpoint (new)
- `src/routes/claim.routes.ts` - Legacy claim endpoints
- `src/utils/hmac-auth.ts` - HMAC verification utility (new)

---

## Changelog

### 2026-01-19
- Added Scout vs Trap claiming comparison section
- Scout now uses same claim code endpoint as Trap

### 2025-11-21
- Initial documentation for captive portal claiming system
- HMAC-based authentication (replaces manual claim codes)
- New button functions (click, 2s hold, 10s hold)
- Factory reset capability
