# Device Revocation Implementation Report

**Date:** 2025-11-17
**Status:** ✓ COMPLETED & TESTED

## Overview

Implemented server-side explicit device revocation following IoT best practices. The server now properly handles device revocation with HTTP 410 responses and MQTT push notifications.

## Changes Summary

### 1. Claim Status Endpoint - HTTP 410 for Revoked Devices

**File:** `/Users/wadehargrove/Documents/MouseTrap/Server/src/routes/claim.routes.ts`
**Lines:** 337-390

**Changes:**
- Modified `GET /api/device/claim-status` endpoint
- Now queries `unclaimed_at` field from database
- Returns HTTP 410 (Gone) when `unclaimed_at IS NOT NULL`
- Response includes revocation timestamp and message

**Behavior:**
- **Unclaimed devices** (not in DB): HTTP 200 with `{"claimed": false}`
- **Claimed devices** (`unclaimed_at IS NULL`): HTTP 200 with `{"claimed": true}`
- **Revoked devices** (`unclaimed_at IS NOT NULL`): HTTP 410 with revocation details

**Example Response (HTTP 410):**
```json
{
  "claimed": false,
  "message": "Device has been revoked",
  "revokedAt": "2025-11-18T01:06:42.706Z"
}
```

### 2. Admin Unclaim Endpoint - MQTT Revocation Push

**File:** `/Users/wadehargrove/Documents/MouseTrap/Server/src/routes/devices.routes.ts`
**Lines:** 593-661

**Changes:**
- Modified `POST /api/devices/:id/unclaim` endpoint
- Switched from hard-delete to soft-delete (sets `unclaimed_at` timestamp)
- Publishes MQTT revocation message before removing credentials
- Maintains MQTT credential removal for broker cleanup

**Process Flow:**
1. Look up device information (id, name, mqtt_client_id, tenant_id)
2. Soft-delete device (set `unclaimed_at = NOW()`)
3. Publish MQTT revocation message to `tenant/{tenantId}/device/{mqttClientId}/revoke`
4. Remove MQTT credentials from Mosquitto broker
5. Return success response

**MQTT Revocation Message:**
```json
{
  "action": "revoke",
  "timestamp": "2025-11-18T01:04:59.282Z",
  "reason": "Admin unclaimed device"
}
```

**MQTT Topic:** `tenant/{tenantId}/device/{mqttClientId}/revoke`
**QoS:** 1 (at least once delivery)
**Retain:** true (persisted for offline devices)

### 3. MQTT Service - Device Revocation Method

**File:** `/Users/wadehargrove/Documents/MouseTrap/Server/src/services/mqtt.service.ts`
**Lines:** 839-858

**Changes:**
- Added public `publishDeviceRevocation()` method
- Publishes to device-specific revocation topic
- Uses retained messages for offline devices
- Includes structured logging

**Method Signature:**
```typescript
public async publishDeviceRevocation(
  tenantId: string,
  mqttClientId: string,
  reason: string = 'Admin unclaimed device'
): Promise<void>
```

## How to Access MQTT Client

The MQTT service is available in route handlers via `req.app.locals.mqttService`:

```typescript
const mqttService = req.app.locals.mqttService;
await mqttService.publishDeviceRevocation(tenantId, mqttClientId, reason);
```

This is configured in `/Users/wadehargrove/Documents/MouseTrap/Server/src/server.ts` (line 202):
```typescript
app.locals.mqttService = mqttService;
```

## Testing

### Build Status
✓ Build completed successfully with no errors
```bash
npm run build
```

### Server Restart
✓ Server restarted successfully via pm2
```bash
pm2 restart mqtt-server
```

### Test Results

#### Test 1: Claim Status for Claimed Device
```
Status Code: 200
Response: {
  "success": true,
  "claimed": true
}
✓ PASS
```

#### Test 2: Claim Status for Revoked Device
```
Status Code: 410
Response: {
  "claimed": false,
  "message": "Device has been revoked",
  "revokedAt": "2025-11-18T01:06:42.706Z"
}
✓ PASS: HTTP 410 returned
✓ PASS: Revocation message included
✓ PASS: Timestamp included
```

#### Test 3: Device Restoration
```
Status Code: 200
✓ PASS: Device successfully restored after unclaimed_at set to NULL
```

## Device Behavior

### Device Side Implementation (Expected)

Devices should:
1. Periodically check claim status via `GET /api/device/claim-status?mac={MAC}`
2. Subscribe to MQTT topic: `tenant/{tenantId}/device/{mqttClientId}/revoke`
3. On HTTP 410 or MQTT revoke message:
   - Clear stored credentials
   - Disconnect from MQTT broker
   - Enter unclaimed state
   - Show "Device Revoked" status
   - Prompt user to re-claim if desired

### MQTT Integration

Devices should subscribe to revocation topic after successful MQTT connection:

```c++
// Arduino/ESP32 example
String revokeTopic = "tenant/" + tenantId + "/device/" + mqttClientId + "/revoke";
mqttClient.subscribe(revokeTopic.c_str(), 1); // QoS 1
```

On message received:
```c++
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (String(topic).endsWith("/revoke")) {
    // Parse JSON payload
    // Clear credentials from SPIFFS/EEPROM
    // Disconnect and enter unclaimed state
  }
}
```

## Files Modified

1. `/Users/wadehargrove/Documents/MouseTrap/Server/src/routes/claim.routes.ts`
   - Lines 337-390: Updated claim-status endpoint

2. `/Users/wadehargrove/Documents/MouseTrap/Server/src/routes/devices.routes.ts`
   - Lines 593-661: Updated unclaim endpoint

3. `/Users/wadehargrove/Documents/MouseTrap/Server/src/services/mqtt.service.ts`
   - Lines 839-858: Added publishDeviceRevocation method

## Database Schema

No database migrations required. The `unclaimed_at` column already exists in the `devices` table.

Current soft-delete behavior:
- `unclaimed_at IS NULL` → Device is claimed and active
- `unclaimed_at IS NOT NULL` → Device is revoked/unclaimed

## Verification Steps

To verify the implementation:

1. **Test HTTP 410 Response:**
   ```bash
   cd /Users/wadehargrove/Documents/MouseTrap/Server
   node test-revocation-410.js
   ```

2. **Monitor MQTT Traffic:**
   ```bash
   mosquitto_sub -h localhost -t 'tenant/+/device/+/revoke' -v
   ```

3. **Manually Unclaim a Device:**
   - Login to dashboard
   - Navigate to device details
   - Click "Unclaim Device"
   - Check logs: `pm2 logs mqtt-server`
   - Verify MQTT message published

## Next Steps (Future Enhancements)

1. **Frontend Dashboard:**
   - Update unclaim confirmation dialog
   - Show device revocation status
   - Display last revoked timestamp

2. **Device Firmware:**
   - Subscribe to revocation topic on connection
   - Handle revocation message gracefully
   - Clear credentials securely

3. **Analytics:**
   - Track revocation events
   - Monitor devices that haven't received revocation messages
   - Alert on failed revocations

4. **Retention Policy:**
   - Implement automatic cleanup of old revoked devices (e.g., 6 months)
   - Archive revocation events for audit trail

## Security Considerations

- HTTP 410 response is intentional per RFC 7231 (permanent removal)
- Retained MQTT messages ensure offline devices receive revocation on reconnect
- Soft-delete allows audit trail and potential restoration
- MQTT credentials removed immediately to prevent reconnection

## IoT Best Practices Implemented

✓ Server-side explicit revocation
✓ HTTP status codes following REST standards
✓ MQTT retained messages for offline devices
✓ QoS 1 for reliable delivery
✓ Structured logging for debugging
✓ Graceful error handling
✓ Audit trail via soft-delete

## Support

For issues or questions:
- Check logs: `pm2 logs mqtt-server`
- Verify MQTT broker: `mosquitto_sub -h localhost -t '#' -v`
- Test endpoints: Run test scripts in `/Server` directory

---
**Implementation Verified:** 2025-11-17
**All Tests Passing:** ✓
