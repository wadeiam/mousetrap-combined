import { Router, Request, Response } from 'express';
import { logger, LogLevel } from '../services/logger.service';
import jwt from 'jsonwebtoken';

const router = Router();

/**
 * Authentication middleware for logs routes
 * Only admins and master users can access logs
 */
const requireAdminAuth = (req: Request, res: Response, next: Function) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
      });
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    const decoded: any = jwt.verify(token, jwtSecret);

    // Only allow admin and master roles
    if (decoded.role !== 'admin' && decoded.role !== 'master') {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      });
    }

    // Attach user info to request
    (req as any).user = decoded;
    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Authentication error',
    });
  }
};

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
 */
router.get('/', requireAdminAuth, (req: Request, res: Response) => {
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
      userId: (req as any).user.userId,
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
 * Get log statistics
 */
router.get('/stats', requireAdminAuth, (req: Request, res: Response) => {
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
 * Clear all logs (master only)
 */
router.delete('/', requireAdminAuth, (req: Request, res: Response) => {
  try {
    // Only master users can clear logs
    if ((req as any).user.role !== 'master') {
      return res.status(403).json({
        success: false,
        error: 'Only master users can clear logs',
      });
    }

    logger.clear();
    logger.info('All logs cleared', {
      userId: (req as any).user.userId,
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
