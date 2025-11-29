# Device Stranding Scenarios and Mitigations

**Created:** 2025-11-28
**Context:** Analysis of MQTT Dynamic Security failure modes

---

## Overview

With MQTT Dynamic Security, devices authenticate to the broker using credentials stored in:
1. **Device NVS** - The device's non-volatile storage
2. **PostgreSQL database** - `devices.mqtt_password_plain` and `devices.mqtt_password` (hashed)
3. **Dynamic Security JSON** - `/mosquitto/config/dynamic-security.json`

If any of these get out of sync, or if a credential update fails partway through, the device becomes "stranded" - claimed in the database but unable to connect to MQTT, stuck in standalone mode with no remote management capability.

---

## Stranding Scenarios

### 1. Credential Rotation Race Condition

**Risk Level:** HIGH (MITIGATED)

**Scenario:** During credential rotation, the server updates the broker credentials BEFORE the device receives the MQTT message with the new password.

**Sequence (Original Problem):**
1. Server generates new password
2. Server calls `setClientPassword` - broker immediately disconnects device
3. Device is now disconnected and never receives the `rotate_credentials` MQTT message
4. Device still has old password, broker has new password
5. Device fails to reconnect with rc=5

**Status:** MITIGATED via ACK-based rotation

**Fix Applied:** ACK-based rotation in `devices.routes.ts`:
1. Server sends `rotate_credentials` command to device
2. Device writes new password to NVS
3. Device publishes ACK to `tenant/{id}/device/{id}/rotation_ack` with rotationId
4. Server receives ACK, THEN updates broker credentials
5. Device reconnects with new password

**Timeout Handling:**
- Server waits 30 seconds for ACK
- If no ACK received, rotation is cancelled and old credentials remain valid
- Server returns 504 status with error message

**Remaining Risk:** Firmware must support rotation_ack (see Firmware TODO section).

---

### 2. Claim Process Database-Broker Desync

**Risk Level:** HIGH

**Scenario:** Device is inserted into database, but MQTT credential sync to broker fails.

**Sequence:**
1. Server receives claim request
2. Server inserts device into database with credentials
3. Server calls `syncMqttDevice()` to add to broker
4. Broker sync fails (network, timeout, broker down)
5. Database has device, broker doesn't recognize credentials
6. Device can't connect to MQTT

**Status:** MITIGATED (Existing code)

**Existing Fix:** The claim endpoint has rollback logic:
```typescript
} catch (error: any) {
  // Rollback: Delete the device we just created
  await dbPool.query('DELETE FROM devices WHERE id = $1', [deviceId]);
}
```

**Remaining Risk:** If database write succeeds but delete fails during rollback, device is orphaned.

---

### 3. Dynamic Security JSON File Loss

**Risk Level:** HIGH

**Scenario:** The `dynamic-security.json` file is lost, corrupted, or reset.

**Causes:**
- Docker volume not persisted properly
- Accidental deletion
- Disk failure
- Container rebuild without volume mount

**Result:** All devices immediately lose authentication. Mass stranding event.

**Mitigation:** `rebuild-dynsec-from-db.ts` script

**Usage:**
```bash
cd /Users/wadehargrove/Documents/MouseTrap/Server
npx tsx scripts/rebuild-dynsec-from-db.ts --dry-run  # Preview
npx tsx scripts/rebuild-dynsec-from-db.ts            # Execute
```

This script reads `mqtt_password_plain` from the database and recreates all device credentials in Dynamic Security.

---

### 4. Device NVS Corruption During Credential Write

**Risk Level:** HIGH

**Scenario:** Device loses power or crashes while writing new credentials to NVS.

**Sequence:**
1. Device receives `rotate_credentials` command
2. Device starts writing new password to NVS
3. Power loss or crash during write
4. NVS is corrupted or partially written
5. Device can't connect with either old or new password

**Status:** NOT MITIGATED

**Mitigation Options:**
- **Device-side:** Two-phase NVS commit (write to backup location first, then swap)
- **Device-side:** Keep previous credentials as fallback, try both on connect failure
- **Server-side:** `/device/recover-credentials` endpoint (IMPLEMENTED)

---

### 5. Server Restart During Claim

**Risk Level:** MEDIUM

**Scenario:** Server crashes or restarts during the claim process.

**Possible States:**
- Database written but MQTT not synced
- MQTT synced but claim code not marked used
- Claim code marked used but credentials not returned to device

**Status:** PARTIALLY MITIGATED

**Mitigation:**
- Device polls `/device/check-claim/:mac` until it gets credentials
- If database has device but broker doesn't, device is stranded
- `/device/recover-credentials` endpoint can fix this

---

### 6. Unclaim Without Device Receiving Revocation

**Risk Level:** MEDIUM

**Scenario:** Admin unclaims device, but device never receives the revocation message.

**Sequence:**
1. Admin clicks "Unclaim" in dashboard
2. Server sends MQTT revoke message
3. Server removes credentials from broker
4. Device is offline or message is lost
5. Device comes back online, tries to connect
6. Gets rc=5 (not authorized)
7. Device doesn't know why it can't connect

**Status:** PARTIALLY MITIGATED

**Existing Mitigations:**
- Device polls `/device/claim-status` endpoint
- Returns 410 if device was explicitly revoked
- Device should clear credentials and enter AP mode on 410

**Remaining Risk:** If device can't reach HTTP server either, it's fully stranded.

---

### 7. Broker Restart With Pending Dynamic Security Commands

**Risk Level:** MEDIUM

**Scenario:** Broker restarts while credential update command is in flight.

**Sequence:**
1. Server sends `createClient` or `setClientPassword` command
2. Broker receives command
3. Broker crashes/restarts before persisting to JSON
4. Command response times out on server
5. Server thinks operation failed, but broker might have partial state

**Status:** NOT DIRECTLY MITIGATED

**Mitigation:** The `addMqttDevice` function in `mqtt-auth.ts` deletes existing client first, then creates. This makes the operation idempotent.

---

## Recovery Mechanisms

### 1. HTTP Credential Recovery Endpoint

**Endpoint:** `POST /device/recover-credentials`

**Purpose:** Allows stranded devices to recover credentials via HTTP when MQTT is not working.

**Request:**
```json
{
  "mac": "94A990306028",
  "deviceId": "uuid-from-claim",
  "currentPassword": "optional-current-mqtt-password"
}
```

**Security:** Requires either `deviceId` or `currentPassword` for verification. MAC alone is not sufficient.

**Actions:**
1. Verifies device is claimed (not revoked)
2. Verifies request using deviceId or password hash
3. If `mqtt_password_plain` exists, resyncs to broker
4. If no plaintext, generates new credentials and syncs
5. Returns full credentials to device

---

### 2. Rebuild Dynamic Security Script

**Script:** `scripts/rebuild-dynsec-from-db.ts`

**Purpose:** Rebuild all broker credentials from database after catastrophic failure.

**Usage:**
```bash
# Preview what will be synced
npx tsx scripts/rebuild-dynsec-from-db.ts --dry-run

# Execute rebuild
npx tsx scripts/rebuild-dynsec-from-db.ts
```

**Actions:**
1. Queries all claimed devices with `mqtt_password_plain`
2. For each device, creates/updates Dynamic Security client
3. Logs success/failure for each device

---

### 3. Credential Rotation ACK (IMPLEMENTED)

**Server Implementation:** `mqtt.service.ts` and `devices.routes.ts`

**Flow:**
1. Server sends `rotate_credentials` command with new password + rotationId
2. Server waits for ACK (30 second timeout)
3. Device receives command, writes new password to NVS
4. Device publishes ACK to `tenant/{tenantId}/device/{mqttClientId}/rotation_ack`
5. Server receives ACK, THEN updates broker credentials with `setClientPassword`
6. Device reconnects with new password

**Message Formats:**

Server -> Device (`rotate_credentials`):
```json
{
  "command": "rotate_credentials",
  "password": "new_password_here",
  "rotationId": "uuid-for-tracking",
  "timestamp": 1701187200000
}
```

Device -> Server (`rotation_ack`):
```json
{
  "rotationId": "uuid-for-tracking",
  "success": true
}
```

**Timeout Handling:**
- If no ACK within 30 seconds, server returns 504 error
- Old credentials remain valid
- Admin can retry or use `/device/recover-credentials` if needed

---

## Device-Side Recovery (Firmware TODO)

### Dual Credential Storage

Store both current and previous credentials in NVS:
- `mqtt_password_current`
- `mqtt_password_previous`

On MQTT connect failure (rc=5):
1. Try current password
2. If fails, try previous password
3. If previous works, swap them (previous is now current)
4. Call `/device/recover-credentials` to resync

### HTTP Recovery Logic

Add to firmware reconnection loop:

```cpp
if (mqttConnectAttempts > MAX_ATTEMPTS) {
  // Try HTTP recovery
  HTTPClient http;
  http.begin(serverUrl + "/device/recover-credentials");
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"mac\":\"" + macAddress + "\",\"deviceId\":\"" + deviceId + "\"}";
  int code = http.POST(payload);

  if (code == 200) {
    // Parse response, update NVS, retry MQTT
  }
}
```

---

## Monitoring & Alerting

### Credential Health Check (IMPLEMENTED)

**Script:** `scripts/check-credential-sync.ts`

**Purpose:** Verify that all claimed devices in the database have matching credentials in the broker.

**Usage:**
```bash
# Check and report issues
npx tsx scripts/check-credential-sync.ts

# Check and fix missing credentials
npx tsx scripts/check-credential-sync.ts --fix
```

**What it checks:**
1. All claimed devices in database exist in Dynamic Security
2. All devices have `mqtt_password_plain` stored (needed for recovery)
3. Stale credentials in broker (devices deleted from DB but still in broker)

### Audit Logging

All credential operations are logged to `device_claim_audit` table:
- `action`: 'claim', 'unclaim', 'credential_rotation', 'credential_recovery'
- `trigger_source`: 'dashboard', 'device_http', 'admin_script'
- `actor_ip`: IP address of requester
- `reason`: Human-readable description

---

## Summary Table

| Scenario | Risk | Status | Mitigation |
|----------|------|--------|------------|
| Credential rotation race condition | HIGH | **MITIGATED** | ACK-based rotation (waits for device confirmation) |
| Claim database-broker desync | HIGH | Mitigated | Rollback on failure |
| Dynamic Security file loss | HIGH | Mitigated | `rebuild-dynsec-from-db.ts` script |
| Device NVS corruption | HIGH | Mitigated | `/device/recover-credentials` endpoint |
| Server restart during claim | MEDIUM | Partial | Device polls, HTTP recovery |
| Unclaim message not received | MEDIUM | Partial | `/device/claim-status` polling |
| Broker restart during command | MEDIUM | Mitigated | Idempotent operations |

---

**Related Documentation:**
- [MQTT-SETUP.md](./MQTT-SETUP.md) - MQTT broker configuration
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - General troubleshooting
- [DEVICE-CLAIMING-FLOW.md](../DEVICE-CLAIMING-FLOW.md) - Claim process details
