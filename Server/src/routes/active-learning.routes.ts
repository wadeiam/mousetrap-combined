/**
 * Active-Learning Routes (Layer 2)
 *
 * Inspect and drive the auto-labeling loop. Register in server.ts alongside the
 * classification routes:
 *   const activeLearningRoutes = require('./routes/active-learning.routes');
 *   app.use('/api/active-learning', activeLearningRoutes.default || activeLearningRoutes);
 */

import { Router, Response } from 'express';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.middleware';
import { getActiveLearningService } from '../services/active-learning.service';
import { logger } from '../services/logger.service';

const router = Router();

router.use((req: AuthRequest, res: Response, next) => authenticate(req as any, res, next));

/** GET /api/active-learning/stats — dataset readiness for the current tenant. */
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const service = getActiveLearningService();
    if (!service) return res.status(503).json({ error: 'active-learning service not ready' });
    const isSuper = req.user!.role === 'superadmin';
    const stats = await service.getStats(isSuper ? undefined : req.user!.tenantId);
    return res.json({ success: true, stats });
  } catch (err: any) {
    logger.error('[ACTIVE-LEARNING] stats failed', { error: err?.message });
    return res.status(500).json({ error: err?.message });
  }
});

/** GET /api/active-learning/review-queue?limit=50 — uncertain frames to label. */
router.get('/review-queue', async (req: AuthRequest, res: Response) => {
  try {
    const service = getActiveLearningService();
    if (!service) return res.status(503).json({ error: 'active-learning service not ready' });
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const items = await service.getReviewQueue(req.user!.tenantId, limit);
    return res.json({ success: true, count: items.length, items });
  } catch (err: any) {
    logger.error('[ACTIVE-LEARNING] review-queue failed', { error: err?.message });
    return res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/active-learning/run-pass — run an auto-labeling pass (admin+).
 * Body: { acceptThreshold?, rejectThreshold? }. Superadmin runs across all
 * tenants; admins are scoped to their own tenant.
 */
router.post('/run-pass', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const service = getActiveLearningService();
    if (!service) return res.status(503).json({ error: 'active-learning service not ready' });
    const isSuper = req.user!.role === 'superadmin';
    const result = await service.runAutoLabelPass({
      tenantId: isSuper ? undefined : req.user!.tenantId,
      acceptThreshold: req.body?.acceptThreshold,
      rejectThreshold: req.body?.rejectThreshold,
    });
    return res.json({ success: true, result });
  } catch (err: any) {
    logger.error('[ACTIVE-LEARNING] run-pass failed', { error: err?.message });
    return res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/active-learning/batch — tag currently-labeled rows into a training
 * batch (admin+). Body: { batchId }. Called by the export step.
 */
router.post('/batch', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const service = getActiveLearningService();
    if (!service) return res.status(503).json({ error: 'active-learning service not ready' });
    const batchId = String(req.body?.batchId ?? '').trim();
    if (!batchId) return res.status(400).json({ error: 'batchId required' });
    const isSuper = req.user!.role === 'superadmin';
    const tagged = await service.markTrainingBatch(batchId, isSuper ? undefined : req.user!.tenantId);
    return res.json({ success: true, batchId, tagged });
  } catch (err: any) {
    logger.error('[ACTIVE-LEARNING] batch failed', { error: err?.message });
    return res.status(500).json({ error: err?.message });
  }
});

export default router;
