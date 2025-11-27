import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    tenantId: string;
    role: string;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
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

    const decoded = jwt.verify(token, jwtSecret) as any;

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      tenantId: decoded.tenantId,
      role: decoded.role,
    };

    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

export const requireRole = (...roles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    try {
      // Get database pool from app locals
      const dbPool: Pool = (req.app as any).locals.dbPool;

      if (!dbPool) {
        console.error('Database pool not available in requireRole middleware');
        return res.status(500).json({
          success: false,
          error: 'Internal server error',
        });
      }

      // Check if user has any of the required roles in any tenant
      const result = await dbPool.query(
        `SELECT role FROM user_tenant_memberships
         WHERE user_id = $1 AND role = ANY($2::user_role[])
         LIMIT 1`,
        [req.user.userId, roles]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden - insufficient permissions',
        });
      }

      next();
    } catch (error: any) {
      console.error('Error in requireRole middleware:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  };
};
