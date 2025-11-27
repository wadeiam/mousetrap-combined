import { Router, Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.middleware';

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

// GET /users/me/tenants - Get current user's tenant memberships
router.get('/me/tenants', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Get user's tenant memberships
    const result = await dbPool.query(
      `SELECT t.id as tenant_id, t.name as tenant_name, utm.role,
              utm.created_at as joined_at
       FROM user_tenant_memberships utm
       INNER JOIN tenants t ON utm.tenant_id = t.id
       WHERE utm.user_id = $1
       ORDER BY t.name ASC`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Get user tenants error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /users - List all users in a tenant (admin only)
router.get('/', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const tenantId = req.query.tenantId as string;
    const userId = req.user!.userId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId query parameter is required',
      });
    }

    // Verify user has admin or superadmin role in this tenant
    const accessCheck = await dbPool.query(
      `SELECT role FROM user_tenant_memberships
       WHERE user_id = $1 AND tenant_id = $2 AND role IN ('admin', 'superadmin')`,
      [userId, tenantId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'You do not have admin access to this tenant',
      });
    }

    // Count total users in tenant (via memberships)
    const countResult = await dbPool.query(
      `SELECT COUNT(DISTINCT user_id) as count
       FROM user_tenant_memberships
       WHERE tenant_id = $1`,
      [tenantId]
    );
    const total = parseInt(countResult.rows[0].count);

    // Get users in tenant with their role
    const result = await dbPool.query(
      `SELECT
        u.id, u.email, u.totp_enabled, u.is_active,
        utm.role, utm.created_at as joined_at,
        u.created_at, u.updated_at
      FROM users u
      INNER JOIN user_tenant_memberships utm ON u.id = utm.user_id
      WHERE utm.tenant_id = $1
      ORDER BY utm.created_at DESC
      LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset]
    );

    res.json({
      success: true,
      data: {
        items: result.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /users - Create a new user and add to tenant (admin only)
router.post('/', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, role, tenantId } = req.body;
    const userId = req.user!.userId;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required',
      });
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required',
      });
    }

    // Verify user has admin or superadmin role in this tenant
    const accessCheck = await dbPool.query(
      `SELECT role FROM user_tenant_memberships
       WHERE user_id = $1 AND tenant_id = $2 AND role IN ('admin', 'superadmin')`,
      [userId, tenantId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'You do not have admin access to this tenant',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Check if user already exists
    const existingUser = await dbPool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    let newUserId: string;

    if (existingUser.rows.length > 0) {
      // User exists - add them to the tenant
      newUserId = existingUser.rows[0].id;

      // Check if user is already in this tenant
      const membershipCheck = await dbPool.query(
        'SELECT 1 FROM user_tenant_memberships WHERE user_id = $1 AND tenant_id = $2',
        [newUserId, tenantId]
      );

      if (membershipCheck.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'User already exists in this tenant',
        });
      }

      // Add user to tenant
      await dbPool.query(
        `INSERT INTO user_tenant_memberships (user_id, tenant_id, role)
         VALUES ($1, $2, $3)`,
        [newUserId, tenantId, role || 'viewer']
      );
    } else {
      // Create new user and add to tenant
      const userResult = await dbPool.query(
        `INSERT INTO users (email, password_hash, tenant_id, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [email, passwordHash, tenantId, role || 'viewer']
      );

      newUserId = userResult.rows[0].id;

      // Add user to tenant
      await dbPool.query(
        `INSERT INTO user_tenant_memberships (user_id, tenant_id, role)
         VALUES ($1, $2, $3)`,
        [newUserId, tenantId, role || 'viewer']
      );
    }

    // Get user data with tenant membership
    const result = await dbPool.query(
      `SELECT u.id, u.email, u.totp_enabled, u.is_active,
              utm.role, utm.created_at as joined_at,
              u.created_at, u.updated_at
       FROM users u
       INNER JOIN user_tenant_memberships utm ON u.id = utm.user_id
       WHERE u.id = $1 AND utm.tenant_id = $2`,
      [newUserId, tenantId]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Create user error:', error);

    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PATCH /users/:id - Update a user's role or status in a tenant (admin only)
router.patch('/:id', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { role, is_active, tenantId } = req.body;
    const currentUserId = req.user!.userId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required',
      });
    }

    // Verify user has admin or superadmin role in this tenant
    const accessCheck = await dbPool.query(
      `SELECT role FROM user_tenant_memberships
       WHERE user_id = $1 AND tenant_id = $2 AND role IN ('admin', 'superadmin')`,
      [currentUserId, tenantId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'You do not have admin access to this tenant',
      });
    }

    // Verify target user exists in this tenant
    const userCheck = await dbPool.query(
      `SELECT 1 FROM user_tenant_memberships WHERE user_id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found in this tenant',
      });
    }

    // Update role in tenant membership if provided
    if (role !== undefined) {
      await dbPool.query(
        `UPDATE user_tenant_memberships
         SET role = $1, updated_at = NOW()
         WHERE user_id = $2 AND tenant_id = $3`,
        [role, id, tenantId]
      );
    }

    // Update user account status if provided
    if (is_active !== undefined) {
      await dbPool.query(
        `UPDATE users
         SET is_active = $1
         WHERE id = $2`,
        [is_active, id]
      );
    }

    // Get updated user data
    const result = await dbPool.query(
      `SELECT u.id, u.email, u.totp_enabled, u.is_active,
              utm.role, utm.created_at as joined_at,
              u.created_at, u.updated_at
       FROM users u
       INNER JOIN user_tenant_memberships utm ON u.id = utm.user_id
       WHERE u.id = $1 AND utm.tenant_id = $2`,
      [id, tenantId]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// DELETE /users/:id - Remove a user from a tenant (admin only)
router.delete('/:id', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.query.tenantId as string;
    const currentUserId = req.user!.userId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId query parameter is required',
      });
    }

    // Prevent self-deletion
    if (id === currentUserId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove your own account from a tenant',
      });
    }

    // Verify user has admin or superadmin role in this tenant
    const accessCheck = await dbPool.query(
      `SELECT role FROM user_tenant_memberships
       WHERE user_id = $1 AND tenant_id = $2 AND role IN ('admin', 'superadmin')`,
      [currentUserId, tenantId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'You do not have admin access to this tenant',
      });
    }

    // Remove user from tenant
    const result = await dbPool.query(
      'DELETE FROM user_tenant_memberships WHERE user_id = $1 AND tenant_id = $2 RETURNING user_id',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found in this tenant',
      });
    }

    res.json({
      success: true,
      message: 'User removed from tenant successfully',
    });
  } catch (error: any) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
