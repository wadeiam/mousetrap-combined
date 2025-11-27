import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { syncMqttDevice } from '../utils/mqtt-auth';
import Bonjour from 'bonjour-service';

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
    const mqttClientId = String(mac).replace(/:/g, '');
    const result = await dbPool.query(
      'SELECT id, name, unclaimed_at FROM devices WHERE mqtt_client_id = $1',
      [mqttClientId]
    );

    if (result.rows.length === 0) {
      console.log('[CLAIM-STATUS] Device not found in database');
      return res.json({
        success: true,
        claimed: false,
      });
    }

    const device = result.rows[0];

    // Check if device has been revoked (unclaimed_at is NOT NULL)
    if (device.unclaimed_at !== null) {
      console.log('[CLAIM-STATUS] Device has been revoked:', device.unclaimed_at);
      return res.status(410).json({
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
    res.status(500).json({
      success: false,
      error: 'Server error checking claim status',
    });
  }
});

// ============================================================================
// POST /device/unclaim-notify - Device notifies server it's unclaimed (NO AUTH)
// ============================================================================
router.post('/device/unclaim-notify', async (req: Request, res: Response) => {
  try {
    const { mac } = req.body;

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

export default router;
