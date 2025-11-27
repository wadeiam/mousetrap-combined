# Snapshot Capture Debug Report
**Date**: 2025-11-14
**Device**: Kitchen (94A990306028) @ 192.168.133.46
**Server**: 192.168.133.110:4000

## Problem Summary
Dashboard displays "Snapshot capture timed out. Device may be offline" when attempting to capture camera snapshots.

## Debug Process

### 1. Verified Device Status
```
Device ID: fd5f9d3c-f7bc-47cb-827a-00be9653dde1
Name: Kitchen
Location: Kitchen by fridge
MAC Address: 94A990306028
Firmware: v1.3.9
Online: true
Last Seen: 2025-11-14T06:42:18.638Z
```

### 2. Checked MQTT Communication
- MQTT broker: 192.168.133.110:1883 ✓ Online
- Device status messages: ✓ Flowing correctly
- Alert messages: ✓ Working (motion detection confirmed)
- Server can publish commands: ✓ Verified

### 3. Discovered MQTT Topic Format Bug
**Issue Found**: Server was publishing commands to wrong MQTT topic format

**Documentation** (mqtt.types.ts line 79):
```
Topic: tenant/{tenantId}/device/{macAddress}/cmd/{commandType}
```

**Actual Implementation** (mqtt.types.ts line 134 - BEFORE FIX):
```typescript
deviceCommand: (tenantId: string, macAddress: string, commandType: string = '#') =>
  `tenant/${tenantId}/device/${macAddress}/command/${commandType}`,
```

**The Bug**: `command` vs `cmd` mismatch

#### Fix Applied
Changed line 134 in `/src/types/mqtt.types.ts`:
```typescript
// BEFORE
`tenant/${tenantId}/device/${macAddress}/command/${commandType}`

// AFTER
`tenant/${tenantId}/device/${macAddress}/cmd/${commandType}`
```

**Status**: ✓ Fixed, built, and deployed

### 4. Tested Fixed Topic
```bash
# Published directly via MQTT
mosquitto_pub -h 192.168.133.110 -p 1883 \
  -u mqtt_client -P mqtt_password123 \
  -t "tenant/00000000-0000-0000-0000-000000000001/device/94A990306028/cmd/capture_snapshot" \
  -m '{"command":"capture_snapshot","timestamp":1763102999000}' \
  -q 1
```

**Result**: Command published successfully to correct topic ✓

### 5. Device Did Not Respond
Despite command being sent to correct topic, device did not respond with snapshot.

### 6. Root Cause Identified

**Device Firmware Version**: v1.3.9
**Expected Version**: v2.0.41 (with `capture_snapshot` handler)

**Database Firmware Versions Available**:
- v1.3.8 (firmware)
- v1.3.4 (firmware)
- v2.0.31 (filesystem)

**Conclusion**: The device firmware (v1.3.9) does NOT include the `capture_snapshot` command handler. This feature was added in firmware v2.0.41.

## Issues Found & Fixed

### Issue #1: MQTT Topic Format Mismatch ✓ FIXED
- **Location**: `/src/types/mqtt.types.ts` line 134
- **Problem**: Server published to `/command/` but devices subscribed to `/cmd/`
- **Fix**: Changed implementation to match documentation (`/cmd/`)
- **Impact**: ALL device commands (reboot, alert_reset, OTA, etc.) were affected

### Issue #2: Outdated Device Firmware ⚠️ REQUIRES ACTION
- **Current Version**: v1.3.9
- **Required Version**: v2.0.41+
- **Problem**: Device firmware lacks `capture_snapshot` handler
- **Fix Required**: Upload firmware v2.0.41 to server and trigger OTA update

## Testing Results

| Test | Status | Notes |
|------|--------|-------|
| Device online | ✓ Pass | Device responding normally |
| MQTT connection | ✓ Pass | Broker accessible, auth working |
| Status messages | ✓ Pass | Regular heartbeats received |
| Alert messages | ✓ Pass | Motion detection working |
| Command topic | ✓ Fixed | Now using correct `/cmd/` format |
| Snapshot command | ✗ Fail | Device firmware doesn't support it |

## Next Steps

1. **Obtain firmware v2.0.41** with `capture_snapshot` handler
2. **Upload to server**:
   ```bash
   # Upload via API or add to firmware_versions table
   ```
3. **Trigger OTA update** for Kitchen device
4. **Verify snapshot functionality** after update
5. **Test complete snapshot flow**:
   - Dashboard → API → MQTT → Device
   - Device → Snapshot → MQTT → Server
   - Server → Database → Dashboard

## Files Modified
- `/Users/wadehargrove/Documents/server-deployment/server/src/types/mqtt.types.ts` (line 134)
- Built and restarted: ✓ Complete

## Additional Observations

### Media Endpoint
The `/api/devices/:id/media` endpoint currently returns empty:
```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
  }
}
```

This endpoint needs implementation to:
1. Store snapshots when received via MQTT
2. Query and return stored images
3. Handle image serving/streaming

### Snapshot Storage
No database table or storage mechanism found for snapshots. This needs to be implemented:
- Database table for image metadata
- File storage or blob storage for image data
- MQTT handler to save incoming snapshots

## Verification Commands

```bash
# Check device status
curl http://192.168.133.110:4000/api/devices/fd5f9d3c-f7bc-47cb-827a-00be9653dde1 \
  -H "Authorization: Bearer TOKEN"

# Request snapshot (after firmware update)
curl -X POST http://192.168.133.110:4000/api/devices/fd5f9d3c-f7bc-47cb-827a-00be9653dde1/request-snapshot \
  -H "Authorization: Bearer TOKEN"

# Check media
curl http://192.168.133.110:4000/api/devices/fd5f9d3c-f7bc-47cb-827a-00be9653dde1/media \
  -H "Authorization: Bearer TOKEN"

# Monitor MQTT logs
pm2 logs mqtt-server --raw | grep -E "snapshot|camera"

# Publish test command
mosquitto_pub -h 192.168.133.110 -p 1883 \
  -u mqtt_client -P mqtt_password123 \
  -t "tenant/00000000-0000-0000-0000-000000000001/device/94A990306028/cmd/capture_snapshot" \
  -m '{"command":"capture_snapshot","timestamp":'$(date +%s000)'}' -q 1
```
