import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Pool } from 'pg';
import { logger } from '../services/logger.service';

const router = Router();

// Get database pool from parent app
let dbPool: Pool;
router.use((req: Request, _res: Response, next) => {
  if (!dbPool && (req.app as any).locals.dbPool) {
    dbPool = (req.app as any).locals.dbPool;
  }
  next();
});

// Registration endpoint (for self-service user onboarding)
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, tenantName } = req.body;

    // Validation
    if (!email || !password || !tenantName) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and tenant name are required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
      });
    }

    // Validate password strength (minimum 8 characters)
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters long',
      });
    }

    // Check if user already exists
    const existingUser = await dbPool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Start transaction
    await dbPool.query('BEGIN');

    try {
      // Create tenant
      const tenantResult = await dbPool.query(
        `INSERT INTO tenants (name, created_at, updated_at)
         VALUES ($1, NOW(), NOW())
         RETURNING id, name, created_at`,
        [tenantName.trim()]
      );

      const tenant = tenantResult.rows[0];
      logger.info('New tenant created during registration', { tenantId: tenant.id, tenantName: tenant.name });

      // Create user
      const userResult = await dbPool.query(
        `INSERT INTO users (email, password_hash, is_active, created_at, updated_at)
         VALUES ($1, $2, true, NOW(), NOW())
         RETURNING id, email, created_at`,
        [email, passwordHash]
      );

      const user = userResult.rows[0];
      logger.info('New user created during registration', { userId: user.id, email: user.email });

      // Associate user with tenant as admin
      await dbPool.query(
        `INSERT INTO user_tenant_memberships (user_id, tenant_id, role, created_at)
         VALUES ($1, $2, 'admin', NOW())`,
        [user.id, tenant.id]
      );

      logger.info('User associated with tenant', { userId: user.id, tenantId: tenant.id, role: 'admin' });

      // Commit transaction
      await dbPool.query('COMMIT');

      // Generate JWT tokens
      const jwtSecret = process.env.JWT_SECRET || 'default-secret';
      const accessToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          tenantId: tenant.id,
          role: 'admin',
        },
        jwtSecret,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
      );

      const refreshToken = jwt.sign(
        {
          userId: user.id,
          type: 'refresh',
        },
        jwtSecret,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' } as SignOptions
      );

      logger.info('User registered successfully', { userId: user.id, tenantId: tenant.id });

      // Return user data and tokens
      res.status(201).json({
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            email: user.email,
            tenants: [{
              tenant_id: tenant.id,
              tenant_name: tenant.name,
              role: 'admin',
            }],
          },
        },
      });
    } catch (error: any) {
      // Rollback transaction on error
      await dbPool.query('ROLLBACK');
      throw error;
    }
  } catch (error: any) {
    console.error('Registration error:', error);
    logger.error('Registration error', {
      error: error.message,
      stack: error.stack,
    });

    // Handle duplicate tenant name
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A tenant with this name already exists. Please choose a different name.',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error during registration',
    });
  }
});

// Login endpoint
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required',
      });
    }

    // Query user from database
    const userResult = await req.app.locals.dbPool.query(
      `SELECT u.id, u.email, u.password_hash, u.totp_enabled
       FROM users u
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );

    if (userResult.rows.length === 0) {
      logger.warn('Login attempt with invalid email', { email });
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    const user = userResult.rows[0];

    // Get user's tenant memberships
    // Priority: superadmin role first, then by device count, then alphabetical
    const tenantsResult = await req.app.locals.dbPool.query(
      `SELECT t.id as tenant_id, t.name as tenant_name, utm.role,
              (SELECT COUNT(*) FROM devices d WHERE d.tenant_id = t.id AND d.unclaimed_at IS NULL) as device_count
       FROM user_tenant_memberships utm
       INNER JOIN tenants t ON utm.tenant_id = t.id
       WHERE utm.user_id = $1
       ORDER BY
         CASE WHEN utm.role = 'superadmin' THEN 0 ELSE 1 END,
         device_count DESC,
         t.name ASC`,
      [user.id]
    );

    const tenantMemberships = tenantsResult.rows;

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      logger.warn('Login attempt with invalid password', {
        userId: user.id,
        email: user.email,
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    // Use the first tenant as default (user can switch later in the frontend)
    const defaultTenant = tenantMemberships[0];
    if (!defaultTenant) {
      logger.warn('User has no tenant memberships', { userId: user.id });
      return res.status(403).json({
        success: false,
        error: 'User has no tenant access',
      });
    }

    // Generate JWT tokens with tenant and role information
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        tenantId: defaultTenant.tenant_id,
        role: defaultTenant.role,
      },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
    );

    const refreshToken = jwt.sign(
      {
        userId: user.id,
        type: 'refresh',
      },
      jwtSecret,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' } as SignOptions
    );

    // Return user data and tokens
    logger.info('User logged in successfully', {
      userId: user.id,
      email: user.email,
      tenantCount: tenantMemberships.length,
    });

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          twoFactorEnabled: user.totp_enabled,
          tenants: tenantMemberships,
        },
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    logger.error('Login error', {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// Switch tenant - generates new JWT with different tenant
router.post('/switch-tenant', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    const decoded: any = jwt.verify(token, jwtSecret);

    const { tenantId } = req.body;
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'tenantId required' });
    }

    // Verify user has access to this tenant
    const membershipResult = await req.app.locals.dbPool.query(
      `SELECT utm.role, t.name as tenant_name
       FROM user_tenant_memberships utm
       JOIN tenants t ON utm.tenant_id = t.id
       WHERE utm.user_id = $1 AND utm.tenant_id = $2`,
      [decoded.userId, tenantId]
    );

    if (membershipResult.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'No access to this tenant' });
    }

    const membership = membershipResult.rows[0];

    // Generate new JWT with the selected tenant
    const accessToken = jwt.sign(
      {
        userId: decoded.userId,
        email: decoded.email,
        tenantId: tenantId,
        role: membership.role,
      },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
    );

    logger.info('User switched tenant', {
      userId: decoded.userId,
      fromTenant: decoded.tenantId,
      toTenant: tenantId,
      tenantName: membership.tenant_name,
    });

    res.json({
      success: true,
      data: {
        accessToken,
        tenantId,
        tenantName: membership.tenant_name,
        role: membership.role,
      },
    });
  } catch (error: any) {
    logger.error('Switch tenant error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to switch tenant' });
  }
});

// Get current user
router.get('/me', async (req: Request, res: Response) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
      });
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';

    // Verify token
    const decoded: any = jwt.verify(token, jwtSecret);

    // Get user from database
    const userResult = await req.app.locals.dbPool.query(
      `SELECT u.id, u.email, u.totp_enabled
       FROM users u
       WHERE u.id = $1 AND u.is_active = true`,
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
      });
    }

    const user = userResult.rows[0];

    // Get user's tenant memberships
    // Priority: superadmin role first, then by device count, then alphabetical
    const tenantsResult = await req.app.locals.dbPool.query(
      `SELECT t.id as tenant_id, t.name as tenant_name, utm.role,
              (SELECT COUNT(*) FROM devices d WHERE d.tenant_id = t.id AND d.unclaimed_at IS NULL) as device_count
       FROM user_tenant_memberships utm
       INNER JOIN tenants t ON utm.tenant_id = t.id
       WHERE utm.user_id = $1
       ORDER BY
         CASE WHEN utm.role = 'superadmin' THEN 0 ELSE 1 END,
         device_count DESC,
         t.name ASC`,
      [user.id]
    );

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        twoFactorEnabled: user.totp_enabled,
        tenants: tenantsResult.rows,
      },
    });
  } catch (error: any) {
    console.error('Get current user error:', error);
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      logger.warn('Token validation failed', {
        error: error.message,
        errorType: error.name,
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }
    logger.error('Error retrieving current user', {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// Logout endpoint
router.post('/logout', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

// Refresh token endpoint
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token required',
      });
    }

    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    const decoded: any = jwt.verify(refreshToken, jwtSecret);

    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token',
      });
    }

    // Generate new access token
    const userResult = await req.app.locals.dbPool.query(
      'SELECT id, email FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
      });
    }

    const user = userResult.rows[0];

    const newAccessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
      },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as SignOptions
    );

    const newRefreshToken = jwt.sign(
      {
        userId: user.id,
        type: 'refresh',
      },
      jwtSecret,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' } as SignOptions
    );

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error: any) {
    console.error('Refresh token error:', error);
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      logger.warn('Token refresh failed', {
        error: error.message,
        errorType: error.name,
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired refresh token',
      });
    }
    logger.error('Token refresh error', {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /auth/2fa/setup - Setup 2FA for current user
router.post('/2fa/setup', async (req: Request, res: Response) => {
  try {
    // Extract token from Authorization header
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

    // Generate TOTP secret
    const speakeasy = require('speakeasy');
    const secret = speakeasy.generateSecret({
      name: `MouseTrap Monitor (${decoded.email})`,
      length: 32,
    });

    // Generate QR code
    const QRCode = require('qrcode');
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Store the secret in the database (temporarily, until verified)
    await req.app.locals.dbPool.query(
      `UPDATE users
       SET totp_secret = $1
       WHERE id = $2`,
      [secret.base32, decoded.userId]
    );

    res.json({
      success: true,
      data: {
        secret: secret.base32,
        qrCode: qrCodeUrl,
        otpauthUrl: secret.otpauth_url,
      },
    });
  } catch (error: any) {
    console.error('2FA setup error:', error);
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
});

// POST /auth/2fa/verify - Verify 2FA token and enable 2FA
router.post('/2fa/verify', async (req: Request, res: Response) => {
  try {
    const { token: totpToken } = req.body;

    if (!totpToken) {
      return res.status(400).json({
        success: false,
        error: 'Token is required',
      });
    }

    // Extract JWT token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
      });
    }

    const jwtToken = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    const decoded: any = jwt.verify(jwtToken, jwtSecret);

    // Get user's TOTP secret
    const userResult = await req.app.locals.dbPool.query(
      'SELECT totp_secret FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].totp_secret) {
      return res.status(400).json({
        success: false,
        error: '2FA not set up',
      });
    }

    const secret = userResult.rows[0].totp_secret;

    // Verify the token
    const speakeasy = require('speakeasy');
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: totpToken,
      window: 2, // Allow 2 time steps before and after
    });

    if (!verified) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
    }

    // Enable 2FA for the user
    await req.app.locals.dbPool.query(
      `UPDATE users
       SET totp_enabled = true
       WHERE id = $1`,
      [decoded.userId]
    );

    res.json({
      success: true,
      data: {
        verified: true,
      },
    });
  } catch (error: any) {
    console.error('2FA verify error:', error);
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
});

// POST /auth/2fa/disable - Disable 2FA for current user
router.post('/2fa/disable', async (req: Request, res: Response) => {
  try {
    const { token: totpToken } = req.body;

    if (!totpToken) {
      return res.status(400).json({
        success: false,
        error: 'Token is required',
      });
    }

    // Extract JWT token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
      });
    }

    const jwtToken = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    const decoded: any = jwt.verify(jwtToken, jwtSecret);

    // Get user's TOTP secret
    const userResult = await req.app.locals.dbPool.query(
      'SELECT totp_secret, totp_enabled FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].totp_enabled) {
      return res.status(400).json({
        success: false,
        error: '2FA not enabled',
      });
    }

    const secret = userResult.rows[0].totp_secret;

    // Verify the token before disabling
    const speakeasy = require('speakeasy');
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: totpToken,
      window: 2,
    });

    if (!verified) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
    }

    // Disable 2FA and remove secret
    await req.app.locals.dbPool.query(
      `UPDATE users
       SET totp_enabled = false, totp_secret = NULL
       WHERE id = $1`,
      [decoded.userId]
    );

    res.json({
      success: true,
      data: {
        success: true,
      },
    });
  } catch (error: any) {
    console.error('2FA disable error:', error);
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
});

export default router;
