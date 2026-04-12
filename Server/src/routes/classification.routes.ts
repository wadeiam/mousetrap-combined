/**
 * Classification Routes
 *
 * API endpoints for image classification (rodent detection).
 */

import { Router, Response } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.middleware';
import {
  getClassificationService,
  ClassificationService,
  ClassificationType,
} from '../services/classification.service';
import { logger } from '../services/logger.service';

const router = Router();

// Get services from app.locals
let dbPool: Pool;

router.use((req: AuthRequest, _res: Response, next) => {
  if (!dbPool && (req.app as any).locals.dbPool) {
    dbPool = (req.app as any).locals.dbPool;
  }
  next();
});

// /debug, /live, and /stats are unauthenticated (monitoring dashboards).
// All other routes require authentication.
router.use((req: AuthRequest, _res: Response, next) => {
  const openPaths = ['/debug', '/debug-test', '/live', '/stats', '/ml-performance'];
  if (openPaths.some(p => req.path === p)) {
    return next();
  }
  return authenticate(req as any, _res, next);
});

/**
 * GET /api/classification/status
 * Get classification service status and model info
 */
router.get('/status', async (_req: AuthRequest, res: Response) => {
  try {
    const service = getClassificationService();

    if (!service) {
      return res.status(503).json({
        status: 'unavailable',
        message: 'Classification service not initialized',
      });
    }

    const modelInfo = service.getModelInfo();

    res.json({
      status: modelInfo.ready ? 'ready' : modelInfo.loading ? 'loading' : 'unavailable',
      model: modelInfo,
    });
  } catch (error: any) {
    logger.error('Error getting classification status', { error: error.message });
    res.status(500).json({ error: 'Failed to get classification status' });
  }
});

/**
 * POST /api/classification/classify
 * Classify an uploaded image
 *
 * Body: { image: string (base64), deviceId?: string, source?: string }
 */
router.post('/classify', async (req: AuthRequest, res: Response) => {
  try {
    const service = getClassificationService();

    if (!service) {
      return res.status(503).json({ error: 'Classification service not available' });
    }

    const { image, deviceId, source } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Image is required (base64 encoded)' });
    }

    // Validate base64
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    const cleanImage = image.replace(/^data:image\/\w+;base64,/, ''); // Strip data URL prefix if present

    if (!base64Regex.test(cleanImage)) {
      return res.status(400).json({ error: 'Invalid base64 image data' });
    }

    const tenantId = req.user!.tenantId;

    // Verify device belongs to tenant if deviceId provided
    if (deviceId) {
      const deviceCheck = await dbPool.query(
        `SELECT id FROM devices WHERE id = $1 AND tenant_id = $2`,
        [deviceId, tenantId]
      );

      if (deviceCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Device not found' });
      }
    }

    // Initialize model if needed (first request)
    if (!service.isReady()) {
      await service.initialize();
    }

    // Classify the image
    const result = await service.classifyImage(cleanImage);

    // Store the classification
    const stored = await service.storeClassification(
      tenantId,
      deviceId || null,
      cleanImage,
      result,
      source || 'manual_upload'
    );

    res.json({
      id: stored.id,
      classification: stored.classification,
      confidence: stored.confidence,
      allPredictions: stored.allPredictions,
      inferenceTimeMs: stored.inferenceTimeMs,
      modelVersion: stored.modelVersion,
      isRodent: stored.classification === 'mouse' || stored.classification === 'rat',
      classifiedAt: stored.classifiedAt,
    });
  } catch (error: any) {
    logger.error('Classification failed', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Classification failed', details: error.message });
  }
});

/**
 * POST /api/classification/classify-snapshot/:deviceId
 * Classify the latest snapshot from a device
 */
router.post('/classify-snapshot/:deviceId', async (req: AuthRequest, res: Response) => {
  try {
    const service = getClassificationService();

    if (!service) {
      return res.status(503).json({ error: 'Classification service not available' });
    }

    const { deviceId } = req.params;
    const tenantId = req.user!.tenantId;
    const isSuperAdmin = req.user!.role === 'superadmin';

    // Get device and its latest snapshot
    let query: string;
    let params: any[];

    if (isSuperAdmin) {
      query = `SELECT id, tenant_id, last_snapshot, last_snapshot_at FROM devices WHERE id = $1`;
      params = [deviceId];
    } else {
      query = `SELECT id, tenant_id, last_snapshot, last_snapshot_at FROM devices WHERE id = $1 AND tenant_id = $2`;
      params = [deviceId, tenantId];
    }

    const { rows } = await dbPool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = rows[0];

    if (!device.last_snapshot) {
      return res.status(400).json({ error: 'No snapshot available for this device' });
    }

    // Initialize model if needed
    if (!service.isReady()) {
      await service.initialize();
    }

    // Classify the snapshot
    const result = await service.classifyImage(device.last_snapshot);

    // Store the classification
    const stored = await service.storeClassification(
      device.tenant_id,
      deviceId,
      device.last_snapshot,
      result,
      'device_snapshot'
    );

    res.json({
      id: stored.id,
      deviceId,
      classification: stored.classification,
      confidence: stored.confidence,
      allPredictions: stored.allPredictions,
      inferenceTimeMs: stored.inferenceTimeMs,
      modelVersion: stored.modelVersion,
      isRodent: stored.classification === 'mouse' || stored.classification === 'rat',
      snapshotAt: device.last_snapshot_at,
      classifiedAt: stored.classifiedAt,
    });
  } catch (error: any) {
    logger.error('Snapshot classification failed', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Classification failed', details: error.message });
  }
});

/**
 * GET /api/classification/history/:deviceId
 * Get classification history for a device
 */
router.get('/history/:deviceId', async (req: AuthRequest, res: Response) => {
  try {
    const service = getClassificationService();

    if (!service) {
      return res.status(503).json({ error: 'Classification service not available' });
    }

    const { deviceId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const tenantId = req.user!.tenantId;
    const isSuperAdmin = req.user!.role === 'superadmin';

    // Verify device access
    let deviceQuery: string;
    let deviceParams: any[];

    if (isSuperAdmin) {
      deviceQuery = `SELECT id, tenant_id FROM devices WHERE id = $1`;
      deviceParams = [deviceId];
    } else {
      deviceQuery = `SELECT id, tenant_id FROM devices WHERE id = $1 AND tenant_id = $2`;
      deviceParams = [deviceId, tenantId];
    }

    const deviceResult = await dbPool.query(deviceQuery, deviceParams);

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = deviceResult.rows[0];
    const history = await service.getDeviceClassifications(device.tenant_id, deviceId, limit);

    res.json({
      deviceId,
      classifications: history,
      count: history.length,
    });
  } catch (error: any) {
    logger.error('Failed to get classification history', { error: error.message });
    res.status(500).json({ error: 'Failed to get classification history' });
  }
});

/**
 * POST /api/classification/:id/correct
 * Submit a correction for a classification (for model training)
 */
router.post('/:id/correct', async (req: AuthRequest, res: Response) => {
  try {
    const service = getClassificationService();

    if (!service) {
      return res.status(503).json({ error: 'Classification service not available' });
    }

    const { id } = req.params;
    const { correctedClass } = req.body;
    const userId = req.user!.userId;
    const tenantId = req.user!.tenantId;

    // Validate corrected class
    const validClasses: ClassificationType[] = [
      'mouse',
      'rat',
      'cat',
      'dog',
      'human',
      'bird',
      'insect',
      'unknown',
      'empty',
    ];

    if (!correctedClass || !validClasses.includes(correctedClass)) {
      return res.status(400).json({
        error: 'Invalid corrected class',
        validClasses,
      });
    }

    // Verify classification belongs to tenant
    const checkQuery = `
      SELECT id FROM image_classifications
      WHERE id = $1 AND tenant_id = $2
    `;
    const checkResult = await dbPool.query(checkQuery, [id, tenantId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Classification not found' });
    }

    await service.submitCorrection(id, userId, correctedClass);

    res.json({
      success: true,
      message: 'Correction submitted. Thank you for improving the model!',
    });
  } catch (error: any) {
    logger.error('Failed to submit correction', { error: error.message });
    res.status(500).json({ error: 'Failed to submit correction' });
  }
});

/**
 * GET /api/classification/activity
 * Get activity summary for dashboard visualization
 * Returns per-device activity, recent detections, and trend data
 */
router.get('/activity', async (req: AuthRequest, res: Response) => {
  logger.info('Activity endpoint called', { tenantId: req.user?.tenantId, role: req.user?.role });
  try {
    const tenantId = req.user!.tenantId;
    const isSuperAdmin = req.user!.role === 'superadmin';
    const days = parseInt(req.query.days as string) || 7;

    // Query parameters for tenant filtering
    const tenantFilter = isSuperAdmin ? '' : 'AND d.tenant_id = $1';
    const params = isSuperAdmin ? [] : [tenantId];

    // 1. Per-device activity (last N days)
    const deviceActivityQuery = `
      SELECT
        d.id as device_id,
        d.name as device_name,
        d.location,
        d.device_type,
        COALESCE(d.location_type, 'interior') as location_type,
        COUNT(ic.id) as detection_count,
        MAX(ic.classified_at) as last_detection,
        COUNT(CASE WHEN ic.classification IN ('mouse', 'rat', 'hamster', 'rodent') THEN 1 END) as rodent_count
      FROM devices d
      LEFT JOIN image_classifications ic ON d.id = ic.device_id
        AND ic.classified_at > NOW() - INTERVAL '${days} days'
      WHERE 1=1 ${tenantFilter}
      GROUP BY d.id, d.name, d.location, d.device_type, d.location_type
      HAVING COUNT(ic.id) > 0
      ORDER BY detection_count DESC
      LIMIT 10
    `;

    const deviceActivity = await dbPool.query(deviceActivityQuery, params);

    // 2. Recent detections with classification (last 20)
    const recentQuery = `
      SELECT
        ic.id,
        ic.device_id,
        d.name as device_name,
        d.location as device_location,
        ic.classification,
        ic.confidence,
        ic.classified_at,
        ic.image_source,
        ic.image_hash as image_preview
      FROM image_classifications ic
      JOIN devices d ON ic.device_id = d.id
      WHERE ic.classified_at > NOW() - INTERVAL '${days} days'
        ${tenantFilter.replace('d.tenant_id', 'ic.tenant_id')}
      ORDER BY ic.classified_at DESC
      LIMIT 20
    `;

    const recentDetections = await dbPool.query(recentQuery, params);

    // 3. Daily trend (detections per day for last N days)
    const trendQuery = `
      SELECT
        DATE(ic.classified_at) as date,
        COUNT(*) as total,
        COUNT(CASE WHEN ic.classification IN ('mouse', 'rat', 'hamster', 'rodent') THEN 1 END) as rodents
      FROM image_classifications ic
      WHERE ic.classified_at > NOW() - INTERVAL '${days} days'
        ${tenantFilter.replace('d.tenant_id', 'ic.tenant_id')}
      GROUP BY DATE(ic.classified_at)
      ORDER BY date ASC
    `;

    const trend = await dbPool.query(trendQuery, params);

    // 4. Hourly distribution (when are detections happening)
    const hourlyQuery = `
      SELECT
        EXTRACT(HOUR FROM ic.classified_at) as hour,
        COUNT(*) as count
      FROM image_classifications ic
      WHERE ic.classified_at > NOW() - INTERVAL '${days} days'
        ${tenantFilter.replace('d.tenant_id', 'ic.tenant_id')}
      GROUP BY EXTRACT(HOUR FROM ic.classified_at)
      ORDER BY hour ASC
    `;

    const hourly = await dbPool.query(hourlyQuery, params);

    // Calculate summary stats
    const totalDetections = deviceActivity.rows.reduce(
      (sum, d) => sum + parseInt(d.detection_count),
      0
    );
    const totalRodents = deviceActivity.rows.reduce(
      (sum, d) => sum + parseInt(d.rodent_count),
      0
    );

    // Find peak hour
    let peakHour = 0;
    let peakCount = 0;
    hourly.rows.forEach((h: { hour: number; count: string }) => {
      const count = parseInt(h.count);
      if (count > peakCount) {
        peakCount = count;
        peakHour = h.hour;
      }
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalDetections,
          totalRodents,
          deviceCount: deviceActivity.rows.length,
          peakHour,
          peakHourFormatted: `${peakHour}:00 - ${(peakHour + 1) % 24}:00`,
          days,
        },
        deviceActivity: deviceActivity.rows.map((d) => ({
          deviceId: d.device_id,
          deviceName: d.device_name,
          location: d.location,
          deviceType: d.device_type,
          locationType: d.location_type,
          detectionCount: parseInt(d.detection_count),
          rodentCount: parseInt(d.rodent_count),
          lastDetection: d.last_detection,
          recommendation: getRecommendation(d.location_type, parseInt(d.detection_count)),
        })),
        recentDetections: recentDetections.rows.map((r) => ({
          id: r.id,
          deviceId: r.device_id,
          deviceName: r.device_name,
          location: r.device_location,
          classification: r.classification,
          confidence: parseFloat(r.confidence),
          classifiedAt: r.classified_at,
          source: r.image_source,
          hasImage: !!r.image_preview,
        })),
        trend: trend.rows.map((t) => ({
          date: t.date,
          total: parseInt(t.total),
          rodents: parseInt(t.rodents),
        })),
        hourlyDistribution: hourly.rows.map((h) => ({
          hour: parseInt(h.hour),
          count: parseInt(h.count),
        })),
      },
    });
  } catch (error: any) {
    logger.error('Failed to get activity summary', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get activity summary', details: error.message });
  }
});

// Helper function to generate recommendations based on location type and activity
function getRecommendation(locationType: string, detectionCount: number): string {
  if (detectionCount === 0) return 'No recent activity';

  const urgency = detectionCount >= 10 ? 'High activity - ' : detectionCount >= 5 ? 'Moderate activity - ' : '';

  switch (locationType) {
    case 'entry_point':
      return `${urgency}Seal this entry point`;
    case 'interior':
      return `${urgency}Place trap here`;
    case 'both':
      return `${urgency}Seal AND place trap`;
    default:
      return `${urgency}Investigate this location`;
  }
}

/**
 * GET /api/classification/stats
 * Get classification statistics for the tenant
 */
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const service = getClassificationService();

    if (!service) {
      return res.status(503).json({ error: 'Classification service not available' });
    }

    // When accessed without auth (monitoring), get stats for all tenants
    const tenantId = req.user?.tenantId;
    // If no tenant (unauthenticated monitoring), return basic service stats only
    if (!tenantId) {
      return res.json({
        serviceStatus: 'running',
        modelLoaded: true,
        message: 'Use authenticated request for per-tenant stats',
      });
    }
    const stats = await service.getClassificationStats(tenantId);

    res.json(stats);
  } catch (error: any) {
    logger.error('Failed to get classification stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get classification stats' });
  }
});

/**
 * GET /api/classification/corrections
 * Get classifications that have been corrected (for training data export)
 * Admin only
 */
router.get(
  '/corrections',
  requireRole('admin', 'superadmin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const isSuperAdmin = req.user!.role === 'superadmin';
      const limit = parseInt(req.query.limit as string) || 100;

      let query: string;
      let params: any[];

      if (isSuperAdmin) {
        // Superadmin can see all corrections
        query = `
        SELECT
          ic.id,
          ic.device_id,
          ic.tenant_id,
          ic.image_hash,
          ic.classification as original_class,
          ic.user_corrected_class as corrected_class,
          ic.confidence,
          ic.corrected_at,
          u.email as corrected_by_email
        FROM image_classifications ic
        LEFT JOIN users u ON ic.corrected_by = u.id
        WHERE ic.user_corrected_class IS NOT NULL
        ORDER BY ic.corrected_at DESC
        LIMIT $1
      `;
        params = [limit];
      } else {
        query = `
        SELECT
          ic.id,
          ic.device_id,
          ic.tenant_id,
          ic.image_hash,
          ic.classification as original_class,
          ic.user_corrected_class as corrected_class,
          ic.confidence,
          ic.corrected_at,
          u.email as corrected_by_email
        FROM image_classifications ic
        LEFT JOIN users u ON ic.corrected_by = u.id
        WHERE ic.user_corrected_class IS NOT NULL AND ic.tenant_id = $1
        ORDER BY ic.corrected_at DESC
        LIMIT $2
      `;
        params = [tenantId, limit];
      }

      const { rows } = await dbPool.query(query, params);

      res.json({
        corrections: rows,
        count: rows.length,
        message:
          'These corrections can be used to fine-tune the classification model',
      });
    } catch (error: any) {
      logger.error('Failed to get corrections', { error: error.message });
      res.status(500).json({ error: 'Failed to get corrections' });
    }
  }
);

/**
 * GET /api/classification/live
 * Get live feed of recent classifications with full details
 * For debugging and monitoring ML performance
 */
router.get('/live', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    // When accessed without auth (monitoring), show all tenants
    const isSuperAdmin = !tenantId || req.user?.role === 'superadmin';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const minutes = parseInt(req.query.minutes as string) || 60;

    const tenantFilter = isSuperAdmin ? '' : 'AND ic.tenant_id = $2';
    const params: any[] = [limit];
    if (!isSuperAdmin) params.push(tenantId);

    const query = `
      SELECT
        ic.id,
        ic.device_id,
        d.name as device_name,
        d.mac_address,
        ic.classification,
        ic.confidence,
        ic.all_predictions,
        ic.classified_at,
        ic.user_corrected_class,
        ic.image_source,
        ic.model_version,
        ic.edge_verdict,
        ic.edge_confidence
      FROM image_classifications ic
      JOIN devices d ON ic.device_id = d.id
      WHERE ic.classified_at > NOW() - INTERVAL '${minutes} minutes'
        ${tenantFilter}
      ORDER BY ic.classified_at DESC
      LIMIT $1
    `;

    const { rows } = await dbPool.query(query, params);

    // Calculate summary stats
    const stats = {
      total: rows.length,
      byClass: {} as Record<string, number>,
      avgConfidence: 0,
      rodentCount: 0,
    };

    let totalConfidence = 0;
    rows.forEach((row: any) => {
      stats.byClass[row.classification] = (stats.byClass[row.classification] || 0) + 1;
      totalConfidence += row.confidence;
      if (['rodent', 'mouse', 'rat'].includes(row.classification)) {
        stats.rodentCount++;
      }
    });
    stats.avgConfidence = rows.length > 0 ? totalConfidence / rows.length : 0;

    res.json({
      success: true,
      timeRange: `Last ${minutes} minutes`,
      stats,
      classifications: rows.map((r: any) => ({
        id: r.id,
        deviceId: r.device_id,
        deviceName: r.device_name,
        macAddress: r.mac_address,
        classification: r.classification,
        confidence: r.confidence,
        confidencePercent: (r.confidence * 100).toFixed(1) + '%',
        allPredictions: r.all_predictions,
        classifiedAt: r.classified_at,
        corrected: r.user_corrected_class,
        source: r.image_source,
        modelVersion: r.model_version,
        edgeVerdict: r.edge_verdict,
        edgeConfidence: r.edge_confidence,
      })),
    });
  } catch (error: any) {
    logger.error('Failed to get live classifications', { error: error.message });
    res.status(500).json({ error: 'Failed to get live classifications' });
  }
});

/**
 * GET /api/classification/debug-test
 * Minimal test page to diagnose fetch issues
 */
router.get('/debug-test', async (_req: AuthRequest, res: Response) => {
  res.type('html').send(`<!DOCTYPE html>
<html><body style="background:#111;color:#eee;font-family:monospace;padding:20px">
<h2>Debug Test</h2>
<pre id="out">Fetching...</pre>
<script>
(async function() {
  const el = document.getElementById('out');
  try {
    const url = window.location.origin + '/api/classification/live?minutes=60&limit=5';
    el.textContent = 'Fetching: ' + url + '\\n';
    const res = await fetch(url);
    el.textContent += 'Status: ' + res.status + '\\n';
    const text = await res.text();
    el.textContent += 'Length: ' + text.length + '\\n';
    const data = JSON.parse(text);
    el.textContent += 'Success: ' + data.success + '\\n';
    el.textContent += 'Count: ' + (data.classifications||[]).length + '\\n';
    if (data.classifications && data.classifications[0]) {
      el.textContent += 'First: ' + data.classifications[0].classification + ' ' + data.classifications[0].confidencePercent + '\\n';
    }
    if (data.error) {
      el.textContent += 'Error: ' + data.error + '\\n';
    }
  } catch(e) {
    el.textContent += 'CATCH: ' + e.name + ': ' + e.message + '\\n' + e.stack;
  }
})();
</script></body></html>`);
});

/**
 * GET /api/classification/debug
 * ML Pipeline Performance Dashboard
 * Shows per-device scout + server metrics, signal quality, insights
 */
router.get('/debug', async (req: AuthRequest, res: Response) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>ML Pipeline Dashboard</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #00d4ff; margin-bottom: 5px; }
    h2 { color: #aaa; font-size: 14px; margin-bottom: 20px; font-weight: normal; }
    h3 { color: #00d4ff; margin: 25px 0 10px; font-size: 16px; }
    .stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-card { background: #16213e; padding: 12px 20px; border-radius: 8px; min-width: 120px; }
    .stat-card h4 { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card .value { font-size: 24px; font-weight: bold; color: #00d4ff; }
    .stat-card.warn .value { color: #ffd93d; }
    .stat-card.danger .value { color: #ff6b6b; }
    .stat-card.good .value { color: #6bcb77; }
    .controls { margin-bottom: 20px; display: flex; gap: 10px; align-items: center; }
    button { background: #00d4ff; color: #000; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 13px; }
    button:hover { background: #00a8cc; }
    select { background: #16213e; color: #eee; border: 1px solid #333; padding: 8px; border-radius: 5px; }
    table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #222; font-size: 13px; }
    th { background: #0f3460; color: #00d4ff; font-weight: 600; font-size: 11px; text-transform: uppercase; }
    tr:hover { background: #1f4068; }
    .bar { height: 8px; border-radius: 4px; display: inline-block; vertical-align: middle; }
    .bar-rodent { background: #ff6b6b; }
    .bar-pet { background: #ffd93d; }
    .bar-person { background: #6bcb77; }
    .bar-bird { background: #4ecdc4; }
    .bar-other { background: #444; }
    .insight { background: #1e2a4a; border-left: 3px solid #ffd93d; padding: 10px 15px; margin: 5px 0; border-radius: 0 5px 5px 0; font-size: 13px; }
    .insight.good { border-color: #6bcb77; }
    .tab-bar { display: flex; gap: 2px; margin-bottom: 15px; }
    .tab { padding: 8px 20px; background: #16213e; cursor: pointer; border-radius: 5px 5px 0 0; font-size: 13px; }
    .tab.active { background: #0f3460; color: #00d4ff; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .muted { color: #666; }
    .mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .pill-good { background: #1a3a2a; color: #6bcb77; }
    .pill-warn { background: #3a3a1a; color: #ffd93d; }
    .pill-bad { background: #3a1a1a; color: #ff6b6b; }
    .refresh-indicator { color: #444; font-size: 11px; }
    #loading { text-align: center; padding: 60px; color: #666; }
  </style>
</head>
<body>
  <h1>ML Pipeline Dashboard</h1>
  <h2 id="subtitle">Loading...</h2>

  <div class="controls">
    <select id="hours" onchange="load()">
      <option value="1">Last 1 hour</option>
      <option value="6">Last 6 hours</option>
      <option value="24" selected>Last 24 hours</option>
      <option value="72">Last 3 days</option>
      <option value="168">Last 7 days</option>
    </select>
    <button onclick="load()">Refresh</button>
    <span class="refresh-indicator" id="lastRefresh"></span>
  </div>

  <!-- System summary -->
  <div class="stats" id="systemStats"></div>

  <!-- Tabs -->
  <div class="tab-bar">
    <div class="tab active" onclick="switchTab('devices')">Per-Device</div>
    <div class="tab" onclick="switchTab('hourly')">Hourly Rates</div>
    <div class="tab" onclick="switchTab('corrections')">Corrections</div>
    <div class="tab" onclick="switchTab('recent')">Recent Events</div>
  </div>

  <div id="tab-devices" class="tab-content active"></div>
  <div id="tab-hourly" class="tab-content"></div>
  <div id="tab-corrections" class="tab-content"></div>
  <div id="tab-recent" class="tab-content"></div>

  <!-- Insights -->
  <h3>Insights</h3>
  <div id="insights"></div>

  <script>
    function switchTab(name) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      event.target.classList.add('active');
    }

    function pct(n, total) { return total > 0 ? (n / total * 100).toFixed(0) : '0'; }

    function classBar(breakdown, total) {
      if (total === 0) return '<span class="muted">no data</span>';
      const items = [
        { key: 'rodent', cls: 'bar-rodent' },
        { key: 'pet', cls: 'bar-pet' },
        { key: 'person', cls: 'bar-person' },
        { key: 'bird', cls: 'bar-bird' },
        { key: 'other', cls: 'bar-other' },
      ];
      return items.map(i => {
        const w = Math.max(0, (breakdown[i.key] || 0) / total * 100);
        return w > 0 ? '<span class="bar ' + i.cls + '" style="width:' + w + '%" title="' + i.key + ': ' + breakdown[i.key] + '"></span>' : '';
      }).join('') + ' <span class="muted mono">' + total + '</span>';
    }

    function signalPill(sq) {
      if (sq.assessment === 'good') return '<span class="pill pill-good">' + sq.usefulRate + '% useful</span>';
      if (sq.assessment === 'noisy') return '<span class="pill pill-warn">' + sq.usefulRate + '% useful</span>';
      return '<span class="pill pill-bad">' + sq.usefulRate + '% useful</span>';
    }

    async function load() {
      const hours = document.getElementById('hours').value;

      // Load ML performance
      try {
        const res = await fetch('/api/classification/ml-performance?hours=' + hours);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        renderSystem(data.system, hours);
        renderDevices(data.devices);
        renderHourly(data.hourlyRates);
        renderCorrections(data.corrections);
        renderInsights(data.insights);
        document.getElementById('subtitle').textContent =
          data.system.totalClassifications + ' classifications from ' +
          data.system.activeDevices + ' device(s) in last ' + hours + 'h';
      } catch (err) {
        document.getElementById('subtitle').textContent = 'Error: ' + err.message;
      }

      // Load recent events
      try {
        const mins = Math.min(parseInt(hours) * 60, 1440);
        const res2 = await fetch('/api/classification/live?minutes=' + mins + '&limit=50');
        const live = await res2.json();
        if (live.success) renderRecent(live.classifications);
      } catch (e) {}

      document.getElementById('lastRefresh').textContent = 'Updated ' + new Date().toLocaleTimeString();
    }

    function renderSystem(sys, hours) {
      const el = document.getElementById('systemStats');
      el.innerHTML = [
        card('Total', sys.totalClassifications, sys.totalClassifications > 100 ? 'warn' : ''),
        card('Rodent', sys.breakdown.rodent, sys.breakdown.rodent > 0 ? 'danger' : 'good'),
        card('Person', sys.breakdown.person, ''),
        card('Pet', sys.breakdown.pet, ''),
        card('Other', sys.breakdown.other, sys.breakdown.other > sys.totalClassifications * 0.8 ? 'warn' : ''),
        card('Avg Conf', (sys.avgConfidence * 100).toFixed(0) + '%', sys.avgConfidence < 0.4 ? 'warn' : 'good'),
        card('Avg Inference', (sys.avgInferenceMs || 0) + 'ms', ''),
        card('Low Conf', sys.totalLowConfidence, sys.totalLowConfidence > 5 ? 'warn' : ''),
        card('Corrections', sys.totalCorrections, sys.totalCorrections > 0 ? 'warn' : ''),
        card('Storage', sys.storageMB + ' MB', ''),
      ].join('');
    }

    function card(label, value, cls) {
      return '<div class="stat-card ' + cls + '"><h4>' + label + '</h4><div class="value">' + value + '</div></div>';
    }

    function renderDevices(devices) {
      if (devices.length === 0) {
        document.getElementById('tab-devices').innerHTML = '<p class="muted" style="padding:30px">No device data</p>';
        return;
      }
      let html = '<table><thead><tr>';
      html += '<th>Device</th><th>Images</th><th>Img/hr</th><th>Classification Breakdown</th>';
      html += '<th>Signal</th><th>Confidence</th><th>Edge PF</th><th>Model</th>';
      html += '</tr></thead><tbody>';
      for (const d of devices) {
        html += '<tr>';
        html += '<td><strong>' + (d.deviceName || '?') + '</strong><br><span class="muted mono">' + (d.macAddress || '') + '</span></td>';
        html += '<td>' + d.server.totalClassified + '</td>';
        html += '<td>' + d.server.imagesPerHour + '</td>';
        html += '<td style="min-width:200px">' + classBar(d.server.breakdown, d.server.totalClassified) + '</td>';
        html += '<td>' + signalPill(d.signalQuality) + '</td>';
        html += '<td class="mono">' + (d.server.confidence.avg * 100).toFixed(0) + '%'
              + (d.server.confidence.lowCount > 0 ? ' <span class="pill pill-warn">' + d.server.confidence.lowCount + ' low</span>' : '')
              + '</td>';
        html += '<td class="mono">' + (d.edge.totalInferences > 0
              ? d.edge.worthSending + ' sent / ' + d.edge.totalInferences + ' total'
              : '<span class="muted">none</span>') + '</td>';
        html += '<td class="mono muted">' + (d.server.modelVersions.join(', ') || '-') + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      document.getElementById('tab-devices').innerHTML = html;
    }

    function renderHourly(rates) {
      if (rates.length === 0) {
        document.getElementById('tab-hourly').innerHTML = '<p class="muted" style="padding:30px">No hourly data</p>';
        return;
      }
      let html = '<table><thead><tr><th>Hour</th><th>Device</th><th>Images</th><th>Rodents</th><th>Rate</th></tr></thead><tbody>';
      for (const r of rates) {
        const d = new Date(r.hour);
        html += '<tr><td class="mono">' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '</td>';
        html += '<td>' + r.deviceName + '</td>';
        html += '<td>' + r.count + '</td>';
        html += '<td' + (r.rodentCount > 0 ? ' style="color:#ff6b6b;font-weight:bold"' : '') + '>' + r.rodentCount + '</td>';
        const barW = Math.min(100, r.count * 5);
        html += '<td><span class="bar bar-other" style="width:' + barW + 'px"></span></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      document.getElementById('tab-hourly').innerHTML = html;
    }

    function renderCorrections(corr) {
      if (corr.total === 0) {
        document.getElementById('tab-corrections').innerHTML = '<p class="muted" style="padding:30px">No corrections yet. Use the /api/classification/:id/correct endpoint to submit corrections.</p>';
        return;
      }
      let html = '<p style="margin-bottom:10px">' + corr.total + ' total corrections (these reveal where the model is wrong)</p>';
      html += '<table><thead><tr><th>Model Predicted</th><th>User Corrected To</th><th>Count</th></tr></thead><tbody>';
      for (const m of corr.matrix) {
        html += '<tr><td>' + m.predicted + '</td><td><strong>' + m.actual + '</strong></td><td>' + m.count + '</td></tr>';
      }
      html += '</tbody></table>';
      document.getElementById('tab-corrections').innerHTML = html;
    }

    function renderRecent(classifications) {
      if (!classifications || classifications.length === 0) {
        document.getElementById('tab-recent').innerHTML = '<p class="muted" style="padding:30px">No recent events</p>';
        return;
      }
      let html = '<table><thead><tr><th>Time</th><th>Device</th><th>Class</th><th>Conf</th><th>Top Match</th><th>Edge</th><th>Model</th></tr></thead><tbody>';
      for (const c of classifications) {
        const clsColor = ['rodent','mouse','rat'].includes(c.classification) ? '#ff6b6b'
          : ['pet','cat','dog'].includes(c.classification) ? '#ffd93d'
          : c.classification === 'person' ? '#6bcb77' : '#888';
        const confColor = c.confidence >= 0.7 ? '#6bcb77' : c.confidence >= 0.4 ? '#ffd93d' : '#ff6b6b';
        const ago = timeAgo(c.classifiedAt);
        html += '<tr>';
        html += '<td class="mono">' + ago + '</td>';
        html += '<td>' + (c.deviceName || '-') + '</td>';
        html += '<td style="color:' + clsColor + ';font-weight:bold">' + c.classification.toUpperCase() + '</td>';
        html += '<td style="color:' + confColor + '" class="mono">' + c.confidencePercent + '</td>';
        html += '<td class="mono">' + (c.topMatch || '-') + '</td>';
        html += '<td class="mono muted">' + (c.edgeVerdict || '-') + '</td>';
        html += '<td class="mono muted">' + (c.modelVersion || '-') + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      document.getElementById('tab-recent').innerHTML = html;
    }

    function renderInsights(insights) {
      const el = document.getElementById('insights');
      if (!insights || insights.length === 0) {
        el.innerHTML = '<div class="insight good">Pipeline looks healthy — no issues detected.</div>';
        return;
      }
      el.innerHTML = insights.map(i => '<div class="insight">' + i + '</div>').join('');
    }

    function timeAgo(dateStr) {
      const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
      if (seconds < 60) return seconds + 's ago';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + 'm ago';
      const hours = Math.floor(minutes / 60);
      return hours + 'h ' + (minutes % 60) + 'm ago';
    }

    load();
    setInterval(load, 30000);
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * DELETE /api/classification/bulk/false-positives
 * Delete all non-rodent classifications (false positives cleanup)
 *
 * Query params:
 *   - before: ISO date string - delete records before this date
 *   - deviceId: optional - only delete for specific device
 */
router.delete('/bulk/false-positives', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const before = req.query.before as string | undefined;
    const deviceId = req.query.deviceId as string | undefined;

    let query = `
      DELETE FROM image_classifications
      WHERE tenant_id = $1
        AND classification != 'rodent'
    `;
    const params: any[] = [tenantId];
    let paramIdx = 2;

    if (before) {
      query += ` AND classified_at < $${paramIdx}`;
      params.push(before);
      paramIdx++;
    }

    if (deviceId) {
      query += ` AND device_id = $${paramIdx}`;
      params.push(deviceId);
      paramIdx++;
    }

    query += ' RETURNING id';

    const result = await dbPool.query(query, params);

    logger.info('Bulk deleted false positive classifications', {
      tenantId,
      count: result.rowCount,
      before,
      deviceId,
    });

    res.json({
      success: true,
      deleted: result.rowCount,
      message: `Deleted ${result.rowCount} non-rodent classification(s)`,
    });
  } catch (error: any) {
    logger.error('Failed to bulk delete classifications', { error: error.message });
    res.status(500).json({ error: 'Failed to delete classifications' });
  }
});

/**
 * DELETE /api/classification/bulk/all
 * Delete all classifications for tenant (admin only - for cleanup)
 *
 * Query params:
 *   - before: ISO date string - only delete records before this date
 *   - deviceId: optional - only delete for specific device
 */
router.delete(
  '/bulk/all',
  requireRole('admin', 'superadmin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = req.user!.tenantId;
      const before = req.query.before as string | undefined;
      const deviceId = req.query.deviceId as string | undefined;

      if (!before && !deviceId) {
        return res.status(400).json({
          error: 'Safety check: must specify either "before" date or "deviceId" parameter',
        });
      }

      let query = `DELETE FROM image_classifications WHERE tenant_id = $1`;
      const params: any[] = [tenantId];
      let paramIdx = 2;

      if (before) {
        query += ` AND classified_at < $${paramIdx}`;
        params.push(before);
        paramIdx++;
      }

      if (deviceId) {
        query += ` AND device_id = $${paramIdx}`;
        params.push(deviceId);
        paramIdx++;
      }

      query += ' RETURNING id';

      const result = await dbPool.query(query, params);

      logger.info('Bulk deleted all classifications', {
        tenantId,
        count: result.rowCount,
        before,
        deviceId,
      });

      res.json({
        success: true,
        deleted: result.rowCount,
        message: `Deleted ${result.rowCount} classification(s)`,
      });
    } catch (error: any) {
      logger.error('Failed to bulk delete all classifications', { error: error.message });
      res.status(500).json({ error: 'Failed to delete classifications' });
    }
  }
);

/**
 * DELETE /api/classification/:id
 * Delete a single classification record
 * NOTE: This must come AFTER /bulk/* routes to avoid matching "bulk" as an ID
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;

    // Delete only if belongs to user's tenant
    const result = await dbPool.query(
      `DELETE FROM image_classifications WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Classification not found' });
    }

    logger.info('Classification deleted', { classificationId: id, tenantId });
    res.json({ success: true, deleted: id });
  } catch (error: any) {
    logger.error('Failed to delete classification', { error: error.message });
    res.status(500).json({ error: 'Failed to delete classification' });
  }
});

/**
 * GET /api/classification/ml-performance
 * Comprehensive ML pipeline performance metrics.
 * Shows per-device scout pre-filter stats and server YOLO classification stats.
 *
 * Query params:
 *   - hours: time window (default 24)
 */
router.get('/ml-performance', async (req: AuthRequest, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const interval = `${hours} hours`;

    // ── Per-device metrics ──────────────────────────────────────────────
    const perDevice = await dbPool.query(`
      SELECT
        d.id                                          AS device_id,
        d.name                                        AS device_name,
        d.mac_address,
        d.device_type,
        COUNT(*)                                      AS total_classifications,
        -- Server classification breakdown
        COUNT(*) FILTER (WHERE ic.classification IN ('rodent','mouse','rat'))  AS rodent_count,
        COUNT(*) FILTER (WHERE ic.classification IN ('pet','cat','dog'))       AS pet_count,
        COUNT(*) FILTER (WHERE ic.classification = 'person')                  AS person_count,
        COUNT(*) FILTER (WHERE ic.classification = 'bird')                    AS bird_count,
        COUNT(*) FILTER (WHERE ic.classification IN ('other','empty'))        AS other_count,
        -- Confidence stats
        ROUND(AVG(ic.confidence)::numeric, 3)                                 AS avg_confidence,
        ROUND(MIN(ic.confidence)::numeric, 3)                                 AS min_confidence,
        ROUND(MAX(ic.confidence)::numeric, 3)                                 AS max_confidence,
        -- Low-confidence count (uncertain classifications worth reviewing)
        COUNT(*) FILTER (WHERE ic.confidence < 0.4)                           AS low_confidence_count,
        -- Edge pre-filter stats (what the scout decided before sending)
        COUNT(*) FILTER (WHERE ic.edge_verdict IS NOT NULL)                   AS edge_total,
        COUNT(*) FILTER (WHERE ic.edge_verdict = 'worth_sending')             AS edge_worth_sending,
        COUNT(*) FILTER (WHERE ic.edge_verdict = 'ambiguous')                 AS edge_ambiguous,
        COUNT(*) FILTER (WHERE ic.edge_verdict = 'unknown')                   AS edge_unknown,
        ROUND(AVG(ic.edge_confidence)::numeric, 3)                            AS edge_avg_confidence,
        -- Model versions seen
        ARRAY_AGG(DISTINCT ic.model_version) FILTER (WHERE ic.model_version IS NOT NULL) AS model_versions,
        -- Timing
        ROUND(AVG(ic.inference_time_ms)::numeric, 0)  AS avg_inference_ms,
        MIN(ic.classified_at)                          AS first_event,
        MAX(ic.classified_at)                          AS last_event,
        -- User corrections
        COUNT(*) FILTER (WHERE ic.user_corrected_class IS NOT NULL)           AS corrections_count,
        -- Detections with bboxes
        COUNT(*) FILTER (WHERE ic.detections IS NOT NULL AND ic.detections != 'null'::jsonb) AS has_detections,
        -- Storage
        COALESCE(SUM(ic.image_size_bytes), 0)          AS total_image_bytes
      FROM image_classifications ic
      JOIN devices d ON ic.device_id = d.id
      WHERE ic.classified_at > NOW() - INTERVAL '${interval}'
      GROUP BY d.id, d.name, d.mac_address, d.device_type
      ORDER BY total_classifications DESC
    `);

    // ── Hourly rate (for trending) ──────────────────────────────────────
    const hourlyRate = await dbPool.query(`
      SELECT
        d.id AS device_id,
        d.name AS device_name,
        DATE_TRUNC('hour', ic.classified_at) AS hour,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE ic.classification IN ('rodent','mouse','rat')) AS rodent_count
      FROM image_classifications ic
      JOIN devices d ON ic.device_id = d.id
      WHERE ic.classified_at > NOW() - INTERVAL '${interval}'
      GROUP BY d.id, d.name, DATE_TRUNC('hour', ic.classified_at)
      ORDER BY hour DESC
    `);

    // ── System-wide summary ─────────────────────────────────────────────
    const systemWide = await dbPool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT ic.device_id) AS active_devices,
        COUNT(*) FILTER (WHERE ic.classification IN ('rodent','mouse','rat'))  AS total_rodent,
        COUNT(*) FILTER (WHERE ic.classification IN ('pet','cat','dog'))       AS total_pet,
        COUNT(*) FILTER (WHERE ic.classification = 'person')                  AS total_person,
        COUNT(*) FILTER (WHERE ic.classification = 'bird')                    AS total_bird,
        COUNT(*) FILTER (WHERE ic.classification IN ('other','empty'))        AS total_other,
        ROUND(AVG(ic.confidence)::numeric, 3) AS avg_confidence,
        ROUND(AVG(ic.inference_time_ms)::numeric, 0) AS avg_inference_ms,
        COUNT(*) FILTER (WHERE ic.user_corrected_class IS NOT NULL) AS total_corrections,
        COUNT(*) FILTER (WHERE ic.confidence < 0.4) AS total_low_confidence,
        COALESCE(SUM(ic.image_size_bytes), 0) AS total_storage_bytes,
        ARRAY_AGG(DISTINCT ic.model_version) FILTER (WHERE ic.model_version IS NOT NULL) AS model_versions
      FROM image_classifications ic
      WHERE ic.classified_at > NOW() - INTERVAL '${interval}'
    `);

    // ── Confusion: corrections reveal misclassifications ────────────────
    const confusionMatrix = await dbPool.query(`
      SELECT
        ic.classification AS predicted,
        ic.user_corrected_class AS actual,
        COUNT(*) AS count
      FROM image_classifications ic
      WHERE ic.user_corrected_class IS NOT NULL
        AND ic.classified_at > NOW() - INTERVAL '${interval}'
      GROUP BY ic.classification, ic.user_corrected_class
      ORDER BY count DESC
    `);

    // ── Useful signal rate per device (for tuning insight) ──────────────
    // "useful" = rodent, pet, person, bird (anything that's not noise)
    const devices = perDevice.rows.map((d: any) => {
      const total = parseInt(d.total_classifications);
      const useful = parseInt(d.rodent_count) + parseInt(d.pet_count) +
                     parseInt(d.person_count) + parseInt(d.bird_count);
      const junk = parseInt(d.other_count);
      const usefulRate = total > 0 ? useful / total : 0;
      const imagesPerHour = total > 0 && d.first_event && d.last_event
        ? total / Math.max(1, (new Date(d.last_event).getTime() - new Date(d.first_event).getTime()) / 3600000)
        : 0;

      return {
        deviceId: d.device_id,
        deviceName: d.device_name,
        macAddress: d.mac_address,
        deviceType: d.device_type,
        // Server classification results
        server: {
          totalClassified: total,
          imagesPerHour: Math.round(imagesPerHour * 10) / 10,
          breakdown: {
            rodent: parseInt(d.rodent_count),
            pet: parseInt(d.pet_count),
            person: parseInt(d.person_count),
            bird: parseInt(d.bird_count),
            other: parseInt(d.other_count),
          },
          confidence: {
            avg: parseFloat(d.avg_confidence),
            min: parseFloat(d.min_confidence),
            max: parseFloat(d.max_confidence),
            lowCount: parseInt(d.low_confidence_count),
          },
          avgInferenceMs: parseInt(d.avg_inference_ms) || null,
          modelVersions: d.model_versions || [],
          hasDetections: parseInt(d.has_detections),
          corrections: parseInt(d.corrections_count),
        },
        // Scout edge pre-filter (what scout decided before sending)
        edge: {
          totalInferences: parseInt(d.edge_total),
          worthSending: parseInt(d.edge_worth_sending),
          ambiguous: parseInt(d.edge_ambiguous),
          unknown: parseInt(d.edge_unknown),
          avgConfidence: parseFloat(d.edge_avg_confidence) || null,
          // Note: false_trigger events never reach the server, so we can't count them here.
          // The "dropped" count is invisible to the server — only the scout knows.
          note: 'false_trigger frames are dropped by scout and never reach server',
        },
        // Signal quality
        signalQuality: {
          usefulRate: Math.round(usefulRate * 100),
          junkRate: Math.round((1 - usefulRate) * 100),
          useful,
          junk,
          assessment: usefulRate >= 0.5 ? 'good' : usefulRate >= 0.2 ? 'noisy' : 'very_noisy',
        },
        // Storage
        storageMB: Math.round(parseInt(d.total_image_bytes) / 1024 / 1024 * 10) / 10,
        firstEvent: d.first_event,
        lastEvent: d.last_event,
      };
    });

    const sys = systemWide.rows[0] || {};
    const totalCount = parseInt(sys.total) || 0;

    res.json({
      success: true,
      timeWindow: `${hours}h`,
      generatedAt: new Date().toISOString(),

      // System-wide summary
      system: {
        totalClassifications: totalCount,
        activeDevices: parseInt(sys.active_devices) || 0,
        breakdown: {
          rodent: parseInt(sys.total_rodent) || 0,
          pet: parseInt(sys.total_pet) || 0,
          person: parseInt(sys.total_person) || 0,
          bird: parseInt(sys.total_bird) || 0,
          other: parseInt(sys.total_other) || 0,
        },
        avgConfidence: parseFloat(sys.avg_confidence) || 0,
        avgInferenceMs: parseInt(sys.avg_inference_ms) || 0,
        totalCorrections: parseInt(sys.total_corrections) || 0,
        totalLowConfidence: parseInt(sys.total_low_confidence) || 0,
        storageMB: Math.round((parseInt(sys.total_storage_bytes) || 0) / 1024 / 1024 * 10) / 10,
        modelVersions: sys.model_versions || [],
      },

      // Per-device breakdown
      devices,

      // Hourly send rates (for graphing)
      hourlyRates: hourlyRate.rows.map((r: any) => ({
        deviceId: r.device_id,
        deviceName: r.device_name,
        hour: r.hour,
        count: parseInt(r.count),
        rodentCount: parseInt(r.rodent_count),
      })),

      // Confusion matrix from user corrections (model errors)
      corrections: {
        total: parseInt(sys.total_corrections) || 0,
        matrix: confusionMatrix.rows.map((r: any) => ({
          predicted: r.predicted,
          actual: r.actual,
          count: parseInt(r.count),
        })),
      },

      // Actionable insights
      insights: generateInsights(devices, totalCount),
    });
  } catch (error: any) {
    logger.error('Failed to get ML performance metrics', { error: error.message });
    res.status(500).json({ error: 'Failed to get ML performance metrics' });
  }
});

function generateInsights(devices: any[], totalCount: number): string[] {
  const insights: string[] = [];

  if (totalCount === 0) {
    insights.push('No classifications in this time window.');
    return insights;
  }

  for (const d of devices) {
    const name = d.deviceName || d.macAddress;

    // High junk rate
    if (d.signalQuality.junkRate > 80 && d.server.totalClassified > 10) {
      insights.push(
        `${name}: ${d.signalQuality.junkRate}% junk — pre-filter threshold should be raised`
      );
    }

    // High send rate
    if (d.server.imagesPerHour > 10) {
      insights.push(
        `${name}: sending ${d.server.imagesPerHour} images/hour — consider motion sensitivity tuning`
      );
    }

    // Many low-confidence results
    if (d.server.confidence.lowCount > 5) {
      insights.push(
        `${name}: ${d.server.confidence.lowCount} low-confidence (<40%) classifications — model may need retraining on this environment`
      );
    }

    // No edge pre-filter running
    if (d.server.totalClassified > 10 && d.edge.totalInferences === 0) {
      insights.push(
        `${name}: no edge pre-filter data — binary model not deployed on this scout`
      );
    }

    // Corrections suggest systematic errors
    if (d.server.corrections > 3) {
      insights.push(
        `${name}: ${d.server.corrections} user corrections — review confusion matrix for systematic misclassifications`
      );
    }
  }

  return insights;
}

export default router;
