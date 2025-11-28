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

// GET /tenants - List all tenants the user has access to
// Superadmins (in Master Tenant) can see ALL tenants
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Check if user is a superadmin in the Master Tenant
    const superadminCheck = await dbPool.query(
      `SELECT 1 FROM user_tenant_memberships
       WHERE user_id = $1
         AND tenant_id = '00000000-0000-0000-0000-000000000001'
         AND role = 'superadmin'`,
      [userId]
    );
    const isSuperadmin = superadminCheck.rows.length > 0;

    let result;
    if (isSuperadmin) {
      // Superadmins see ALL active tenants (not soft-deleted) with superadmin role
      result = await dbPool.query(
        `SELECT t.id, t.name, t.created_at, t.updated_at,
                COALESCE(utm.role, 'superadmin') as role
         FROM tenants t
         LEFT JOIN user_tenant_memberships utm ON utm.tenant_id = t.id AND utm.user_id = $1
         WHERE t.deleted_at IS NULL
         ORDER BY t.name ASC`,
        [userId]
      );
    } else {
      // Regular users only see tenants they have explicit membership in (and not soft-deleted)
      result = await dbPool.query(
        `SELECT t.id, t.name, t.created_at, t.updated_at, utm.role
         FROM tenants t
         INNER JOIN user_tenant_memberships utm ON utm.tenant_id = t.id
         WHERE utm.user_id = $1 AND t.deleted_at IS NULL
         ORDER BY t.name ASC`,
        [userId]
      );
    }

    // Transform to camelCase for frontend
    const tenants = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      role: row.role,
    }));

    res.json({
      success: true,
      data: tenants,
    });
  } catch (error: any) {
    console.error('Get tenants error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /tenants/:id - Get a specific tenant by ID
// Superadmins have implicit access to all tenants
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    // Check if user is a superadmin in the Master Tenant
    const superadminCheck = await dbPool.query(
      `SELECT 1 FROM user_tenant_memberships
       WHERE user_id = $1
         AND tenant_id = '00000000-0000-0000-0000-000000000001'
         AND role = 'superadmin'`,
      [userId]
    );
    const isSuperadmin = superadminCheck.rows.length > 0;

    let result;
    if (isSuperadmin) {
      // Superadmins can access any active tenant
      result = await dbPool.query(
        `SELECT t.id, t.name, t.created_at, t.updated_at, 'superadmin' as role
         FROM tenants t
         WHERE t.id = $1 AND t.deleted_at IS NULL`,
        [id]
      );
    } else {
      // Regular users need explicit membership
      result = await dbPool.query(
        `SELECT t.id, t.name, t.created_at, t.updated_at, utm.role
         FROM tenants t
         INNER JOIN user_tenant_memberships utm ON utm.tenant_id = t.id
         WHERE t.id = $1 AND utm.user_id = $2 AND t.deleted_at IS NULL`,
        [id, userId]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found or access denied',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Get tenant error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /tenants - Create a new tenant (superadmin only)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Tenant name is required',
      });
    }

    // Check if user is superadmin
    const superadminCheck = await dbPool.query(
      `SELECT user_is_superadmin($1) as is_superadmin`,
      [userId]
    );

    if (!superadminCheck.rows[0].is_superadmin) {
      return res.status(403).json({
        success: false,
        error: 'Only superadmins can create tenants',
      });
    }

    // Create the tenant
    const result = await dbPool.query(
      `INSERT INTO tenants (name, created_at, updated_at)
       VALUES ($1, NOW(), NOW())
       RETURNING id, name, created_at, updated_at`,
      [name.trim()]
    );

    const newTenant = result.rows[0];

    // Add the creating user as admin of the new tenant
    await dbPool.query(
      `INSERT INTO user_tenant_memberships (user_id, tenant_id, role, created_at)
       VALUES ($1, $2, 'admin', NOW())`,
      [userId, newTenant.id]
    );

    // Transform to camelCase for frontend
    const tenantResponse = {
      id: newTenant.id,
      name: newTenant.name,
      createdAt: newTenant.created_at,
      updatedAt: newTenant.updated_at,
    };

    res.status(201).json({
      success: true,
      data: tenantResponse,
    });
  } catch (error: any) {
    console.error('Create tenant error:', error);

    // Handle duplicate tenant name
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A tenant with this name already exists',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PATCH /tenants/:id - Update a tenant (superadmin or tenant admin)
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Tenant name is required',
      });
    }

    // Check if user is superadmin or has admin role for this tenant
    const accessCheck = await dbPool.query(
      `SELECT
         user_is_superadmin($1) as is_superadmin,
         (SELECT role FROM user_tenant_memberships
          WHERE user_id = $1 AND tenant_id = $2) as tenant_role`,
      [userId, id]
    );

    const isSuperadmin = accessCheck.rows[0].is_superadmin;
    const tenantRole = accessCheck.rows[0].tenant_role;

    if (!isSuperadmin && tenantRole !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only superadmins or tenant admins can update tenants',
      });
    }

    // Update the tenant
    const result = await dbPool.query(
      `UPDATE tenants
       SET name = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, created_at, updated_at`,
      [name.trim(), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Update tenant error:', error);

    // Handle duplicate tenant name
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A tenant with this name already exists',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /tenants/:id/stats - Get tenant statistics
router.get('/:id/stats', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    // Check if user is a superadmin in the Master Tenant
    const superadminCheck = await dbPool.query(
      `SELECT 1 FROM user_tenant_memberships
       WHERE user_id = $1
         AND tenant_id = '00000000-0000-0000-0000-000000000001'
         AND role = 'superadmin'`,
      [userId]
    );
    const isSuperadmin = superadminCheck.rows.length > 0;

    // If not superadmin, verify user has access to this tenant via membership
    if (!isSuperadmin) {
      const accessCheck = await dbPool.query(
        `SELECT 1 FROM user_tenant_memberships
         WHERE user_id = $1 AND tenant_id = $2`,
        [userId, id]
      );

      if (accessCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this tenant',
        });
      }
    }

    // Get user count for this tenant
    const userCountResult = await dbPool.query(
      `SELECT COUNT(*) as count FROM user_tenant_memberships WHERE tenant_id = $1`,
      [id]
    );

    // Get device count for this tenant
    const deviceCountResult = await dbPool.query(
      `SELECT COUNT(*) as count FROM devices WHERE tenant_id = $1`,
      [id]
    );

    res.json({
      success: true,
      data: {
        userCount: parseInt(userCountResult.rows[0].count),
        deviceCount: parseInt(deviceCountResult.rows[0].count),
      },
    });
  } catch (error: any) {
    console.error('Get tenant stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// DELETE /tenants/:id - Soft-delete a tenant (superadmin only)
// Query params:
//   - force=true: Force delete tenant even with devices (soft-deletes devices too)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const forceDelete = req.query.force === 'true';

    // Prevent deletion of Master Tenant
    if (id === '00000000-0000-0000-0000-000000000001') {
      return res.status(403).json({
        success: false,
        error: 'Cannot delete the Master Tenant',
      });
    }

    // Check if user is superadmin
    const superadminCheck = await dbPool.query(
      `SELECT user_is_superadmin($1) as is_superadmin`,
      [userId]
    );

    if (!superadminCheck.rows[0].is_superadmin) {
      return res.status(403).json({
        success: false,
        error: 'Only superadmins can delete tenants',
      });
    }

    // Check if tenant exists and is not already deleted
    const tenantCheck = await dbPool.query(
      `SELECT id, name, deleted_at FROM tenants WHERE id = $1`,
      [id]
    );

    if (tenantCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found',
      });
    }

    if (tenantCheck.rows[0].deleted_at) {
      return res.status(409).json({
        success: false,
        error: 'Tenant is already deleted',
      });
    }

    // Check if tenant has any devices
    const deviceCheck = await dbPool.query(
      `SELECT COUNT(*) as device_count FROM devices WHERE tenant_id = $1 AND unclaimed_at IS NULL`,
      [id]
    );
    const deviceCount = parseInt(deviceCheck.rows[0].device_count);

    if (deviceCount > 0 && !forceDelete) {
      return res.status(409).json({
        success: false,
        error: `Cannot delete tenant with ${deviceCount} active device(s). Use force=true to soft-delete tenant and all associated devices.`,
        deviceCount,
        requiresForce: true,
      });
    }

    // If force delete, soft-delete all devices first
    if (deviceCount > 0 && forceDelete) {
      await dbPool.query(
        `UPDATE devices SET unclaimed_at = NOW() WHERE tenant_id = $1 AND unclaimed_at IS NULL`,
        [id]
      );
    }

    // Soft-delete the tenant
    const result = await dbPool.query(
      `UPDATE tenants SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, name, deleted_at`,
      [id]
    );

    // Get purge retention setting
    const retentionResult = await dbPool.query(
      `SELECT value FROM system_settings WHERE key = 'tenant_purge_retention_days'`
    );
    const retentionDays = retentionResult.rows.length > 0
      ? parseInt(JSON.parse(retentionResult.rows[0].value))
      : 90;

    const purgeDate = new Date(result.rows[0].deleted_at);
    purgeDate.setDate(purgeDate.getDate() + retentionDays);

    res.json({
      success: true,
      data: {
        message: `Tenant "${result.rows[0].name}" has been soft-deleted`,
        deletedTenant: result.rows[0],
        devicesDeleted: forceDelete ? deviceCount : 0,
        purgeDate: purgeDate.toISOString(),
        retentionDays,
      },
    });
  } catch (error: any) {
    console.error('Delete tenant error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
