import { Router, Response } from 'express';
import { logger, LogLevel } from '../services/logger.service';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all logs routes
router.use(authenticate);

/**
 * GET /api/logs
 * Retrieve logs with optional filtering
 *
 * Query parameters:
 * - level: Filter by log level (debug, info, warn, error) - can be comma-separated
 * - search: Search in message and context
 * - since: ISO timestamp - only logs after this time
 * - limit: Max number of logs to return (default 100, max 1000)
 * - offset: Pagination offset (default 0)
 *
 * Superadmin only - logs contain system-wide information
 */
router.get('/', requireRole('superadmin'), (req: AuthRequest, res: Response) => {
  try {
    const {
      level,
      search,
      since,
      limit = '100',
      offset = '0',
    } = req.query;

    // Parse level filter
    let levelFilter: LogLevel | LogLevel[] | undefined;
    if (level) {
      const levels = (level as string).split(',').map(l => l.trim() as LogLevel);
      levelFilter = levels.length === 1 ? levels[0] : levels;
    }

    // Parse pagination
    const limitNum = Math.min(parseInt(limit as string, 10) || 100, 1000);
    const offsetNum = parseInt(offset as string, 10) || 0;

    // Parse since timestamp
    let sinceDate: Date | undefined;
    if (since) {
      sinceDate = new Date(since as string);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid since timestamp',
        });
      }
    }

    // Get filtered logs
    const result = logger.getLogs({
      level: levelFilter,
      search: search as string,
      since: sinceDate,
      limit: limitNum,
      offset: offsetNum,
    });

    // Log the access
    logger.debug('Logs accessed', {
      userId: req.user!.userId,
      filters: { level, search, since, limit, offset },
    });

    res.json({
      success: true,
      data: {
        logs: result.logs,
        total: result.total,
        offset: offsetNum,
        limit: limitNum,
      },
    });
  } catch (error: any) {
    logger.error('Error retrieving logs', {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve logs',
    });
  }
});

/**
 * GET /api/logs/stats
 * Get log statistics (superadmin only)
 */
router.get('/stats', requireRole('superadmin'), (req: AuthRequest, res: Response) => {
  try {
    const stats = logger.getStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    logger.error('Error retrieving log stats', {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve log statistics',
    });
  }
});

/**
 * DELETE /api/logs
 * Clear all logs (superadmin only)
 */
router.delete('/', requireRole('superadmin'), (req: AuthRequest, res: Response) => {
  try {
    logger.clear();
    logger.info('All logs cleared', {
      userId: req.user!.userId,
    });

    res.json({
      success: true,
      data: {
        message: 'Logs cleared successfully',
      },
    });
  } catch (error: any) {
    logger.error('Error clearing logs', {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to clear logs',
    });
  }
});

export default router;
