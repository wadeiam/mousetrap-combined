import { Router, Response } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { validateUuid } from '../middleware/validation.middleware';
import { getEscalationService } from '../services/escalation.service';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

// Get database pool from parent app
let dbPool: Pool;
router.use((req: AuthRequest, _res: Response, next) => {
  if (!dbPool && (req.app as any).locals.dbPool) {
    dbPool = (req.app as any).locals.dbPool;
  }
  next();
});

// GET /alerts - List all alerts with pagination and filters
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const severity = req.query.severity as string;
    const type = req.query.type as string;
    const deviceId = req.query.deviceId as string;
    const isAcknowledged = req.query.isAcknowledged as string;
    const isResolved = req.query.isResolved as string;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    // Check if user is a Master Tenant superadmin (sees all alerts)
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
        a.id, a.device_id, a.tenant_id, a.alert_type, a.alert_status as status,
        a.severity, a.message, a.triggered_at,
        a.acknowledged_at, a.acknowledged_by, a.resolved_at, a.resolved_by,
        a.created_at, a.updated_at,
        a.mac_address, a.location, a.label,
        (a.alert_status = 'acknowledged' OR a.alert_status = 'resolved') as "isAcknowledged",
        (a.alert_status = 'resolved') as "isResolved",
        t.name as tenant_name
      FROM device_alerts a
      LEFT JOIN tenants t ON a.tenant_id = t.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Master Tenant superadmins see all alerts ONLY when viewing the Master Tenant
    // When they switch to a subtenant, they should see only that tenant's alerts
    const isViewingMasterTenant = tenantId === MASTER_TENANT_ID;
    if (!(isMasterTenantAdmin && isViewingMasterTenant)) {
      query += ` AND a.tenant_id = $${paramIndex}`;
      params.push(tenantId);
      paramIndex++;
    }

    // Filter by severity
    if (severity) {
      query += ` AND a.severity = $${paramIndex}`;
      params.push(severity);
      paramIndex++;
    }

    // Filter by alert type
    if (type) {
      query += ` AND a.alert_type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    // Filter by device ID
    if (deviceId) {
      query += ` AND a.device_id = $${paramIndex}`;
      params.push(deviceId);
      paramIndex++;
    }

    // Filter by acknowledged status
    if (isAcknowledged !== undefined) {
      if (isAcknowledged === 'true') {
        query += ` AND a.acknowledged_at IS NOT NULL`;
      } else if (isAcknowledged === 'false') {
        query += ` AND a.acknowledged_at IS NULL`;
      }
    }

    // Filter by resolved status
    if (isResolved !== undefined) {
      if (isResolved === 'true') {
        query += ` AND a.alert_status = 'resolved'`;
      } else if (isResolved === 'false') {
        query += ` AND a.alert_status IN ('new', 'acknowledged')`;
      }
    }

    // Count total records - wrap in subquery to avoid regex issues
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS count_subquery`;
    const countResult = await dbPool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    query += ` ORDER BY a.triggered_at DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await dbPool.query(query, params);

    // Transform database rows to match frontend Alert type
    const items = result.rows.map((row: any) => ({
      id: row.id,
      deviceId: row.device_id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      type: row.alert_type,
      severity: row.severity,
      message: row.message,
      isAcknowledged: row.isAcknowledged,
      acknowledgedBy: row.acknowledged_by,
      acknowledgedAt: row.acknowledged_at,
      isResolved: row.isResolved,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      macAddress: row.mac_address,
      location: row.location,
      label: row.label,
    }));

    res.json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('Get alerts error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /alerts/:id/acknowledge - Acknowledge an alert
// This stops escalation and notifies the device
router.post('/:id/acknowledge', validateUuid(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    // Check if user is a Master Tenant superadmin (can acknowledge any alert)
    const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
    const superadminCheck = await dbPool.query(
      `SELECT 1 FROM user_tenant_memberships
       WHERE user_id = $1 AND tenant_id = $2 AND role = 'superadmin'`,
      [userId, MASTER_TENANT_ID]
    );
    const isMasterTenantAdmin = superadminCheck.rows.length > 0;

    // Build the query - superadmins can acknowledge any alert
    let query = `
      UPDATE device_alerts
      SET alert_status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2
      WHERE id = $1 AND alert_status = 'active'
    `;
    const params: any[] = [id, userId];

    if (!isMasterTenantAdmin) {
      query = `
        UPDATE device_alerts
        SET alert_status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $3
        WHERE id = $1 AND tenant_id = $2 AND alert_status = 'active'
      `;
      params.push(tenantId);
      params[1] = tenantId;
      params[2] = userId;
    }

    query += ' RETURNING *';
    const result = await dbPool.query(query, isMasterTenantAdmin ? [id, userId] : [id, tenantId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found or already acknowledged',
      });
    }

    // Use the escalation service to handle acknowledgment (stops escalation, notifies device)
    const escalationService = getEscalationService();
    if (escalationService) {
      try {
        await escalationService.acknowledgeAlert(id);  // UUID string
      } catch (escError: any) {
        console.error('[Alerts] Escalation service acknowledge error:', escError.message);
        // Don't fail the request if escalation service has issues
      }
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Acknowledge alert error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /alerts/:id/resolve - Resolve an alert
router.post('/:id/resolve', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const result = await dbPool.query(
      `UPDATE alerts
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $3,
           notes = $4,
           acknowledged_by = NULL,
           acknowledged_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status IN ('new', 'acknowledged')
       RETURNING *`,
      [id, tenantId, userId, notes || null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found or already resolved',
      });
    }

    const alert = result.rows[0];

    // Get device info and send MQTT command to clear alert on device
    const deviceResult = await dbPool.query(
      'SELECT mqtt_client_id FROM devices WHERE id = $1 AND tenant_id = $2',
      [alert.device_id, tenantId]
    );

    if (deviceResult.rows.length > 0) {
      const mqttService = (req.app as any).locals.mqttService;
      const macAddress = deviceResult.rows[0].mqtt_client_id;

      try {
        await mqttService.publishDeviceCommand(
          tenantId,
          macAddress,
          {
            command: 'alert_reset',
            timestamp: Date.now(),
          }
        );
        console.log(`[Alerts] Sent alert_reset command to device ${macAddress}`);
      } catch (mqttError) {
        console.error('[Alerts] Failed to send alert_reset command:', mqttError);
        // Don't fail the request if MQTT fails
      }
    }

    res.json({
      success: true,
      data: alert,
    });
  } catch (error: any) {
    console.error('Resolve alert error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
