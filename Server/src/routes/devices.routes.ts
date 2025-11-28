import { Router, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.middleware';
import { validateUuid } from '../middleware/validation.middleware';
import { MqttService } from '../services/mqtt.service';
import { removeMqttDevice } from '../utils/mqtt-auth';

const router = Router();

// ============================================================================
// Revocation Token Store (in-memory, tokens expire after 5 minutes)
// Tokens are required for device to verify MQTT revocation commands
// ============================================================================
interface RevocationToken {
  deviceId: string;
  tenantId: string;
  mqttClientId: string;
  expires: number;
}

// Export for use in claim.routes.ts (verify-revocation endpoint)
export const revocationTokens = new Map<string, RevocationToken>();

// Clean up expired tokens periodically (every minute)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [token, data] of revocationTokens.entries()) {
    if (now > data.expires) {
      revocationTokens.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[REVOCATION-TOKENS] Cleaned up ${cleaned} expired token(s)`);
  }
}, 60 * 1000);

// Apply authentication to all routes
router.use(authenticate);

// Get database pool and MQTT service from parent app
let dbPool: Pool;
let mqttService: MqttService;
router.use((req: AuthRequest, _res: Response, next) => {
  if (!dbPool && (req.app as any).locals.dbPool) {
    dbPool = (req.app as any).locals.dbPool;
  }
  if (!mqttService && (req.app as any).locals.mqttService) {
    mqttService = (req.app as any).locals.mqttService;
  }
  next();
});

// GET /devices - List all devices with pagination and filters
// Regular users: filtered by their tenant context (from JWT)
// Master Tenant superadmins: see ALL devices across ALL tenants
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    // Check if user is a Master Tenant superadmin (sees all devices)
    const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
    const superadminCheck = await dbPool.query(
      `SELECT 1 FROM user_tenant_memberships
       WHERE user_id = $1
         AND tenant_id = $2
         AND role = 'superadmin'`,
      [userId, MASTER_TENANT_ID]
    );
    const isMasterTenantAdmin = superadminCheck.rows.length > 0;

    let query = `
      SELECT
        d.id,
        d.mqtt_client_id as "deviceId",
        d.name,
        d.tenant_id as "tenantId",
        t.name as "tenantName",
        CASE
          WHEN EXISTS (
            SELECT 1 FROM alerts a
            WHERE a.device_id = d.id
            AND a.status = 'new'
            AND a.triggered_at > NOW() - INTERVAL '24 hours'
          ) THEN 'alerting'
          WHEN d.online = true AND d.last_seen > NOW() - INTERVAL '15 minutes' THEN 'online'
          ELSE 'offline'
        END as status,
        d.location,
        d.firmware_version as "firmwareVersion",
        d.hardware_version as "hardwareVersion",
        d.last_seen as "lastSeen",
        d.uptime,
        d.rssi as "signalStrength",
        d.local_ip as "ipAddress",
        d.mac_address as "macAddress",
        d.created_at as "createdAt",
        d.updated_at as "updatedAt"
      FROM devices d
      LEFT JOIN tenants t ON d.tenant_id = t.id
      WHERE d.unclaimed_at IS NULL
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Master Tenant superadmins see all devices ONLY when viewing the Master Tenant
    // When they switch to a subtenant, they should see only that tenant's devices
    const isViewingMasterTenant = tenantId === MASTER_TENANT_ID;
    if (!(isMasterTenantAdmin && isViewingMasterTenant)) {
      query += ` AND d.tenant_id = $${paramIndex}`;
      params.push(tenantId);
      paramIndex++;
    }

    // Filter by status (can be comma-separated list)
    // Using AND logic: selecting multiple statuses means device must match ALL (which is impossible for mutually exclusive statuses)
    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      const statusConditions: string[] = [];

      if (statuses.includes('alerting')) {
        statusConditions.push(`EXISTS (
          SELECT 1 FROM alerts a
          WHERE a.device_id = d.id
          AND a.status = 'new'
          AND a.triggered_at > NOW() - INTERVAL '24 hours'
        )`);
      }
      if (statuses.includes('online')) {
        // Online includes both normal online devices and alerting devices (since alerting > online in hierarchy)
        statusConditions.push(`(d.online = true AND d.last_seen > NOW() - INTERVAL '15 minutes')`);
      }
      if (statuses.includes('offline')) {
        statusConditions.push(`((d.online = false OR d.last_seen < NOW() - INTERVAL '15 minutes') AND NOT EXISTS (
          SELECT 1 FROM alerts a
          WHERE a.device_id = d.id
          AND a.status = 'new'
          AND a.triggered_at > NOW() - INTERVAL '24 hours'
        ))`);
      }
      // TODO: Implement warning, maintenance, error statuses
      // For now, these will return no results
      const unsupportedStatuses = statuses.filter(s =>
        !['online', 'offline', 'alerting'].includes(s)
      );
      if (unsupportedStatuses.length > 0 && statusConditions.length === 0) {
        // Only unsupported statuses selected - return no results
        query += ` AND FALSE`;
      } else if (statusConditions.length > 0) {
        // AND logic: device must match ALL selected statuses (impossible for mutually exclusive statuses)
        query += ` AND (${statusConditions.join(' AND ')})`;
      }
    }

    // Search by device name, MQTT username, location, label, MAC address, IP, firmware version, hardware version, or tenant name
    if (search) {
      query += ` AND (
        d.name ILIKE $${paramIndex} OR
        d.mqtt_username ILIKE $${paramIndex} OR
        d.mqtt_client_id ILIKE $${paramIndex} OR
        d.location ILIKE $${paramIndex} OR
        d.label ILIKE $${paramIndex} OR
        d.mac_address ILIKE $${paramIndex} OR
        d.local_ip::text ILIKE $${paramIndex} OR
        d.firmware_version ILIKE $${paramIndex} OR
        d.hardware_version ILIKE $${paramIndex} OR
        t.name ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Filter by offline duration (e.g., offlineFor=1h, offlineFor=24h, offlineFor=7d, offlineFor=30d)
    const offlineFor = req.query.offlineFor as string;
    if (offlineFor) {
      // Parse duration string (e.g., "1h", "24h", "7d", "30d")
      const match = offlineFor.match(/^(\d+)([hdwm])$/i);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        let interval = '';
        switch (unit) {
          case 'h': interval = `${value} hours`; break;
          case 'd': interval = `${value} days`; break;
          case 'w': interval = `${value * 7} days`; break;
          case 'm': interval = `${value * 30} days`; break;
        }
        if (interval) {
          // Device is offline AND last seen more than X ago
          query += ` AND (d.online = false OR d.last_seen < NOW() - INTERVAL '15 minutes')`;
          query += ` AND d.last_seen < NOW() - INTERVAL '${interval}'`;
        }
      }
    }

    // Count total records - wrap in subquery to avoid regex issues with complex SELECT
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS count_subquery`;
    const countResult = await dbPool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    query += ` ORDER BY d.last_seen DESC NULLS LAST, d.created_at DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await dbPool.query(query, params);

    res.json({
      success: true,
      data: {
        items: result.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('Get devices error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /devices/:id - Get a single device by ID
// Superadmins can access any device regardless of tenant
router.get('/:id', validateUuid(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    // Check if user is superadmin (has implicit access to all tenants)
    const superadminCheck = await dbPool.query(
      `SELECT user_is_superadmin($1) as is_superadmin`,
      [userId]
    );
    const isSuperadmin = superadminCheck.rows[0].is_superadmin;

    let result;
    if (isSuperadmin) {
      // Superadmins can access any device
      result = await dbPool.query(
        `SELECT
          d.id,
          d.mqtt_client_id as "deviceId",
          d.name,
          d.tenant_id as "tenantId",
          t.name as "tenantName",
          CASE
            WHEN EXISTS (
              SELECT 1 FROM alerts a
              WHERE a.device_id = d.id
              AND a.status = 'new'
              AND a.triggered_at > NOW() - INTERVAL '24 hours'
            ) THEN 'alerting'
            WHEN d.online = true AND d.last_seen > NOW() - INTERVAL '15 minutes' THEN 'online'
            ELSE 'offline'
          END as status,
          d.location,
          d.firmware_version as "firmwareVersion",
          d.hardware_version as "hardwareVersion",
          d.last_seen as "lastSeen",
          d.uptime,
          d.rssi as "signalStrength",
          d.local_ip as "ipAddress",
          d.mac_address as "macAddress",
          d.created_at as "createdAt",
          d.updated_at as "updatedAt"
        FROM devices d
        LEFT JOIN tenants t ON d.tenant_id = t.id
        WHERE d.id = $1 AND d.unclaimed_at IS NULL`,
        [id]
      );
    } else {
      // Regular users can only access devices in their tenant
      result = await dbPool.query(
        `SELECT
          d.id,
          d.mqtt_client_id as "deviceId",
          d.name,
          d.tenant_id as "tenantId",
          t.name as "tenantName",
          CASE
            WHEN EXISTS (
              SELECT 1 FROM alerts a
              WHERE a.device_id = d.id
              AND a.status = 'new'
              AND a.triggered_at > NOW() - INTERVAL '24 hours'
            ) THEN 'alerting'
            WHEN d.online = true AND d.last_seen > NOW() - INTERVAL '15 minutes' THEN 'online'
            ELSE 'offline'
          END as status,
          d.location,
          d.firmware_version as "firmwareVersion",
          d.hardware_version as "hardwareVersion",
          d.last_seen as "lastSeen",
          d.uptime,
          d.rssi as "signalStrength",
          d.local_ip as "ipAddress",
          d.mac_address as "macAddress",
          d.created_at as "createdAt",
          d.updated_at as "updatedAt"
        FROM devices d
        LEFT JOIN tenants t ON d.tenant_id = t.id
        WHERE d.id = $1 AND d.tenant_id = $2 AND d.unclaimed_at IS NULL`,
        [id, tenantId]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Get device error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /devices - Create a new device
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { mac_address, location, label } = req.body;
    const tenantId = req.user!.tenantId;

    if (!mac_address) {
      return res.status(400).json({
        success: false,
        error: 'MAC address is required',
      });
    }

    const result = await dbPool.query(
      `INSERT INTO devices (tenant_id, mac_address, location, label)
       VALUES ($1, $2, $3, $4)
       RETURNING
        id, tenant_id, mac_address, online, firmware_version, filesystem_version,
        uptime, heap_free, rssi, local_ip, location, label, paused, last_seen,
        created_at, updated_at`,
      [tenantId, mac_address, location || null, label || null]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Create device error:', error);

    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({
        success: false,
        error: 'Device with this MAC address already exists',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PATCH /devices/:id - Update a device
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { location, label, paused } = req.body;
    const tenantId = req.user!.tenantId;

    // Build dynamic update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (location !== undefined) {
      updates.push(`location = $${paramIndex}`);
      params.push(location);
      paramIndex++;
    }

    if (label !== undefined) {
      updates.push(`label = $${paramIndex}`);
      params.push(label);
      paramIndex++;
    }

    if (paused !== undefined) {
      updates.push(`paused = $${paramIndex}`);
      params.push(paused);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
      });
    }

    params.push(id, tenantId);

    const result = await dbPool.query(
      `UPDATE devices
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
       RETURNING
        id, tenant_id, mac_address, online, firmware_version, filesystem_version,
        uptime, heap_free, rssi, local_ip, location, label, paused, last_seen,
        created_at, updated_at`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Update device error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// DELETE /devices/:id - Delete a device
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    // Check if user is a global superadmin (in Master Tenant)
    const superadminCheck = await dbPool.query(
      `SELECT 1 FROM user_tenant_memberships
       WHERE user_id = $1
         AND tenant_id = '00000000-0000-0000-0000-000000000001'
         AND role = 'superadmin'`,
      [userId]
    );
    const isSuperadmin = superadminCheck.rows.length > 0;

    let result;
    if (isSuperadmin) {
      // Superadmin can delete any device
      result = await dbPool.query(
        'DELETE FROM devices WHERE id = $1 RETURNING id, tenant_id',
        [id]
      );
    } else {
      // Regular users can only delete devices in their tenant
      result = await dbPool.query(
        'DELETE FROM devices WHERE id = $1 AND tenant_id = $2 RETURNING id',
        [id, tenantId]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    res.json({
      success: true,
      data: null,
    });
  } catch (error: any) {
    console.error('Delete device error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /devices/:id/reboot - Reboot a device (admin or superadmin only)
router.post('/:id/reboot', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;

    // Get device info
    const deviceResult = await dbPool.query(
      'SELECT mqtt_client_id, mac_address FROM devices WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    const { mqtt_client_id, mac_address } = deviceResult.rows[0];

    // Send reboot command via MQTT
    const requestId = `reboot-${Date.now()}`;
    await mqttService.publishDeviceCommand(tenantId, mqtt_client_id, {
      command: 'reboot',
      timestamp: Date.now(),
      requestId,
    });

    // Log command
    await dbPool.query(
      `INSERT INTO device_commands (tenant_id, device_id, mac_address, command_type, request_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, id, mac_address, 'reboot', requestId]
    );

    res.json({
      success: true,
      data: {
        message: 'Reboot command sent',
        requestId,
      },
    });
  } catch (error: any) {
    console.error('Reboot device error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /devices/:id/firmware-update - Trigger firmware update (admin or superadmin only)
router.post('/:id/firmware-update', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { firmwareId } = req.body;
    const tenantId = req.user!.tenantId;

    if (!firmwareId) {
      return res.status(400).json({
        success: false,
        error: 'Firmware ID is required',
      });
    }

    // Get device info
    const deviceResult = await dbPool.query(
      'SELECT mqtt_client_id, mac_address FROM devices WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    // Get firmware info
    const firmwareResult = await dbPool.query(
      `SELECT version, type, url, size, sha256
       FROM firmware_versions
       WHERE id = $1 AND (tenant_id = $2 OR is_global = true)`,
      [firmwareId, tenantId]
    );

    if (firmwareResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Firmware version not found',
      });
    }

    const { mqtt_client_id, mac_address } = deviceResult.rows[0];
    const firmware = firmwareResult.rows[0];

    // Send OTA command via MQTT
    const requestId = `ota-${Date.now()}`;
    await mqttService.publishDeviceCommand(tenantId, mqtt_client_id, {
      command: 'ota_update',
      timestamp: Date.now(),
      requestId,
      type: firmware.type,
      version: firmware.version,
      url: firmware.url,
      size: firmware.size,
      sha256: firmware.sha256,
    });

    // Log command
    await dbPool.query(
      `INSERT INTO device_commands (tenant_id, device_id, mac_address, command_type, params, request_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, id, mac_address, 'ota_update', JSON.stringify({ firmwareId }), requestId]
    );

    res.json({
      success: true,
      data: {
        message: 'Firmware update initiated',
        requestId,
        firmware: {
          version: firmware.version,
          type: firmware.type,
        },
      },
    });
  } catch (error: any) {
    console.error('Firmware update error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /devices/:id/media - Get device media files (images/videos)
router.get('/:id/media', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const type = req.query.type as string; // 'image' or 'video'
    const tenantId = req.user!.tenantId;

    // Verify device exists and belongs to tenant
    const deviceResult = await dbPool.query(
      'SELECT id FROM devices WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    // Query for media files - this would typically be in a separate media table
    // For now, returning empty array as placeholder
    res.json({
      success: true,
      data: {
        items: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      },
    });
  } catch (error: any) {
    console.error('Get device media error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /devices/:id/clear-alerts - Clear all alerts for a device (admin or superadmin only)
router.post('/:id/clear-alerts', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    // Get device info
    const deviceResult = await dbPool.query(
      'SELECT mac_address FROM devices WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    const { mac_address } = deviceResult.rows[0];

    // Clear all active alerts for this device
    const result = await dbPool.query(
      `UPDATE alerts
       SET status = 'resolved', resolved_at = NOW(), resolved_by = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND device_id = $2 AND status IN ('new', 'acknowledged')
       RETURNING id`,
      [tenantId, id, userId]
    );

    // Send MQTT command to device to reset alert state
    if (result.rows.length > 0) {
      await mqttService.resetDeviceAlert(tenantId, mac_address);
      console.log(`[Clear Alerts] Sent alert_reset command to ${mac_address}`);
    }

    res.json({
      success: true,
      data: {
        message: `Cleared ${result.rows.length} alert(s)`,
        clearedCount: result.rows.length,
      },
    });
  } catch (error: any) {
    console.error('Clear alerts error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// POST /devices/:id/unclaim - Unclaim a device (admin or superadmin only, with token verification)
// ============================================================================
router.post('/:id/unclaim', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const userIp = req.ip || req.socket?.remoteAddress || 'unknown';

    console.log('[UNCLAIM] ========================================');
    console.log('[UNCLAIM] Unclaim device request:', id);
    console.log('[UNCLAIM] Initiated by user:', userId);

    // 1. Get device info
    const deviceResult = await dbPool.query(
      'SELECT id, name, mqtt_client_id, mqtt_username, tenant_id FROM devices WHERE id = $1',
      [id]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    const device = deviceResult.rows[0];
    console.log('[UNCLAIM] Device found:', device.name, '(MAC:', device.mqtt_client_id, ')');

    // 2. Generate revocation token (device must verify this before unclaiming)
    const revocationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes

    revocationTokens.set(revocationToken, {
      deviceId: id,
      tenantId: device.tenant_id,
      mqttClientId: device.mqtt_client_id,
      expires: tokenExpiry,
    });
    console.log('[UNCLAIM] Generated revocation token (expires in 5 min)');

    // 3. Soft-delete: Set unclaimed_at timestamp
    await dbPool.query(
      'UPDATE devices SET unclaimed_at = NOW() WHERE id = $1',
      [id]
    );
    console.log('[UNCLAIM] Device marked as unclaimed (soft delete)');

    // 4. Log to audit table
    try {
      await dbPool.query(`
        INSERT INTO device_claim_audit
        (device_id, device_mac, device_name, tenant_id, action, trigger_source, actor_user_id, actor_ip, reason)
        VALUES ($1, $2, $3, $4, 'unclaim', 'admin_dashboard', $5, $6, 'Admin unclaimed device')
      `, [id, device.mqtt_client_id, device.name, device.tenant_id, userId, userIp]);
      console.log('[UNCLAIM] Audit log recorded');
    } catch (auditError: any) {
      console.error('[UNCLAIM] Failed to record audit log:', auditError.message);
      // Continue anyway - audit failure shouldn't block unclaim
    }

    // 5. Publish MQTT revocation message WITH token
    if (device.mqtt_client_id && device.tenant_id) {
      try {
        await mqttService.publishDeviceRevocation(
          device.tenant_id,
          device.mqtt_client_id,
          'Admin unclaimed device',
          revocationToken  // Device must verify this token
        );
        console.log('[UNCLAIM] ✓ MQTT revocation message published with token');
      } catch (error: any) {
        console.error('[UNCLAIM] Failed to publish MQTT revocation:', error.message);
        // Continue - device will be revoked on next connection attempt via claim-status
      }
    }

    // 6. Remove MQTT credentials from Mosquitto
    if (device.mqtt_username) {
      try {
        await removeMqttDevice(device.mqtt_username);
        console.log('[UNCLAIM] MQTT credentials removed from broker');
      } catch (error: any) {
        console.error('[UNCLAIM] Failed to remove MQTT credentials:', error.message);
        // Continue anyway - credentials will be denied due to soft delete
      }
    }

    console.log('[UNCLAIM] ✓ Device unclaimed successfully:', device.name);
    console.log('[UNCLAIM] ========================================');

    res.json({
      success: true,
      message: `Device "${device.name}" has been unclaimed and revoked`,
    });
  } catch (error: any) {
    console.error('[UNCLAIM] Error unclaiming device:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// POST /devices/:id/request-snapshot - Request camera snapshot via MQTT (admin or superadmin only)
// ============================================================================
router.post('/:id/request-snapshot', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'Tenant ID required',
      });
    }

    // Get device info
    const deviceResult = await dbPool.query(
      'SELECT id, name, mqtt_client_id, online FROM devices WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    const device = deviceResult.rows[0];

    if (!device.online) {
      return res.status(503).json({
        success: false,
        error: 'Device is offline',
      });
    }

    const macAddress = device.mqtt_client_id;

    console.log(`[SNAPSHOT] Requesting snapshot from device ${device.name} (${macAddress})`);

    // Send MQTT command to device
    await mqttService.requestSnapshot(tenantId, macAddress);

    res.json({
      success: true,
      message: 'Snapshot request sent to device',
    });

  } catch (error: any) {
    console.error('[SNAPSHOT] Error requesting snapshot:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /devices/:id/move - Move a device to a different tenant (superadmin only)
// This operation preserves the device's claim status by:
// 1. Keeping the same device UUID (no ID change)
// 2. Updating only the tenant_id in the database
// 3. Notifying the device via MQTT to update its tenant context
// 4. NOT sending any revocation messages
router.post('/:id/move', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { targetTenantId } = req.body;
    const userId = req.user!.userId;

    if (!targetTenantId) {
      return res.status(400).json({
        success: false,
        error: 'Target tenant ID is required',
      });
    }

    // Check if user is a global superadmin (in Master Tenant)
    const superadminCheck = await dbPool.query(
      `SELECT 1 FROM user_tenant_memberships
       WHERE user_id = $1
         AND tenant_id = '00000000-0000-0000-0000-000000000001'
         AND role = 'superadmin'`,
      [userId]
    );

    if (superadminCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Only superadmins can move devices between tenants',
      });
    }

    // Verify target tenant exists and is not deleted
    const tenantCheck = await dbPool.query(
      `SELECT id, name FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [targetTenantId]
    );

    if (tenantCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Target tenant not found',
      });
    }

    // Get device info and current tenant
    const deviceCheck = await dbPool.query(
      `SELECT d.id, d.name, d.tenant_id, d.mqtt_client_id, d.online, t.name as current_tenant_name
       FROM devices d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.id = $1 AND d.unclaimed_at IS NULL`,
      [id]
    );

    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    const device = deviceCheck.rows[0];
    const targetTenant = tenantCheck.rows[0];
    const oldTenantId = device.tenant_id;
    const mqttClientId = device.mqtt_client_id;
    const deviceOnline = device.online;

    if (oldTenantId === targetTenantId) {
      return res.status(400).json({
        success: false,
        error: 'Device is already in this tenant',
      });
    }

    // Update the device in database FIRST - keep the same device ID
    await dbPool.query(
      `UPDATE devices SET
        tenant_id = $1,
        updated_at = NOW()
       WHERE id = $2`,
      [targetTenantId, id]
    );

    console.log(`[MOVE-DEVICE] Device ${device.name} moved from ${device.current_tenant_name} to ${targetTenant.name}`);
    console.log(`[MOVE-DEVICE] Device ID preserved: ${id}`);

    // If device is online, send MQTT command to update its tenant context
    // The device should update its NVS with the new tenant ID and reconnect
    if (deviceOnline && mqttService && mqttClientId) {
      console.log(`[MOVE-DEVICE] Device ${device.name} is online - sending update_tenant command`);

      try {
        // Send to the OLD tenant topic (where the device is currently subscribed)
        await mqttService.publishDeviceCommand(
          oldTenantId,
          mqttClientId,
          {
            command: 'update_tenant',
            tenantId: targetTenantId,
            deviceId: id,  // Same device ID
            deviceName: device.name,
            timestamp: Date.now(),
          }
        );
        console.log(`[MOVE-DEVICE] Sent update_tenant command to device ${mqttClientId}`);
      } catch (mqttError: any) {
        console.error(`[MOVE-DEVICE] Failed to send MQTT command: ${mqttError.message}`);
        // Continue anyway - database is updated, device will need to re-register
      }
    } else {
      console.log(`[MOVE-DEVICE] Device ${device.name} is offline - database updated`);
      console.log(`[MOVE-DEVICE] Device will reconnect to new tenant on next boot`);
    }

    res.json({
      success: true,
      data: {
        deviceId: id,  // Same device ID
        deviceName: device.name,
        fromTenant: {
          id: oldTenantId,
          name: device.current_tenant_name,
        },
        toTenant: {
          id: targetTenantId,
          name: targetTenant.name,
        },
        deviceWasOnline: deviceOnline,
        note: deviceOnline
          ? 'Device was notified via MQTT to update tenant - it will reconnect automatically'
          : 'Device was offline - it will use new tenant on next connection',
      },
    });
  } catch (error: any) {
    console.error('Move device error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
