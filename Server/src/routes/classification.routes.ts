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

// All routes require authentication
router.use(authenticate);

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
 * GET /api/classification/stats
 * Get classification statistics for the tenant
 */
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const service = getClassificationService();

    if (!service) {
      return res.status(503).json({ error: 'Classification service not available' });
    }

    const tenantId = req.user!.tenantId;
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

export default router;
