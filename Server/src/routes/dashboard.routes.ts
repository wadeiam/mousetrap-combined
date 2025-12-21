import { Router, Response } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';

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

// GET /dashboard/stats - Get dashboard statistics
// Master Tenant superadmins see aggregate stats across ALL tenants
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    // Check if user is a Master Tenant superadmin
    const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';
    const superadminCheck = await dbPool.query(
      `SELECT 1 FROM user_tenant_memberships
       WHERE user_id = $1
         AND tenant_id = $2
         AND role = 'superadmin'`,
      [userId, MASTER_TENANT_ID]
    );
    const isMasterTenantAdmin = superadminCheck.rows.length > 0;

    // Master Tenant superadmins see aggregate stats ONLY when viewing the Master Tenant
    // When they switch to a subtenant, they should see only that tenant's stats
    const isViewingMasterTenant = tenantId === MASTER_TENANT_ID;
    const showAllTenants = isMasterTenantAdmin && isViewingMasterTenant;

    // Build tenant filter based on context
    const tenantFilter = showAllTenants ? '' : 'AND tenant_id = $1';
    const tenantFilterDevices = showAllTenants ? '' : 'WHERE tenant_id = $1';
    const queryParams = showAllTenants ? [] : [tenantId];

    // Get device statistics (only count claimed devices - exclude soft-deleted)
    const deviceStatsResult = await dbPool.query(
      `SELECT
        COUNT(*) as total_devices,
        SUM(CASE WHEN online = true AND last_seen > NOW() - INTERVAL '15 minutes' THEN 1 ELSE 0 END) as online_devices,
        SUM(CASE WHEN online = false OR last_seen < NOW() - INTERVAL '15 minutes' THEN 1 ELSE 0 END) as offline_devices
      FROM devices
      WHERE unclaimed_at IS NULL ${tenantFilter}`,
      queryParams
    );

    // Get alert statistics from alerts table (not device_alerts)
    const alertStatsResult = await dbPool.query(
      `SELECT
        COUNT(*) as total_alerts,
        SUM(CASE WHEN status IN ('new', 'acknowledged') THEN 1 ELSE 0 END) as active_alerts,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as unacknowledged_alerts,
        SUM(CASE WHEN severity = 'critical' AND status IN ('new', 'acknowledged') THEN 1 ELSE 0 END) as critical_alerts
      FROM alerts
      WHERE triggered_at > NOW() - INTERVAL '30 days' ${tenantFilter}`,
      queryParams
    );

    // Get recent alerts (last 24 hours) from alerts table
    const recentAlertsQuery = showAllTenants
      ? `SELECT
          a.id,
          a.sensor_data->>'alert_type' as type,
          a.severity,
          a.sensor_data->>'message' as message,
          a.triggered_at as "createdAt",
          a.status,
          a.acknowledged_at as "acknowledgedAt",
          a.acknowledged_by as "acknowledgedBy",
          a.resolved_at as "resolvedAt",
          a.resolved_by as "resolvedBy",
          a.tenant_id as "tenantId",
          t.name as "tenantName",
          d.id as "deviceId",
          d.name as "deviceName",
          d.location,
          d.label,
          d.mqtt_client_id as mac_address
        FROM alerts a
        LEFT JOIN devices d ON a.device_id = d.id
        LEFT JOIN tenants t ON a.tenant_id = t.id
        WHERE a.triggered_at > NOW() - INTERVAL '24 hours'
        ORDER BY a.triggered_at DESC
        LIMIT 10`
      : `SELECT
          a.id,
          a.sensor_data->>'alert_type' as type,
          a.severity,
          a.sensor_data->>'message' as message,
          a.triggered_at as "createdAt",
          a.status,
          a.acknowledged_at as "acknowledgedAt",
          a.acknowledged_by as "acknowledgedBy",
          a.resolved_at as "resolvedAt",
          a.resolved_by as "resolvedBy",
          d.id as "deviceId",
          d.name as "deviceName",
          d.location,
          d.label,
          d.mqtt_client_id as mac_address
        FROM alerts a
        LEFT JOIN devices d ON a.device_id = d.id
        WHERE a.tenant_id = $1 AND a.triggered_at > NOW() - INTERVAL '24 hours'
        ORDER BY a.triggered_at DESC
        LIMIT 10`;

    const recentAlertsResult = await dbPool.query(recentAlertsQuery, queryParams);

    // Get alerting devices count (devices with active alerts)
    const alertingDevicesResult = await dbPool.query(
      `SELECT COUNT(DISTINCT device_id) as alerting_devices
      FROM alerts
      WHERE status IN ('new', 'acknowledged')
      AND triggered_at > NOW() - INTERVAL '24 hours' ${tenantFilter}`,
      queryParams
    );

    // Get firmware version distribution
    const firmwareDistResult = await dbPool.query(
      `SELECT
        firmware_version,
        COUNT(*) as device_count
      FROM devices
      WHERE firmware_version IS NOT NULL AND unclaimed_at IS NULL ${tenantFilter}
      GROUP BY firmware_version
      ORDER BY device_count DESC`,
      queryParams
    );

    const deviceStats = deviceStatsResult.rows[0];
    const alertStats = alertStatsResult.rows[0];
    const alertingDevices = alertingDevicesResult.rows[0];

    console.log('[Dashboard Stats] alertingDevices:', alertingDevices);
    console.log('[Dashboard Stats] alertingDevices.alerting_devices:', alertingDevices.alerting_devices);

    res.json({
      success: true,
      data: {
        // Top-level stats for the dashboard cards
        totalDevices: parseInt(deviceStats.total_devices) || 0,
        onlineDevices: parseInt(deviceStats.online_devices) || 0,
        offlineDevices: parseInt(deviceStats.offline_devices) || 0,
        alertingDevices: parseInt(alertingDevices.alerting_devices) || 0,
        activeAlerts: parseInt(alertStats.active_alerts) || 0,
        criticalAlerts: parseInt(alertStats.critical_alerts) || 0,

        // Detailed stats
        devices: {
          total: parseInt(deviceStats.total_devices) || 0,
          online: parseInt(deviceStats.online_devices) || 0,
          offline: parseInt(deviceStats.offline_devices) || 0,
        },
        alerts: {
          total: parseInt(alertStats.total_alerts) || 0,
          active: parseInt(alertStats.active_alerts) || 0,
          unacknowledged: parseInt(alertStats.unacknowledged_alerts) || 0,
          critical: parseInt(alertStats.critical_alerts) || 0,
        },
        recentAlerts: recentAlertsResult.rows.map((alert: any) => ({
          id: alert.id,
          type: alert.type || 'trap_triggered',
          severity: alert.severity,
          message: alert.message || 'Alert triggered',
          createdAt: alert.createdAt,
          isAcknowledged: alert.status === 'acknowledged' || !!alert.acknowledgedAt,
          acknowledgedAt: alert.acknowledgedAt,
          acknowledgedBy: alert.acknowledgedBy,
          isResolved: alert.status === 'resolved' || !!alert.resolvedAt,
          resolvedAt: alert.resolvedAt,
          resolvedBy: alert.resolvedBy,
          deviceId: alert.deviceId,
          tenantId: alert.tenantId || tenantId,
          tenantName: alert.tenantName,
          macAddress: alert.mac_address,
          location: alert.location,
          deviceName: alert.deviceName || alert.label || alert.location,
        })),
        // Include flag for frontend to know if this is master tenant view
        isMasterTenantView: showAllTenants,
        firmwareDistribution: firmwareDistResult.rows,
      },
    });
  } catch (error: any) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
