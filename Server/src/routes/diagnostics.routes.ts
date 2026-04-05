import { Router, Response } from 'express';
import { Pool } from 'pg';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.middleware';
import { getPushService } from '../services/push.service';
import { getEmailService } from '../services/email.service';
import { getSmsService } from '../services/sms.service';
import { getEscalationService } from '../services/escalation.service';
import { getOfflineEscalationService } from '../services/offline-escalation.service';
import { getClassificationService } from '../services/classification.service';
import { getHealthcheckService } from '../services/healthcheck.service';

const execAsync = promisify(exec);

const router = Router();

import { mqttMetrics } from '../services/mqtt-metrics';

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

// GET /diagnostics - Superadmin-only system diagnostics
router.get('/diagnostics', requireRole('superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    // 1. System Resources
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    const cpuUsagePercent = parseFloat((((totalTick - totalIdle) / totalTick) * 100).toFixed(1));

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const heapUsage = process.memoryUsage();

    let disk: { total: number; used: number; free: number; percent: number } | null = null;
    try {
      const { stdout } = await execAsync('df -k /');
      const lines = stdout.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const totalBlocks = parseInt(parts[1]) * 1024;
        const usedBlocks = parseInt(parts[2]) * 1024;
        const availBlocks = parseInt(parts[3]) * 1024;
        disk = {
          total: totalBlocks,
          used: usedBlocks,
          free: availBlocks,
          percent: parseFloat(((usedBlocks / totalBlocks) * 100).toFixed(1)),
        };
      }
    } catch {
      // df not available or failed - leave disk as null
    }

    const system = {
      cpu: { usagePercent: cpuUsagePercent, cores: cpus.length },
      memory: { total: totalMem, used: usedMem, free: freeMem },
      heap: { used: heapUsage.heapUsed, total: heapUsage.heapTotal },
      disk,
      systemUptime: os.uptime(),
      processUptime: process.uptime(),
      nodeVersion: process.version,
    };

    // 2. MQTT Status
    let mqtt: { connected: boolean; reconnectAttempts: number; clientId: string | null } = {
      connected: false,
      reconnectAttempts: 0,
      clientId: null,
    };
    try {
      const mqttService = (req.app as any).locals.mqttService;
      if (mqttService && typeof mqttService.getStatus === 'function') {
        mqtt = mqttService.getStatus();
      }
    } catch {
      // MQTT service not available
    }

    // 3. Database
    const pool = {
      total: dbPool.totalCount,
      idle: dbPool.idleCount,
      waiting: dbPool.waitingCount,
    };

    let dbSize: string | null = null;
    try {
      const sizeResult = await dbPool.query('SELECT pg_database_size(current_database()) as size');
      dbSize = sizeResult.rows[0].size;
    } catch {
      // Could not get DB size
    }

    const database = { pool, size: dbSize };

    // 4. Device Fleet
    let fleet = { total: 0, online: 0, offline: 0, alerting: 0, staleOnline: 0 };
    try {
      const fleetResult = await dbPool.query(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN online = true THEN 1 ELSE 0 END) as online,
          SUM(CASE WHEN online = false THEN 1 ELSE 0 END) as offline,
          SUM(CASE WHEN id IN (
            SELECT DISTINCT device_id FROM alerts WHERE status IN ('new', 'acknowledged')
          ) THEN 1 ELSE 0 END) as alerting,
          SUM(CASE WHEN online = true AND last_seen < NOW() - INTERVAL '1 hour' THEN 1 ELSE 0 END) as stale_online
        FROM devices
        WHERE unclaimed_at IS NULL
      `);

      const row = fleetResult.rows[0];
      fleet = {
        total: parseInt(row.total) || 0,
        online: parseInt(row.online) || 0,
        offline: parseInt(row.offline) || 0,
        alerting: parseInt(row.alerting) || 0,
        staleOnline: parseInt(row.stale_online) || 0,
      };
    } catch {
      // Fleet query failed
    }

    // 5. Services Status
    let dbHealthy = false;
    try {
      await dbPool.query('SELECT 1');
      dbHealthy = true;
    } catch {
      // DB not healthy
    }

    const mqttService = (req.app as any).locals.mqttService;
    const healthcheckSvc = getHealthcheckService();

    const services = {
      mqtt: mqttService ? mqttService.isConnected() : false,
      database: dbHealthy,
      push: getPushService() !== null,
      email: getEmailService() !== null,
      sms: getSmsService() !== null,
      escalation: getEscalationService() !== null,
      offlineEscalation: getOfflineEscalationService() !== null,
      classification: getClassificationService() !== null,
      healthcheck: healthcheckSvc ? healthcheckSvc.isEnabled() : false,
    };

    // 6. Push Notifications
    let pushNotifications: { last24h: number; lastHour: number } | null = null;
    try {
      const pushResult = await dbPool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour
        FROM push_notification_log
      `);
      pushNotifications = {
        last24h: parseInt(pushResult.rows[0].last_24h) || 0,
        lastHour: parseInt(pushResult.rows[0].last_hour) || 0,
      };
    } catch {
      // push_notification_log table may not exist - skip gracefully
    }

    res.json({
      success: true,
      data: {
        system,
        mqtt,
        database,
        fleet,
        services,
        pushNotifications,
        mqttMetrics: { ...mqttMetrics },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Diagnostics error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
