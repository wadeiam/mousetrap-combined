# Server API Reference

**REST API endpoints for device management and monitoring**

Base URL: `http://192.168.133.110:4000/api`

---

## Authentication

### POST /auth/login
Login and get JWT token

**Request:**
```json
{
  "email": "admin@mastertenant.com",
  "password": "Admin123!"
}
```

**Response:**
```json
{
  "token": "jwt-token-here",
  "user": {...},
  "tenantId": "uuid"
}
```

---

## Devices

### GET /devices
List all devices for current tenant

**Auth:** Required
**Query:** `?status=online,offline,alerting`, `?search=term`, `?offlineFor=1h,24h,7d`

**Master Tenant Behavior:**
- When viewing Master Tenant: Returns ALL devices across ALL tenants
- When switched to subtenant: Returns only that tenant's devices
- Response includes `tenantName` field for each device

### GET /devices/:id
Get device details

### POST /devices/:id/reboot
Reboot device via MQTT

### POST /devices/:id/unclaim
Unclaim device (dashboard-initiated)

### POST /devices/:id/move
Move device to a different tenant (superadmin only)

**Auth:** Required (Master Tenant superadmin)
**Request:**
```json
{
  "targetTenantId": "uuid-of-target-tenant"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "deviceId": "same-uuid",
    "deviceName": "Device Name",
    "fromTenant": {
      "id": "old-tenant-uuid",
      "name": "Old Tenant"
    },
    "toTenant": {
      "id": "new-tenant-uuid",
      "name": "New Tenant"
    },
    "deviceWasOnline": true,
    "note": "Device was notified via MQTT to update tenant - it will reconnect automatically"
  }
}
```

**Notes:**
- Preserves device UUID (no ID change)
- Sends `update_tenant` MQTT command to device
- Device updates NVS credentials and reconnects to new tenant
- Does NOT send revocation messages - claim status preserved
- If device offline: database updated, device will reconnect with new tenant on next boot

---

## Claiming

### Seamless Claiming (NEW - Added 2025-11-19)

#### POST /device/claiming-mode
Device enters claiming mode (public, no auth)

**Purpose:** Button-activated claiming for retail devices
**Request:**
```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "serial": "optional-serial",
  "ip": "192.168.1.100"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Device registered for claiming",
  "expiresAt": "2025-11-19T14:00:00Z"
}
```

**Notes:**
- Creates 10-minute claiming window
- Adds entry to `device_claiming_queue` table
- Called automatically when user holds button for 5 seconds
- Window expires after 10 minutes

#### POST /auth/register
User registration (public, no auth)

**Purpose:** Self-service account creation during setup
**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "tenantName": "My Home"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "jwt-token",
    "refreshToken": "refresh-token",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "tenants": [...]
    }
  }
}
```

**Notes:**
- Creates new tenant automatically
- Creates user as admin of new tenant
- Returns JWT tokens for immediate use
- Minimum password length: 8 characters

#### GET /device/check-claim/:macAddress
Device polls to check if claimed (public, no auth)

**Purpose:** Device credential retrieval after claiming
**Request:** GET `/api/device/check-claim/94A990306028`

**Response (not claimed yet):**
```json
{
  "success": true,
  "claimed": false,
  "message": "Waiting for claim to complete"
}
```

**Response (claimed):**
```json
{
  "success": true,
  "claimed": true,
  "data": {
    "deviceId": "uuid",
    "tenantId": "uuid",
    "mqttClientId": "94A990306028",
    "mqttUsername": "94A990306028",
    "mqttPassword": "generated-password",
    "mqttBrokerUrl": "mqtt://192.168.133.110:1883",
    "deviceName": "Kitchen Trap"
  }
}
```

**Notes:**
- Called by device every 5 seconds while in claiming mode
- Returns credentials when browser completes claim
- Device saves credentials to NVS and exits claiming mode
- Completes end-to-end claiming flow

### Manual Claiming (Legacy)

#### POST /admin/claim-codes
Generate claim code

**Request:**
```json
{
  "deviceName": "Kitchen Trap",
  "tenantId": "uuid",
  "expiresInDays": 7
}
```

#### GET /admin/claim-codes
List all claim codes

#### POST /devices/claim
Device claim endpoint (public, no auth)

**Request:**
```json
{
  "claimCode": "ABC12XYZ",
  "deviceInfo": {
    "macAddress": "94A990306028",
    "hardwareVersion": "ESP32-S3",
    "firmwareVersion": "1.0.0",
    "filesystemVersion": "1.0.0"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "deviceId": "uuid",
    "tenantId": "uuid",
    "mqttClientId": "94A990306028",
    "mqttUsername": "94A990306028",
    "mqttPassword": "generated-password",
    "mqttBrokerUrl": "mqtt://server:1883",
    "deviceName": "Kitchen Trap"
  }
}
```

**Validation:**
- Checks claiming window (device must be in `device_claiming_queue`)
- Validates claim code exists and is active
- Ensures device is not already claimed
- Returns 400 if not in claiming mode

#### POST /device/verify-revocation
Device verifies revocation token before unclaiming (NO AUTH REQUIRED)

**Added:** 2025-11-27 (Bulletproof Claiming)

**Purpose:** Prevents accidental unclaims - device MUST verify token with server

**Request:**
```json
{
  "mac": "94A990306028",
  "token": "64-character-hex-revocation-token"
}
```

**Response (valid):**
```json
{
  "valid": true
}
```

**Response (invalid):**
```json
{
  "valid": false,
  "reason": "invalid_token" | "token_expired" | "device_mismatch" | "missing_params"
}
```

**Security:**
- Token is one-time use (deleted after verification)
- Token expires after 5 minutes
- Token is bound to specific device MAC
- ANY error = device stays claimed

#### POST /device/unclaim-notify
Device notifies server of unclaim (with source tracking)

**Request:**
```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "source": "factory_reset" | "local_ui" | "mqtt_revoke"
}
```

**Audit:** Logged to `device_claim_audit` table with source, IP, timestamp

---

## Firmware Management

### GET /firmware/versions
List all firmware versions

### POST /firmware/upload
Upload new firmware binary

**Form data:**
- `file` - Binary file
- `version` - Version string
- `type` - "firmware" or "filesystem"
- `changelog` - Description
- `required` - Boolean
- `global` - Boolean (all tenants)

### DELETE /firmware/:id
Delete firmware version (clears MQTT retained messages)

---

## Alerts

### GET /alerts
List alerts for tenant

**Auth:** Required
**Query:** `?severity=critical,high,medium,low`, `?isResolved=true,false`, `?isAcknowledged=true,false`

**Master Tenant Behavior:**
- When viewing Master Tenant: Returns ALL alerts across ALL tenants
- When switched to subtenant: Returns only that tenant's alerts
- Response includes `tenantName`, `macAddress`, `location`, `label` fields

### POST /alerts/:id/acknowledge
Acknowledge alert

### POST /alerts/:id/resolve
Resolve alert (sends alert_reset to device)

---

## System

### GET /health
Health check

**Response:**
```json
{
  "status": "healthy",
  "database": "connected",
  "mqtt": "connected"
}
```

---

**Related:** [DEPLOYMENT.md](./DEPLOYMENT.md), [CLAIM-CODES.md](./CLAIM-CODES.md)
