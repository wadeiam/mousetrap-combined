import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import mqtt from 'mqtt';
import { syncMqttDevice, addMqttDevice, getAuthMode } from '../utils/mqtt-auth';
import Bonjour from 'bonjour-service';
import { revocationTokens } from './devices.routes';

/**
 * Clear any retained revoke message for a device on the MQTT broker.
 * This prevents newly claimed devices from receiving old revoke messages
 * from previous unclaims.
 */
async function clearRetainedRevokeMessage(tenantId: string, mqttClientId: string): Promise<void> {
  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
  const topic = `tenant/${tenantId}/device/${mqttClientId}/revoke`;

  return new Promise((resolve, reject) => {
    const client = mqtt.connect(brokerUrl, {
      clientId: `claim_clear_${Date.now()}`,
      clean: true,
      connectTimeout: 5000,
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
    });

    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error('MQTT connection timeout'));
    }, 10000);

    client.on('connect', () => {
      // Publish empty retained message to clear the old one
      client.publish(topic, '', { qos: 1, retain: true }, (err) => {
        clearTimeout(timeout);
        client.end();
        if (err) {
          console.error(`[CLAIM] Failed to clear retained revoke message: ${err.message}`);
          reject(err);
        } else {
          console.log(`[CLAIM] Cleared retained revoke message on ${topic}`);
          resolve();
        }
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.end(true);
      console.error(`[CLAIM] MQTT error clearing revoke message: ${err.message}`);
      reject(err);
    });
  });
}

const router = Router();

// Get database pool from parent app
let dbPool: Pool;
router.use((req: Request, _res: Response, next) => {
  if (!dbPool && (req.app as any).locals.dbPool) {
    dbPool = (req.app as any).locals.dbPool;
  }
  next();
});

// Helper function to generate claim code
function generateClaimCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omit ambiguous chars
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ============================================================================
// POST /devices/claim - Device Claim Endpoint (NO AUTH REQUIRED)
// ============================================================================
router.post('/devices/claim', async (req: Request, res: Response) => {
  try {
    const { claimCode, deviceInfo } = req.body;

    console.log('[CLAIM] Device claim request:', { claimCode, deviceInfo });

    if (!claimCode || !deviceInfo) {
      return res.status(400).json({
        success: false,
        error: 'Missing claimCode or deviceInfo',
      });
    }

    // 1. Validate claim code
    const codeResult = await dbPool.query(
      `SELECT * FROM claim_codes
       WHERE claim_code = $1 AND status = $2 AND expires_at > NOW()`,
      [claimCode, 'active']
    );

    if (codeResult.rows.length === 0) {
      console.log('[CLAIM] Invalid or expired claim code:', claimCode);
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired claim code',
      });
    }

    const code = codeResult.rows[0];
    console.log('[CLAIM] Valid claim code found:', code);

    // 2. Check if device already exists (and is currently claimed)
    const existingDevice = await dbPool.query(
      'SELECT id, unclaimed_at FROM devices WHERE mqtt_client_id = $1',
      [deviceInfo.macAddress?.replace(/:/g, '')]
    );

    if (existingDevice.rows.length > 0) {
      const device = existingDevice.rows[0];

      // If device is currently claimed (not soft-deleted), reject
      if (device.unclaimed_at === null) {
        console.log('[CLAIM] Device already claimed:', deviceInfo.macAddress);
        return res.status(409).json({
          success: false,
          error: 'Device already claimed',
        });
      }

      // Device was unclaimed - delete the old record to allow fresh claim
      console.log('[CLAIM] Removing old unclaimed device record');
      await dbPool.query('DELETE FROM devices WHERE id = $1', [device.id]);
    }

    // 3. Generate MQTT credentials
    const deviceId = crypto.randomUUID();
    const mqttClientId = `${deviceInfo.macAddress.replace(/:/g, '')}`;
    const mqttUsername = mqttClientId; // Use MAC address as username
    const mqttPassword = crypto.randomBytes(16).toString('hex');
    const mqttPasswordHash = await bcrypt.hash(mqttPassword, 10);

    console.log('[CLAIM] Generated credentials:', {
      deviceId,
      mqttClientId,
      mqttUsername,
    });

    // 4. Insert device
    const insertResult = await dbPool.query(
      `INSERT INTO devices (
        id, tenant_id, mqtt_client_id, name, device_name,
        mqtt_username, mqtt_password, mqtt_password_plain,
        hardware_version, firmware_version, filesystem_version,
        status, claimed_at, last_seen, online
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), true)
      RETURNING id, mqtt_client_id, mqtt_username, name`,
      [
        deviceId,
        code.tenant_id,
        mqttClientId,
        code.device_name,
        code.device_name,
        mqttUsername,
        mqttPasswordHash,
        mqttPassword,  // Store plaintext for Mosquitto sync
        deviceInfo.hardwareVersion || 'ESP32',
        deviceInfo.firmwareVersion || '1.0.0',
        deviceInfo.filesystemVersion || '1.0.0',
        'offline',
      ]
    );

    console.log('[CLAIM] Device inserted:', insertResult.rows[0]);

    // 5. Sync MQTT credentials to Mosquitto password file
    // Uses debounced SIGHUP reload to handle concurrent claims
    try {
      console.log('[CLAIM] Syncing MQTT credentials to Mosquitto...');
      await syncMqttDevice(mqttUsername, mqttPassword, true);
      console.log('[CLAIM] ✓ MQTT credentials synced (reload scheduled)');
    } catch (error: any) {
      console.error('[CLAIM] ✗ CRITICAL ERROR: Failed to sync MQTT credentials:', error.message);
      console.error('[CLAIM] Error details:', error);

      // Rollback: Delete the device we just created
      await dbPool.query('DELETE FROM devices WHERE id = $1', [deviceId]);
      console.log('[CLAIM] Rolled back device creation due to MQTT sync failure');

      // Return error to device
      return res.status(500).json({
        success: false,
        error: 'Failed to sync MQTT credentials. Please contact support.',
        details: error.message,
      });
    }

    // 6. Mark claim code as used
    await dbPool.query(
      `UPDATE claim_codes
       SET status = $1, claimed_at = NOW(), claimed_by_device_id = $2
       WHERE id = $3`,
      ['claimed', deviceId, code.id]
    );

    // 7. Remove device from claiming queue (claiming complete)
    await dbPool.query(
      `DELETE FROM device_claiming_queue WHERE mac_address = $1`,
      [deviceInfo.macAddress]
    );
    console.log('[CLAIM] Device removed from claiming queue');

    // 7.5. Clear any retained revoke message for this device
    try {
      await clearRetainedRevokeMessage(code.tenant_id, mqttClientId);
    } catch (clearError: any) {
      // Log but don't fail - this is a preventive measure
      console.warn('[CLAIM] Could not clear retained revoke message:', clearError.message);
    }

    // 8. Return credentials to device
    const response = {
      success: true,
      data: {
        deviceId,
        tenantId: code.tenant_id,
        mqttClientId,
        mqttUsername,
        mqttPassword, // Plain text password for device to store
        mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
        deviceName: code.device_name,
      },
    };

    console.log('[CLAIM] ✓ Device claimed successfully:', deviceId);

    res.json(response);
  } catch (error: any) {
    console.error('[CLAIM] Error during device claim:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during device claim',
      details: error.message,
    });
  }
});

// ============================================================================
// GET /device/check-claim/:macAddress - Device polls to check if claimed (NO AUTH REQUIRED)
// ============================================================================
router.get('/device/check-claim/:macAddress', async (req: Request, res: Response) => {
  try {
    const { macAddress } = req.params;

    if (!macAddress) {
      return res.status(400).json({
        success: false,
        error: 'MAC address is required',
      });
    }

    const mqttClientId = macAddress.replace(/:/g, '');
    console.log('[CHECK-CLAIM] Device polling for claim status:', mqttClientId);

    // Check if device exists and is claimed
    const deviceResult = await dbPool.query(
      `SELECT
        id, tenant_id, mqtt_client_id, mqtt_username, mqtt_password_plain,
        name, claimed_at, unclaimed_at
       FROM devices
       WHERE mqtt_client_id = $1 AND unclaimed_at IS NULL`,
      [mqttClientId]
    );

    if (deviceResult.rows.length === 0) {
      // Device not claimed yet - return waiting status
      console.log('[CHECK-CLAIM] Device not claimed yet:', mqttClientId);
      return res.json({
        success: true,
        claimed: false,
        message: 'Waiting for claim to complete',
      });
    }

    // Device is claimed - return credentials
    const device = deviceResult.rows[0];
    console.log('[CHECK-CLAIM] ✓ Device is claimed, returning credentials:', device.id);

    res.json({
      success: true,
      claimed: true,
      data: {
        deviceId: device.id,
        tenantId: device.tenant_id,
        mqttClientId: device.mqtt_client_id,
        mqttUsername: device.mqtt_username,
        mqttPassword: device.mqtt_password_plain,
        mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
        deviceName: device.name,
      },
    });
  } catch (error: any) {
    console.error('[CHECK-CLAIM] Error checking claim status:', error);
    res.status(500).json({
      success: false,
      error: 'Server error checking claim status',
      details: error.message,
    });
  }
});

// ============================================================================
// POST /admin/claim-codes - Generate new claim code
// ============================================================================
router.post('/admin/claim-codes', async (req: Request, res: Response) => {
  try {
    const { deviceName, tenantId } = req.body;

    console.log('[CLAIM] Generate claim code request body:', req.body);

    if (!deviceName) {
      return res.status(400).json({
        success: false,
        error: 'deviceName is required',
      });
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required',
      });
    }

    // Verify the tenant exists
    const tenantCheck = await dbPool.query(
      'SELECT id FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (tenantCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
      });
    }

    const finalTenantId = tenantId;

    // Generate unique claim code
    let claimCode: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      claimCode = generateClaimCode();
      const existing = await dbPool.query(
        'SELECT id FROM claim_codes WHERE claim_code = $1',
        [claimCode]
      );

      if (existing.rows.length === 0) {
        break;
      }

      attempts++;
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate unique claim code',
      });
    }

    // Set expiration to 7 days from now
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await dbPool.query(
      `INSERT INTO claim_codes (claim_code, tenant_id, device_name, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, claim_code, tenant_id, device_name, expires_at, created_at`,
      [claimCode, finalTenantId, deviceName, expiresAt]
    );

    console.log('[CLAIM] ✓ New claim code generated:', claimCode);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('[CLAIM] Error generating claim code:', error);
    res.status(500).json({
      success: false,
      error: 'Server error generating claim code',
      details: error.message,
    });
  }
});

// ============================================================================
// GET /admin/claim-codes - List all claim codes
// ============================================================================
router.get('/admin/claim-codes', async (req: Request, res: Response) => {
  try {
    const result = await dbPool.query(
      `SELECT
        cc.id, cc.claim_code, cc.tenant_id, cc.device_name, cc.status,
        cc.claimed_at, cc.claimed_by_device_id, cc.expires_at, cc.created_at,
        t.name as tenant_name
       FROM claim_codes cc
       LEFT JOIN tenants t ON cc.tenant_id = t.id
       ORDER BY cc.created_at DESC
       LIMIT 100`
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('[CLAIM] Error listing claim codes:', error);
    res.status(500).json({
      success: false,
      error: 'Server error listing claim codes',
      details: error.message,
    });
  }
});

// ============================================================================
// GET /admin/devices - List all devices
// ============================================================================
router.get('/admin/devices', async (req: Request, res: Response) => {
  try {
    const result = await dbPool.query(
      `SELECT
        d.id, d.tenant_id, d.mqtt_client_id, d.name, d.device_name,
        d.mqtt_username, d.status, d.firmware_version, d.filesystem_version,
        d.last_seen, d.claimed_at, d.created_at,
        t.name as tenant_name
       FROM devices d
       LEFT JOIN tenants t ON d.tenant_id = t.id
       ORDER BY d.claimed_at DESC NULLS LAST
       LIMIT 100`
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('[CLAIM] Error listing devices:', error);
    res.status(500).json({
      success: false,
      error: 'Server error listing devices',
      details: error.message,
    });
  }
});

// ============================================================================
// GET /device/claim-status - Check if device is claimed (NO AUTH REQUIRED)
//
// SECURITY HARDENING: This endpoint is critical for device claim integrity.
// - Return 404 if device not found (device should stay claimed)
// - Return 410 ONLY if device has explicit unclaimed_at timestamp
// - Never return claimed:false unless explicitly revoked
// ============================================================================
router.get('/device/claim-status', async (req: Request, res: Response) => {
  try {
    const { mac } = req.query;

    if (!mac) {
      return res.status(400).json({
        success: false,
        error: 'MAC address is required',
      });
    }

    console.log('[CLAIM-STATUS] Checking claim status for MAC:', mac);

    // Look up device by MAC address (converted to mqtt_client_id format)
    const mqttClientId = String(mac).replace(/:/g, '').toUpperCase();
    const result = await dbPool.query(
      'SELECT id, name, unclaimed_at FROM devices WHERE mqtt_client_id = $1',
      [mqttClientId]
    );

    if (result.rows.length === 0) {
      // CRITICAL SECURITY FIX: Do NOT return claimed:false when device not found!
      // This could be a database sync issue or new device.
      // Device should interpret 404 as "keep current state" (stay claimed).
      console.log('[CLAIM-STATUS] Device not found in database - returning 404 (device should stay claimed)');
      return res.status(404).json({
        success: false,
        error: 'Device not found',
        // Device should interpret this as "unknown state, keep credentials"
      });
    }

    const device = result.rows[0];

    // Check if device has been EXPLICITLY revoked (unclaimed_at is NOT NULL)
    if (device.unclaimed_at !== null) {
      // This is the ONLY case where we tell device it's revoked
      console.log('[CLAIM-STATUS] Device has been EXPLICITLY revoked:', device.unclaimed_at);
      return res.status(410).json({
        success: true,
        claimed: false,
        message: 'Device has been revoked',
        revokedAt: device.unclaimed_at,
      });
    }

    console.log('[CLAIM-STATUS] Device is claimed:', device.name);
    res.json({
      success: true,
      claimed: true,
      // Don't return device name or other sensitive info for security
    });
  } catch (error: any) {
    console.error('[CLAIM-STATUS] Error checking claim status:', error);
    // On server error, return 500 - device should stay claimed
    res.status(500).json({
      success: false,
      error: 'Server error checking claim status',
    });
  }
});

// ============================================================================
// POST /device/verify-revocation - Verify revocation token (NO AUTH REQUIRED)
//
// Called by devices when they receive an MQTT /revoke message.
// Device MUST verify the token before actually unclaiming.
// This prevents accidental unclaims from network issues or malformed messages.
// ============================================================================
router.post('/device/verify-revocation', async (req: Request, res: Response) => {
  try {
    const { mac, token } = req.body;
    const clientIP = req.ip || req.socket?.remoteAddress || 'unknown';

    console.log('[VERIFY-REVOKE] ========================================');
    console.log('[VERIFY-REVOKE] Token verification request');
    console.log('[VERIFY-REVOKE] MAC:', mac);
    console.log('[VERIFY-REVOKE] Client IP:', clientIP);

    if (!mac || !token) {
      console.log('[VERIFY-REVOKE] REJECTED: Missing mac or token');
      return res.json({
        valid: false,
        reason: 'missing_params',
      });
    }

    const mqttClientId = String(mac).replace(/:/g, '').toUpperCase();

    // Look up the token
    const tokenData = revocationTokens.get(token);

    if (!tokenData) {
      console.log('[VERIFY-REVOKE] REJECTED: Token not found');
      return res.json({
        valid: false,
        reason: 'invalid_token',
      });
    }

    // Check if token is expired
    if (Date.now() > tokenData.expires) {
      revocationTokens.delete(token);
      console.log('[VERIFY-REVOKE] REJECTED: Token expired');
      return res.json({
        valid: false,
        reason: 'token_expired',
      });
    }

    // Check if token matches this device
    if (tokenData.mqttClientId !== mqttClientId) {
      console.log('[VERIFY-REVOKE] REJECTED: Token device mismatch');
      console.log('[VERIFY-REVOKE]   Expected:', tokenData.mqttClientId);
      console.log('[VERIFY-REVOKE]   Got:', mqttClientId);
      return res.json({
        valid: false,
        reason: 'device_mismatch',
      });
    }

    // Token is valid - delete it (one-time use)
    revocationTokens.delete(token);

    console.log('[VERIFY-REVOKE] ✓ TOKEN VALID');
    console.log('[VERIFY-REVOKE] Device:', mqttClientId);
    console.log('[VERIFY-REVOKE] Revocation authorized');
    console.log('[VERIFY-REVOKE] ========================================');

    return res.json({
      valid: true,
    });
  } catch (error: any) {
    console.error('[VERIFY-REVOKE] Error verifying token:', error);
    // On error, reject the revocation (device stays claimed)
    return res.json({
      valid: false,
      reason: 'server_error',
    });
  }
});

// ============================================================================
// POST /device/unclaim-notify - Device notifies server it's unclaimed (NO AUTH)
// Called by device when user triggers factory reset or local UI unclaim
// ============================================================================
router.post('/device/unclaim-notify', async (req: Request, res: Response) => {
  try {
    const { mac, source } = req.body;  // source: 'factory_reset' | 'local_ui' | undefined

    // ============================================================================
    // COMPREHENSIVE SERVER-SIDE UNCLAIM LOGGING
    // ============================================================================
    const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const timestamp = new Date().toISOString();

    console.log('========================================');
    console.log('[UNCLAIM-NOTIFY] SERVER UNCLAIM REQUEST RECEIVED');
    console.log('========================================');
    console.log('[UNCLAIM-NOTIFY] Timestamp:', timestamp);
    console.log('[UNCLAIM-NOTIFY] Source IP:', clientIP);
    console.log('[UNCLAIM-NOTIFY] User-Agent:', userAgent);
    console.log('[UNCLAIM-NOTIFY] Request MAC:', mac);
    console.log('[UNCLAIM-NOTIFY] Source:', source || 'not_specified');

    if (!mac) {
      console.log('[UNCLAIM-NOTIFY] ❌ Validation failed: MAC address missing');
      console.log('========================================');
      return res.status(400).json({
        success: false,
        error: 'MAC address is required',
      });
    }

    // Look up device by MAC address
    const mqttClientId = String(mac).replace(/:/g, '');
    console.log('[UNCLAIM-NOTIFY] Looking up device by MQTT Client ID:', mqttClientId);

    const result = await dbPool.query(
      'SELECT id, name, mqtt_username, tenant_id, unclaimed_at FROM devices WHERE mqtt_client_id = $1',
      [mqttClientId]
    );

    if (result.rows.length === 0) {
      console.log('[UNCLAIM-NOTIFY] ⚠️ Device not found in database');
      console.log('[UNCLAIM-NOTIFY] Possible reasons:');
      console.log('[UNCLAIM-NOTIFY]   1. Device was never claimed');
      console.log('[UNCLAIM-NOTIFY]   2. Device was already deleted from database');
      console.log('[UNCLAIM-NOTIFY]   3. MAC address mismatch');
      console.log('========================================');
      return res.json({
        success: true,
        message: 'Device not found or already unclaimed',
      });
    }

    const device = result.rows[0];
    console.log('[UNCLAIM-NOTIFY] Device found in database:');
    console.log('[UNCLAIM-NOTIFY]   - Device ID:', device.id);
    console.log('[UNCLAIM-NOTIFY]   - Device Name:', device.name);
    console.log('[UNCLAIM-NOTIFY]   - Tenant ID:', device.tenant_id);
    console.log('[UNCLAIM-NOTIFY]   - MQTT Username:', device.mqtt_username);
    console.log('[UNCLAIM-NOTIFY]   - Already Unclaimed:', device.unclaimed_at !== null ? 'YES' : 'NO');

    if (device.unclaimed_at !== null) {
      console.log('[UNCLAIM-NOTIFY] ⚠️ Device was already unclaimed at:', device.unclaimed_at);
      console.log('[UNCLAIM-NOTIFY] This may be a duplicate unclaim notification');
      console.log('========================================');
      return res.json({
        success: true,
        message: 'Device already unclaimed',
      });
    }

    console.log('[UNCLAIM-NOTIFY] Proceeding to mark device as unclaimed...');

    // Soft-delete: Set unclaimed_at timestamp
    await dbPool.query(
      'UPDATE devices SET unclaimed_at = NOW() WHERE id = $1',
      [device.id]
    );
    console.log('[UNCLAIM-NOTIFY] ✓ Database updated - unclaimed_at set');

    // Log to audit table
    const triggerSource = source === 'factory_reset' ? 'device_factory_reset'
                        : source === 'local_ui' ? 'device_local_ui'
                        : 'device_unknown';
    try {
      await dbPool.query(`
        INSERT INTO device_claim_audit
        (device_id, device_mac, device_name, tenant_id, action, trigger_source, actor_ip, reason)
        VALUES ($1, $2, $3, $4, 'unclaim', $5, $6, 'Device-initiated unclaim')
      `, [device.id, mqttClientId, device.name, device.tenant_id, triggerSource, clientIP]);
      console.log('[UNCLAIM-NOTIFY] ✓ Audit log recorded');
    } catch (auditError: any) {
      console.error('[UNCLAIM-NOTIFY] ⚠️ Failed to record audit log:', auditError.message);
      // Continue anyway - audit failure shouldn't block unclaim
    }

    // Remove MQTT credentials
    if (device.mqtt_username) {
      try {
        const { removeMqttDevice } = await import('../utils/mqtt-auth');
        await removeMqttDevice(device.mqtt_username);
        console.log('[UNCLAIM-NOTIFY] ✓ MQTT credentials removed from broker');
      } catch (error: any) {
        console.error('[UNCLAIM-NOTIFY] ❌ Failed to remove MQTT credentials:', error.message);
      }
    } else {
      console.log('[UNCLAIM-NOTIFY] ⚠️ No MQTT username found - skipping MQTT cleanup');
    }

    console.log('========================================');
    console.log('[UNCLAIM-NOTIFY] ✓ UNCLAIM COMPLETED SUCCESSFULLY');
    console.log('[UNCLAIM-NOTIFY] Device:', device.name);
    console.log('[UNCLAIM-NOTIFY] MAC:', mac);
    console.log('[UNCLAIM-NOTIFY] Retention: 6 months (soft delete)');
    console.log('========================================');

    res.json({
      success: true,
      message: 'Device unclaimed successfully',
    });
  } catch (error: any) {
    console.error('========================================');
    console.error('[UNCLAIM-NOTIFY] ❌ ERROR PROCESSING UNCLAIM');
    console.error('[UNCLAIM-NOTIFY] Error:', error.message);
    console.error('[UNCLAIM-NOTIFY] Stack:', error.stack);
    console.error('========================================');
    res.status(500).json({
      success: false,
      error: 'Server error processing unclaim notification',
    });
  }
});

// POST /device/claiming-mode - Device enters claiming mode (NO AUTH REQUIRED)
// Called by device when button is pressed for 5 seconds
router.post('/device/claiming-mode', async (req: Request, res: Response) => {
  try {
    const { mac, serial, ip } = req.body;

    // Validate required fields
    if (!mac) {
      return res.status(400).json({
        success: false,
        error: 'MAC address is required',
      });
    }

    // Validate MAC address format
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    if (!macRegex.test(mac)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid MAC address format',
      });
    }

    // Calculate expiry time (10 minutes from now)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    console.log('========================================');
    console.log('[CLAIMING-MODE] Device entering claiming mode');
    console.log('[CLAIMING-MODE] MAC:', mac);
    console.log('[CLAIMING-MODE] Serial:', serial || 'not provided');
    console.log('[CLAIMING-MODE] IP:', ip || 'not provided');
    console.log('[CLAIMING-MODE] Expires at:', expiresAt.toISOString());
    console.log('========================================');

    // Insert or update claiming queue entry
    await dbPool.query(
      `INSERT INTO device_claiming_queue (mac_address, serial_number, ip_address, expires_at, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (mac_address) DO UPDATE SET
         serial_number = $2,
         ip_address = $3,
         expires_at = $4,
         created_at = NOW()`,
      [mac, serial, ip, expiresAt]
    );

    console.log('[CLAIMING-MODE] ✅ Device registered in claiming queue');
    console.log('========================================');

    res.json({
      success: true,
      message: 'Device registered for claiming',
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error: any) {
    console.error('========================================');
    console.error('[CLAIMING-MODE] ❌ ERROR');
    console.error('[CLAIMING-MODE] Error:', error.message);
    console.error('[CLAIMING-MODE] Stack:', error.stack);
    console.error('========================================');
    res.status(500).json({
      success: false,
      error: 'Server error processing claiming mode registration',
    });
  }
});

// GET /device/discover - Discover devices on local network via mDNS (NO AUTH REQUIRED)
// Used by desktop browsers to find devices in claiming mode
router.get('/device/discover', async (req: Request, res: Response) => {
  try {
    console.log('========================================');
    console.log('[MDNS-DISCOVER] Starting mDNS device discovery');
    console.log('[MDNS-DISCOVER] Discovery duration: 3 seconds');
    console.log('========================================');

    const bonjour = new Bonjour();
    const discoveredDevices: Array<{
      mac: string;
      serial?: string;
      ip: string;
      name: string;
      port?: number;
    }> = [];

    // Create browser for HTTP services
    const browser = bonjour.find({ type: 'http' });

    browser.on('up', (service: any) => {
      console.log('[MDNS-DISCOVER] Service found:', service.name);
      console.log('[MDNS-DISCOVER] Type:', service.type);
      console.log('[MDNS-DISCOVER] Addresses:', service.addresses);
      console.log('[MDNS-DISCOVER] TXT records:', service.txt);

      // Check if this is a MouseTrap device in claiming mode
      if (service.txt) {
        const isClaiming = service.txt.claiming === 'true' || service.txt.claiming === true;
        const isMouseTrap = service.txt.device === 'mousetrap' || service.name?.toLowerCase().includes('mousetrap');

        console.log('[MDNS-DISCOVER] Is claiming mode:', isClaiming);
        console.log('[MDNS-DISCOVER] Is MouseTrap device:', isMouseTrap);

        if (isClaiming || isMouseTrap) {
          const device = {
            mac: service.txt.mac || 'unknown',
            serial: service.txt.serial,
            ip: service.addresses?.[0] || service.host,
            name: service.name,
            port: service.port,
          };

          // Avoid duplicates
          const isDuplicate = discoveredDevices.some(d => d.mac === device.mac);
          if (!isDuplicate && device.mac !== 'unknown') {
            console.log('[MDNS-DISCOVER] ✅ Adding device to results:', device.name);
            discoveredDevices.push(device);
          } else {
            console.log('[MDNS-DISCOVER] ⚠️ Skipping device (duplicate or no MAC)');
          }
        }
      }
    });

    // Wait 3 seconds for discovery, then return results
    setTimeout(() => {
      browser.stop();
      bonjour.destroy();

      console.log('========================================');
      console.log('[MDNS-DISCOVER] Discovery complete');
      console.log('[MDNS-DISCOVER] Devices found:', discoveredDevices.length);
      if (discoveredDevices.length > 0) {
        discoveredDevices.forEach((device, idx) => {
          console.log(`[MDNS-DISCOVER] Device ${idx + 1}:`, {
            name: device.name,
            mac: device.mac,
            ip: device.ip,
          });
        });
      } else {
        console.log('[MDNS-DISCOVER] No devices in claiming mode found');
        console.log('[MDNS-DISCOVER] Make sure:');
        console.log('[MDNS-DISCOVER]   1. Device is powered on');
        console.log('[MDNS-DISCOVER]   2. Device is on the same network');
        console.log('[MDNS-DISCOVER]   3. Device button was pressed for 5 seconds');
      }
      console.log('========================================');

      res.json({
        success: true,
        devices: discoveredDevices,
      });
    }, 3000);
  } catch (error: any) {
    console.error('========================================');
    console.error('[MDNS-DISCOVER] ❌ ERROR');
    console.error('[MDNS-DISCOVER] Error:', error.message);
    console.error('[MDNS-DISCOVER] Stack:', error.stack);
    console.error('========================================');
    res.status(500).json({
      success: false,
      error: 'Server error during mDNS discovery',
      details: error.message,
    });
  }
});

// ============================================================================
// POST /device/recover-credentials - Recover MQTT credentials (NO AUTH REQUIRED)
//
// STRANDING RECOVERY: For devices that are claimed but can't connect to MQTT.
// This can happen when:
// - Credential rotation failed halfway (device has old creds, broker has new)
// - Dynamic Security file was rebuilt from backup
// - Broker was reinstalled
// - Database-broker desync
//
// Security: Device must prove it has the CORRECT deviceId (UUID from claim)
// to receive credentials. MAC alone is not sufficient.
// ============================================================================
router.post('/device/recover-credentials', async (req: Request, res: Response) => {
  try {
    const { mac, deviceId, currentPassword } = req.body;
    const clientIP = req.ip || req.socket?.remoteAddress || 'unknown';

    console.log('========================================');
    console.log('[RECOVER-CREDS] Credential recovery request');
    console.log('[RECOVER-CREDS] Timestamp:', new Date().toISOString());
    console.log('[RECOVER-CREDS] Client IP:', clientIP);
    console.log('[RECOVER-CREDS] MAC:', mac);
    console.log('[RECOVER-CREDS] Device ID provided:', deviceId ? 'yes' : 'no');
    console.log('[RECOVER-CREDS] Current password provided:', currentPassword ? 'yes' : 'no');
    console.log('========================================');

    if (!mac) {
      console.log('[RECOVER-CREDS] REJECTED: Missing MAC address');
      return res.status(400).json({
        success: false,
        error: 'MAC address is required',
      });
    }

    // At least one of deviceId or currentPassword must be provided for verification
    if (!deviceId && !currentPassword) {
      console.log('[RECOVER-CREDS] REJECTED: No verification credentials provided');
      return res.status(400).json({
        success: false,
        error: 'deviceId or currentPassword required for verification',
      });
    }

    const mqttClientId = String(mac).replace(/:/g, '').toUpperCase();

    // Look up device in database
    const result = await dbPool.query(
      `SELECT id, tenant_id, mqtt_client_id, mqtt_username, mqtt_password, mqtt_password_plain, name, unclaimed_at
       FROM devices
       WHERE mqtt_client_id = $1`,
      [mqttClientId]
    );

    if (result.rows.length === 0) {
      console.log('[RECOVER-CREDS] REJECTED: Device not found');
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    const device = result.rows[0];

    // Check if device has been unclaimed
    if (device.unclaimed_at !== null) {
      console.log('[RECOVER-CREDS] REJECTED: Device has been unclaimed');
      return res.status(410).json({
        success: false,
        error: 'Device has been unclaimed',
      });
    }

    // Verify the request is legitimate
    let verified = false;
    let verificationMethod = '';

    // Method 1: Device ID match (strongest verification)
    if (deviceId && device.id === deviceId) {
      verified = true;
      verificationMethod = 'deviceId';
      console.log('[RECOVER-CREDS] Verified via deviceId match');
    }

    // Method 2: Current password hash match (device knows old password)
    if (!verified && currentPassword && device.mqtt_password) {
      const passwordMatch = await bcrypt.compare(currentPassword, device.mqtt_password);
      if (passwordMatch) {
        verified = true;
        verificationMethod = 'password_hash';
        console.log('[RECOVER-CREDS] Verified via password hash match');
      }
    }

    // Method 3: Current password plaintext match (fallback)
    if (!verified && currentPassword && device.mqtt_password_plain === currentPassword) {
      verified = true;
      verificationMethod = 'password_plain';
      console.log('[RECOVER-CREDS] Verified via plaintext password match');
    }

    if (!verified) {
      console.log('[RECOVER-CREDS] REJECTED: Verification failed');
      console.log('[RECOVER-CREDS]   Device ID in DB:', device.id);
      console.log('[RECOVER-CREDS]   Device ID provided:', deviceId);
      return res.status(403).json({
        success: false,
        error: 'Verification failed',
      });
    }

    console.log('[RECOVER-CREDS] Device verified via:', verificationMethod);

    // Check if we have the plaintext password
    if (!device.mqtt_password_plain) {
      // No plaintext password - we need to generate a new one
      console.log('[RECOVER-CREDS] No plaintext password available - generating new credentials');

      const newPassword = crypto.randomBytes(16).toString('hex');
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      // Update database
      await dbPool.query(
        `UPDATE devices SET mqtt_password = $1, mqtt_password_plain = $2, updated_at = NOW() WHERE id = $3`,
        [newPasswordHash, newPassword, device.id]
      );

      // Sync to broker
      try {
        await addMqttDevice(device.mqtt_username, newPassword);
        console.log('[RECOVER-CREDS] New credentials synced to broker');
      } catch (syncError: any) {
        console.error('[RECOVER-CREDS] Failed to sync to broker:', syncError.message);
        // Rollback database change
        await dbPool.query(
          `UPDATE devices SET mqtt_password = $1, mqtt_password_plain = $2, updated_at = NOW() WHERE id = $3`,
          [device.mqtt_password, device.mqtt_password_plain, device.id]
        );
        return res.status(500).json({
          success: false,
          error: 'Failed to sync credentials to broker',
        });
      }

      // Log to audit
      try {
        await dbPool.query(`
          INSERT INTO device_claim_audit
          (device_id, device_mac, device_name, tenant_id, action, trigger_source, actor_ip, reason)
          VALUES ($1, $2, $3, $4, 'credential_recovery', 'device_http', $5, 'New credentials generated - no plaintext available')
        `, [device.id, mqttClientId, device.name, device.tenant_id, clientIP]);
      } catch (auditError: any) {
        console.warn('[RECOVER-CREDS] Audit log failed:', auditError.message);
      }

      console.log('========================================');
      console.log('[RECOVER-CREDS] SUCCESS - New credentials generated');
      console.log('[RECOVER-CREDS] Device:', device.name);
      console.log('[RECOVER-CREDS] Method:', verificationMethod);
      console.log('========================================');

      return res.json({
        success: true,
        recovered: true,
        newCredentials: true,
        data: {
          deviceId: device.id,
          tenantId: device.tenant_id,
          mqttClientId: device.mqtt_client_id,
          mqttUsername: device.mqtt_username,
          mqttPassword: newPassword,
          mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
          deviceName: device.name,
        },
      });
    }

    // We have plaintext password - ensure it's synced to broker
    console.log('[RECOVER-CREDS] Ensuring credentials are synced to broker...');
    try {
      await addMqttDevice(device.mqtt_username, device.mqtt_password_plain);
      console.log('[RECOVER-CREDS] Credentials synced/confirmed in broker');
    } catch (syncError: any) {
      console.error('[RECOVER-CREDS] Failed to sync to broker:', syncError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to sync credentials to broker',
      });
    }

    // Log to audit
    try {
      await dbPool.query(`
        INSERT INTO device_claim_audit
        (device_id, device_mac, device_name, tenant_id, action, trigger_source, actor_ip, reason)
        VALUES ($1, $2, $3, $4, 'credential_recovery', 'device_http', $5, 'Existing credentials resynced to broker')
      `, [device.id, mqttClientId, device.name, device.tenant_id, clientIP]);
    } catch (auditError: any) {
      console.warn('[RECOVER-CREDS] Audit log failed:', auditError.message);
    }

    console.log('========================================');
    console.log('[RECOVER-CREDS] SUCCESS - Credentials recovered');
    console.log('[RECOVER-CREDS] Device:', device.name);
    console.log('[RECOVER-CREDS] Method:', verificationMethod);
    console.log('[RECOVER-CREDS] Auth mode:', getAuthMode());
    console.log('========================================');

    res.json({
      success: true,
      recovered: true,
      newCredentials: false,
      data: {
        deviceId: device.id,
        tenantId: device.tenant_id,
        mqttClientId: device.mqtt_client_id,
        mqttUsername: device.mqtt_username,
        mqttPassword: device.mqtt_password_plain,
        mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
        deviceName: device.name,
      },
    });
  } catch (error: any) {
    console.error('========================================');
    console.error('[RECOVER-CREDS] ERROR');
    console.error('[RECOVER-CREDS] Error:', error.message);
    console.error('[RECOVER-CREDS] Stack:', error.stack);
    console.error('========================================');
    res.status(500).json({
      success: false,
      error: 'Server error during credential recovery',
    });
  }
});

export default router;
