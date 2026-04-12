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
  const openPaths = ['/debug', '/debug-test', '/live', '/stats'];
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
 * Simple HTML debug page for viewing classification activity
 */
router.get('/debug', async (req: AuthRequest, res: Response) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>ML Classification Monitor</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #00d4ff; margin-bottom: 20px; }
    .stats { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-card { background: #16213e; padding: 15px 25px; border-radius: 10px; min-width: 150px; }
    .stat-card h3 { color: #888; font-size: 12px; text-transform: uppercase; }
    .stat-card .value { font-size: 28px; font-weight: bold; color: #00d4ff; }
    .stat-card.rodent .value { color: #ff6b6b; }
    .controls { margin-bottom: 20px; display: flex; gap: 10px; align-items: center; }
    button { background: #00d4ff; color: #000; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-weight: bold; }
    button:hover { background: #00a8cc; }
    button.danger { background: #ff6b6b; }
    button.danger:hover { background: #ee5a5a; }
    select, input { background: #16213e; color: #eee; border: 1px solid #333; padding: 10px; border-radius: 5px; }
    table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 10px; overflow: hidden; }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #333; }
    th { background: #0f3460; color: #00d4ff; font-weight: 600; }
    tr:hover { background: #1f4068; }
    .class-rodent { color: #ff6b6b; font-weight: bold; }
    .class-other { color: #888; }
    .class-pet { color: #ffd93d; }
    .class-person { color: #6bcb77; }
    .confidence-high { color: #6bcb77; }
    .confidence-med { color: #ffd93d; }
    .confidence-low { color: #ff6b6b; }
    .refresh-indicator { color: #666; font-size: 12px; }
    .time-ago { color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <h1>🔬 ML Classification Monitor</h1>

  <div class="stats" id="stats">
    <div class="stat-card"><h3>Total Events</h3><div class="value" id="stat-total">-</div></div>
    <div class="stat-card rodent"><h3>Rodents</h3><div class="value" id="stat-rodent">-</div></div>
    <div class="stat-card"><h3>Avg Confidence</h3><div class="value" id="stat-confidence">-</div></div>
    <div class="stat-card"><h3>Time Range</h3><div class="value" id="stat-range">-</div></div>
  </div>

  <div class="controls">
    <label>Time Range: </label>
    <select id="minutes" onchange="refresh()">
      <option value="5">Last 5 min</option>
      <option value="15">Last 15 min</option>
      <option value="30">Last 30 min</option>
      <option value="60" selected>Last 1 hour</option>
      <option value="180">Last 3 hours</option>
      <option value="720">Last 12 hours</option>
      <option value="1440">Last 24 hours</option>
    </select>
    <button onclick="refresh()">🔄 Refresh</button>
    <button class="danger" onclick="deleteFalsePositives()">🗑️ Delete Non-Rodents</button>
    <span class="refresh-indicator" id="lastRefresh">Auto-refresh: 10s</span>
  </div>

  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Device</th>
        <th>Classification</th>
        <th>Confidence</th>
        <th>Top Match</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody id="tableBody">
      <tr><td colspan="6" style="text-align:center; padding:40px;">Loading...</td></tr>
    </tbody>
  </table>

  <script>
    let autoRefreshInterval;

    function getClassColor(cls) {
      if (['rodent', 'mouse', 'rat'].includes(cls)) return 'class-rodent';
      if (['pet', 'cat', 'dog'].includes(cls)) return 'class-pet';
      if (['person', 'human'].includes(cls)) return 'class-person';
      return 'class-other';
    }

    function getConfidenceColor(conf) {
      if (conf >= 0.7) return 'confidence-high';
      if (conf >= 0.4) return 'confidence-med';
      return 'confidence-low';
    }

    function timeAgo(dateStr) {
      const now = new Date();
      const date = new Date(dateStr);
      const seconds = Math.floor((now - date) / 1000);
      if (seconds < 60) return seconds + 's ago';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + 'm ago';
      const hours = Math.floor(minutes / 60);
      return hours + 'h ' + (minutes % 60) + 'm ago';
    }

    async function refresh() {
      const minutes = document.getElementById('minutes').value;
      try {
        const res = await fetch('/api/classification/live?minutes=' + minutes + '&limit=100');
        const data = await res.json();

        if (data.success) {
          document.getElementById('stat-total').textContent = data.stats.total;
          document.getElementById('stat-rodent').textContent = data.stats.rodentCount;
          document.getElementById('stat-confidence').textContent = (data.stats.avgConfidence * 100).toFixed(0) + '%';
          document.getElementById('stat-range').textContent = data.timeRange;

          const tbody = document.getElementById('tableBody');
          if (data.classifications.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:#666;">No classifications in this time range</td></tr>';
          } else {
            tbody.innerHTML = data.classifications.map(c => \`
              <tr>
                <td><span class="time-ago">\${timeAgo(c.classifiedAt)}</span><br><small>\${new Date(c.classifiedAt).toLocaleTimeString()}</small></td>
                <td>\${c.deviceName}<br><small style="color:#666">\${c.macAddress}</small></td>
                <td class="\${getClassColor(c.classification)}">\${c.classification.toUpperCase()}</td>
                <td class="\${getConfidenceColor(c.confidence)}">\${c.confidencePercent}</td>
                <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis">\${c.topMatch || '-'}</td>
                <td><button onclick="deleteOne('\${c.id}')" style="padding:5px 10px; font-size:12px;">Delete</button></td>
              </tr>
            \`).join('');
          }

          document.getElementById('lastRefresh').textContent = 'Updated: ' + new Date().toLocaleTimeString();
        }
      } catch (err) {
        console.error('Refresh failed:', err);
        document.getElementById('tableBody').innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:#ff6b6b;">Fetch error: ' + err.message + '</td></tr>';
      }
    }

    async function deleteOne(id) {
      if (!confirm('Delete this classification?')) return;
      try {
        await fetch('/api/classification/' + id, { method: 'DELETE' });
        refresh();
      } catch (err) {
        alert('Delete failed');
      }
    }

    async function deleteFalsePositives() {
      if (!confirm('Delete ALL non-rodent classifications? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/classification/bulk/false-positives', { method: 'DELETE' });
        const data = await res.json();
        alert('Deleted ' + data.deleted + ' classification(s)');
        refresh();
      } catch (err) {
        alert('Delete failed');
      }
    }

    // Initial load and auto-refresh
    refresh();
    autoRefreshInterval = setInterval(refresh, 10000);
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

export default router;
