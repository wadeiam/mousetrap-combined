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
**Query:** `?tenantId=uuid` (optional)

### GET /devices/:id
Get device details

### POST /devices/:id/reboot
Reboot device via MQTT

### POST /devices/:id/unclaim
Unclaim device (dashboard-initiated)

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

#### POST /device/unclaim-notify
Device notifies server of unclaim

**Request:**
```json
{
  "mac": "AA:BB:CC:DD:EE:FF"
}
```

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
